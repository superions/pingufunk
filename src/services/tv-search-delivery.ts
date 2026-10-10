import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { writesEnabled } from "@/lib/write-gate";
import { getSetting, getMinDurationSeconds } from "@/lib/settings";
import { cacheContextEpoch } from "@/lib/cache";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { isProbeableMp4 } from "@/lib/mp4-audio-language";
import { sourceMediaFacts, SourceMediaFactsStore } from "./source-media-facts";
import { openSonarrSession, mergeSonarrShow, SonarrUnavailableError } from "./sonarr-provider";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { getConfiguredLanguagePolicy, RSS_SOURCE_WINDOW_ATTEMPTS } from "./content-search";
import { verifiedRuleTopics } from "./tv-search-terms";
import { getRulesetContext } from "./rulesets";
import { enrichTvMatches } from "./source-audio";
import { generateRssItems } from "./newznab";
import type { ApiResultItem, MatchedEpisodeInfo, NewznabItem, TvdbData } from "@/types";
import type { QualityPreference } from "./rendition-quality";

export const TV_DELIVERY_KEY = "internal.tv-delivery.v1";
const RETENTION_MS = 7_200_000;
const MAX_ENTRIES = 128;
const MAX_BYTES = 2 * 1024 * 1024;
const fields = ["url_video_hd", "url_video", "url_video_low"] as const;
const text = z.string().max(16_384);
const itemSchema = z
  .object({
    channel: text,
    topic: text,
    title: text,
    description: text,
    filmlisteTimestamp: z.number().finite().nonnegative(),
    duration: z.number().finite().positive(),
    size: z.number().finite().nonnegative(),
    url_website: text,
    url_video: text,
    url_video_hd: text,
    url_video_low: text,
  })
  .strict();
const entrySchema = z
  .object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    scope: z.string().regex(/^[a-f0-9]{64}$/),
    tvdbId: z.number().int().positive(),
    season: z.number().int().nonnegative(),
    episode: z.number().int().positive(),
    item: itemSchema,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    readyAt: z.number().int().nonnegative().nullable(),
    blockedUrls: z.array(text).max(3),
    // Publication events are not media proofs or consumer acknowledgements.
    announcements: z
      .array(
        z
          .object({
            release: z.string().regex(/^[a-f0-9]{64}$/),
            at: z.number().int().nonnegative(),
          })
          .strict()
      )
      .max(6)
      .default([]),
  })
  .strict();
type Entry = z.infer<typeof entrySchema>;
const journalSchema = z
  .object({ version: z.literal(1), entries: z.array(entrySchema).max(MAX_ENTRIES) })
  .strict();
interface Repository {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
}

/**
 * Durable discovery, not durable media proof or a second download queue.
 * One bounded internal Config journal survives a runner restart on either DB.
 * Feeds do not consume entries: Prowlarr probes/other readers are not ACKs.
 */
export class TvSearchDeliveryJournal {
  private entries: Entry[] | undefined;
  private serial: Promise<unknown> = Promise.resolve();
  private failed = false;
  private armedGeneration = -1;
  private unsubscribe: () => void;

  constructor(
    private repository: Repository,
    private facts: SourceMediaFactsStore
  ) {
    this.unsubscribe = facts.onChecked((url, result) => {
      if (!writesEnabled() || !this.entries?.some((e) => fields.some((f) => e.item[f] === url)))
        return;
      void this.lock(async () => {
        const complete = !!(
          result?.fingerprint &&
          result.facts.audioLanguage &&
          result.facts.videoDimensions
        );
        let changed = false;
        for (const entry of this.entries ?? []) {
          if (entry.expiresAt <= Date.now()) continue;
          if (!fields.some((f) => entry.item[f] === url)) continue;
          if (complete && entry.readyAt === null) {
            entry.readyAt = Date.now();
            changed = true;
          }
          if (!complete && !entry.blockedUrls.includes(url)) {
            entry.blockedUrls.push(url);
            changed = true;
          }
        }
        if (changed) await this.save();
      }).catch(() => {
        this.failed = true;
        console.error("[TV delivery] Journal unavailable");
      });
    });
  }

  private lock<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.serial.then(operation);
    this.serial = pending.catch(() => {});
    return pending;
  }

  private async load(): Promise<Entry[]> {
    if (this.failed) throw new SonarrUnavailableError();
    if (!this.entries) {
      const value = await this.repository.read();
      if (value && Buffer.byteLength(value) > MAX_BYTES) throw new SonarrUnavailableError();
      const parsed = value ? journalSchema.parse(JSON.parse(value)).entries : [];
      if (
        parsed.some(
          (e) =>
            e.expiresAt <= e.createdAt ||
            e.expiresAt > e.createdAt + RETENTION_MS ||
            (e.readyAt !== null && (e.readyAt < e.createdAt || e.readyAt >= e.expiresAt)) ||
            e.announcements.some((event) => event.at < e.createdAt || event.at >= e.expiresAt) ||
            new Set(e.announcements.map((event) => event.release)).size !==
              e.announcements.length ||
            fields.some((f) => e.item[f] && !isProbeableMp4(e.item[f]))
        )
      )
        throw new SonarrUnavailableError();
      this.entries = parsed;
    }
    return this.entries.filter((e) => e.expiresAt > Date.now());
  }

  private async save(): Promise<void> {
    const value = JSON.stringify({ version: 1, entries: this.entries });
    if (Buffer.byteLength(value) > MAX_BYTES) throw new SonarrUnavailableError();
    try {
      await this.repository.write(value);
    } catch {
      this.failed = true;
      throw new SonarrUnavailableError();
    }
  }

  private arm(entries: Entry[]): void {
    // Breadth-first HD before alternatives, using the existing single/rate-bound worker.
    for (const field of fields) {
      const eligible = entries.filter((e) => !e.blockedUrls.includes(e.item[field]));
      for (const entry of eligible) this.facts.retain([entry.item[field]], entry.expiresAt);
    }
    this.armedGeneration = this.facts.generation;
  }

  async register(scope: string, show: TvdbData, matches: MatchedEpisodeInfo[]): Promise<void> {
    await this.lock(async () => {
      const entries = (await this.load()).filter((e) => e.scope === scope),
        now = Date.now();
      const monitored = new Set(show.sonarrMonitoredCoordinates ?? []);
      let changed = entries.length !== this.entries!.length;
      const next = new Map(entries.map((e) => [e.id, e]));
      for (const match of matches) {
        const { episode } = match;
        if (
          match.runtimeConflict ||
          match.tvdbId !== show.id ||
          !monitored.has(`${episode.seasonNumber}:${episode.episodeNumber}`)
        )
          continue;
        const item = itemSchema.parse(
          Object.fromEntries(
            Object.keys(itemSchema.shape).map((k) => [
              k,
              fields.includes(k as (typeof fields)[number]) &&
              !isProbeableMp4(match.item[k as (typeof fields)[number]])
                ? ""
                : match.item[k as keyof ApiResultItem],
            ])
          )
        );
        if (!fields.some((f) => item[f])) continue;
        const id = createHash("sha256")
          .update(
            // Catalogue timestamps/descriptions are mutable, not release identity.
            JSON.stringify([
              scope,
              show.id,
              episode.seasonNumber,
              episode.episodeNumber,
              item.channel,
              item.topic,
              item.title,
              item.duration,
              item.url_website,
              ...fields.map((f) => item[f]),
            ])
          )
          .digest("hex");
        const previous = next.get(id);
        if (previous) continue; // Repeated searches cannot keep an old event alive forever.
        if (
          [...next.values()].some(
            (e) =>
              fields.some((f) => item[f] && fields.some((g) => e.item[g] === item[f])) &&
              (e.tvdbId !== show.id ||
                e.season !== episode.seasonNumber ||
                e.episode !== episode.episodeNumber)
          )
        )
          throw new SonarrUnavailableError();
        next.set(id, {
          id,
          scope,
          tvdbId: show.id,
          season: episode.seasonNumber,
          episode: episode.episodeNumber,
          item,
          createdAt: now,
          expiresAt: now + RETENTION_MS,
          readyAt: fields.some(
            (f) =>
              this.facts.get(item[f])?.facts.videoDimensions &&
              this.facts.get(item[f])?.facts.audioLanguage &&
              this.facts.get(item[f])?.fingerprint
          )
            ? now
            : null,
          blockedUrls: [],
          announcements: [],
        });
        changed = true;
      }
      if (next.size > MAX_ENTRIES) throw new SonarrUnavailableError();
      const proposed = [...next.values()];
      if (Buffer.byteLength(JSON.stringify({ version: 1, entries: proposed })) > MAX_BYTES)
        throw new SonarrUnavailableError();
      this.releaseRemoved(this.entries!, proposed);
      this.entries = proposed;
      if (changed) await this.save();
      this.arm(proposed.filter((e) => e.scope === scope));
    });
  }

  async current(scope: string): Promise<Entry[]> {
    return this.lock(async () => {
      const entries = (await this.load()).filter((e) => e.scope === scope);
      if (this.armedGeneration !== this.facts.generation) this.arm(entries);
      return structuredClone(entries);
    });
  }

  async remove(ids: readonly string[]): Promise<void> {
    if (!ids.length) return;
    await this.lock(async () => {
      const proposed = (await this.load()).filter((e) => !ids.includes(e.id));
      this.releaseRemoved(this.entries!, proposed);
      this.entries = proposed;
      await this.save();
    });
  }

  /** Timestamp each actually eligible rendition once, not the first arbitrary probe. */
  async announce(
    scope: string,
    releases: Array<{ entryId: string; guid: string }>
  ): Promise<Map<string, number>> {
    return this.lock(async () => {
      const entries = structuredClone(await this.load()),
        output = new Map<string, number>(),
        now = Date.now();
      let changed = false;
      for (const { entryId, guid } of releases) {
        const entry = entries.find((e) => e.id === entryId && e.scope === scope);
        if (!entry) throw new SonarrUnavailableError();
        const release = createHash("sha256").update(guid).digest("hex");
        let event = entry.announcements.find((e) => e.release === release);
        if (!event) {
          if (entry.announcements.length >= 6) throw new SonarrUnavailableError();
          event = { release, at: now };
          entry.announcements.push(event);
          changed = true;
        }
        output.set(guid, event.at);
      }
      if (changed) {
        this.releaseRemoved(this.entries!, entries);
        this.entries = entries;
        await this.save(); // One bounded write for the whole publication batch.
      }
      return output;
    });
  }

  private releaseRemoved(previous: Entry[], next: Entry[]): void {
    const retained = new Set(next.flatMap((e) => fields.map((f) => e.item[f])));
    this.facts.release(
      previous.flatMap((e) => fields.map((f) => e.item[f])).filter((url) => !retained.has(url))
    );
  }

  async idle(): Promise<void> {
    await this.serial;
  }
  dispose(): void {
    this.unsubscribe();
  }
}

const globals = globalThis as typeof globalThis & {
  [key: symbol]: TvSearchDeliveryJournal | undefined;
};
const owner = Symbol.for("pingufunk.tv-search-delivery.v1");
export const tvSearchDelivery = (globals[owner] ??= new TvSearchDeliveryJournal(
  {
    read: async () =>
      (await prisma.config.findUnique({ where: { key: TV_DELIVERY_KEY } }))?.value ?? null,
    write: async (value) => {
      await prisma.config.upsert({
        where: { key: TV_DELIVERY_KEY },
        create: { key: TV_DELIVERY_KEY, value },
        update: { value },
      });
    },
  },
  sourceMediaFacts
));

export async function registerTvSearchDelivery(
  show: TvdbData,
  matches: MatchedEpisodeInfo[],
  budget: HttpRequestBudget
): Promise<void> {
  if (!writesEnabled() || !show.sonarrMonitoredCoordinates?.length || !matches.length) return;
  const session = await openSonarrSession();
  if (!session) return;
  const epoch = cacheContextEpoch();
  await tvSearchDelivery.register(session.deliveryIdentity, show, matches);
  if (epoch !== cacheContextEpoch()) throw new SonarrUnavailableError();
  budget.assertAvailable();
}

let snapshot: { key: string; expiresAt: number; items: NewznabItem[] } | undefined;
let ownerCursor = 0;

/** Old aired dates are eligible discovery events, never fabricated broadcast dates. */
export async function getTvSearchDeliveryItems(
  loadBase: (id: number) => Promise<TvdbData | null>,
  budget: HttpRequestBudget,
  quality: QualityPreference,
  hlsEnabled: boolean
): Promise<NewznabItem[]> {
  if (!writesEnabled()) return [];
  const session = await openSonarrSession();
  if (!session) return [];
  const epoch = cacheContextEpoch(),
    rules = getRulesetContext();
  const policy = await getConfiguredLanguagePolicy(),
    minimum = await getMinDurationSeconds();
  const tolerance = Number((await getSetting("matching.sonarr.tolerancePercent")) ?? "10");
  const key = JSON.stringify([
    session.cacheIdentity,
    epoch,
    rules,
    policy,
    minimum,
    tolerance,
    quality,
    hlsEnabled,
  ]);
  if (snapshot?.key === key && snapshot.expiresAt > Date.now())
    return structuredClone(snapshot.items);
  const entries = await tvSearchDelivery.current(session.deliveryIdentity);
  if (!entries.length) return [];
  const inventory = await session.inventory(budget, true);
  const output: NewznabItem[] = [];
  const announcements: Array<{ entryId: string; guid: string }> = [];
  // Reserve the normal RSS source window. Cache-backed proof rendering consumes no HTTP.
  const allOwners = [...new Set(entries.map((e) => e.tvdbId))];
  const start = ownerCursor % allOwners.length;
  const owners = [...allOwners.slice(start), ...allOwners.slice(0, start)].slice(
    0,
    Math.max(0, budget.remainingAttempts - RSS_SOURCE_WINDOW_ATTEMPTS)
  );
  for (const id of owners) {
    const series = inventory.find((s) => s.tvdbId === id && s.monitored);
    if (!series) {
      await tvSearchDelivery.remove(entries.filter((e) => e.tvdbId === id).map((e) => e.id));
      continue;
    }
    const supplemental = await session.episodes(series, budget, true);
    const allowed = new Set(
      supplemental.episodes
        .filter((e) => e.monitored && !e.hasFile && e.aired && e.aired.getTime() <= Date.now())
        .map((e) => `${e.seasonNumber}:${e.episodeNumber}`)
    );
    const show = mergeSonarrShow(await loadBase(id), supplemental)!;
    await tvSearchDelivery.remove(
      entries
        .filter((e) => e.tvdbId === id && !allowed.has(`${e.season}:${e.episode}`))
        .map((e) => e.id)
    );
    const candidates = entries.filter(
      (e) => e.tvdbId === id && e.readyAt !== null && allowed.has(`${e.season}:${e.episode}`)
    );
    for (const entry of candidates) {
      const item: ApiResultItem = { ...entry.item };
      for (const field of fields) {
        // Also cover rendering's remaining request deadline before a 60s page snapshot.
        const proof = sourceMediaFacts.get(item[field], 75_000);
        if (
          !proof?.fingerprint ||
          !proof.facts.audioLanguage ||
          !proof.facts.videoDimensions ||
          entry.blockedUrls.includes(item[field])
        )
          item[field] = "";
      }
      if (!fields.some((f) => item[f])) continue;
      const matches = matchSonarrEpisodes(
        show,
        [item],
        minimum,
        tolerance,
        policy,
        hlsEnabled,
        true,
        verifiedRuleTopics(show)
      );
      const exact = matches.filter(
        (m) => m.episode.seasonNumber === entry.season && m.episode.episodeNumber === entry.episode
      );
      for (const info of await enrichTvMatches(exact, budget, policy, quality, hlsEnabled, false)) {
        for (const release of generateRssItems(info, quality, hlsEnabled)) {
          if (release.title.includes(".UNKNOWN.")) continue;
          output.push(release);
          announcements.push({ entryId: entry.id, guid: release.guid.value });
        }
      }
    }
  }
  if (
    epoch !== cacheContextEpoch() ||
    rules !== getRulesetContext() ||
    Date.now() >= budget.deadlineAt
  )
    throw new SonarrUnavailableError();
  const advertised = await tvSearchDelivery.announce(session.deliveryIdentity, announcements);
  for (const item of output)
    item.pubDate = new Date(advertised.get(item.guid.value)!).toUTCString();
  if (
    epoch !== cacheContextEpoch() ||
    rules !== getRulesetContext() ||
    Date.now() >= budget.deadlineAt
  )
    throw new SonarrUnavailableError();
  const items = [...new Map(output.map((item) => [item.guid.value, item])).values()].sort(
    (a, b) =>
      Date.parse(b.pubDate) - Date.parse(a.pubDate) || a.guid.value.localeCompare(b.guid.value)
  );
  // One fixed snapshot protects paging from proof completions and import state changes.
  ownerCursor = (ownerCursor + owners.length) % allOwners.length;
  if (items.length) snapshot = { key, expiresAt: Date.now() + 60_000, items };
  return structuredClone(items);
}
