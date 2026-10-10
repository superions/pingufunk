import { LRUCache } from "lru-cache";
import { createHash } from "node:crypto";
import { isPlaceholderEpisodeTitle } from "@/lib/episode-title";
import { getSetting } from "@/lib/settings";
import { externalCredential } from "@/lib/credential-settings";
import { cacheContextEpoch, coalesceMetadata, metadataCacheKey } from "@/lib/cache";
import { createReadOnlyArrJsonClient } from "@/lib/read-only-arr-client";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import {
  parseSonarrVersion,
  parseSonarrSeries,
  parseSonarrEpisodes,
  type SonarrSeriesMetadata,
  type SonarrEpisodeMetadata,
} from "./sonarr-metadata";
import type { TvdbData } from "@/types";

export class SonarrUnavailableError extends Error {
  constructor() {
    super("Optional episode metadata unavailable");
  }
}

export interface SonarrShow {
  series: SonarrSeriesMetadata;
  episodes: SonarrEpisodeMetadata[];
}

// Fixed provider freshness is independent of the general TVDB/TMDB TTL setting.
const metadata = new LRUCache<string, { value: unknown; expiresAt: number }>({ max: 256 });
const METADATA_TTL_MS = 600_000;

/** Capture settings and credentials once; a disabled integration does no HTTP or secret I/O. */
export async function openSonarrSession(): Promise<SonarrSession | null> {
  const epoch = cacheContextEpoch();
  if ((await getSetting("integration.sonarr.enabled")) !== "true") return null;
  try {
    const baseUrl = await getSetting("integration.sonarr.url");
    const credential = await externalCredential("PINGUFUNK_SONARR_API_KEY");
    if (!baseUrl || !credential.configured || !credential.value) throw new SonarrUnavailableError();
    if (epoch !== cacheContextEpoch()) throw new SonarrUnavailableError();
    return new SonarrSession(baseUrl, credential.value);
  } catch {
    throw new SonarrUnavailableError();
  }
}

export class SonarrSession {
  private readonly epoch = cacheContextEpoch();
  private readonly client: ReturnType<typeof createReadOnlyArrJsonClient>;
  private readonly context: string;
  readonly deliveryIdentity: string;

  constructor(baseUrl: string, credential: string) {
    this.client = createReadOnlyArrJsonClient(baseUrl, credential);
    this.context = metadataCacheKey("sonarr-context", null, [baseUrl, credential]);
    // Discovery survives process/cache epochs, but never an instance, credential
    // or database change. No connection detail is exposed or stored verbatim.
    this.deliveryIdentity = createHash("sha256")
      .update(JSON.stringify([process.env.DATABASE_URL ?? null, baseUrl, credential]))
      .digest("hex");
  }

  get cacheIdentity(): string {
    return this.context;
  }

  private assertCurrent(budget: HttpRequestBudget): void {
    if (this.epoch !== cacheContextEpoch() || Date.now() >= budget.deadlineAt)
      throw new SonarrUnavailableError();
  }

  private async cached<T>(
    identity: unknown,
    budget: HttpRequestBudget,
    load: () => Promise<T>
  ): Promise<T> {
    this.assertCurrent(budget);
    const key = metadataCacheKey("sonarr", identity, this.context);
    const entry = metadata.get(key);
    if (entry && Date.now() < entry.expiresAt) return structuredClone(entry.value) as T;
    try {
      const operation = coalesceMetadata(key, async () => {
        const loaded = await load();
        this.assertCurrent(budget);
        // Newly added series must not inherit a ten-minute definitive miss.
        if (loaded !== null)
          metadata.set(key, {
            value: structuredClone(loaded),
            expiresAt: Date.now() + METADATA_TTL_MS,
          });
        return loaded;
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      let value: T;
      try {
        value = await Promise.race([
          operation,
          new Promise<never>((_resolve, reject) => {
            timer = setTimeout(
              () => reject(new SonarrUnavailableError()),
              Math.max(0, budget.deadlineAt - Date.now())
            );
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
      this.assertCurrent(budget);
      return structuredClone(value);
    } catch {
      // Never cache an outage as a definitive empty library or reveal provider payloads.
      throw new SonarrUnavailableError();
    }
  }

  async inventory(budget: HttpRequestBudget, refresh = false): Promise<SonarrSeriesMetadata[]> {
    await this.version(budget);
    if (refresh) metadata.delete(metadataCacheKey("sonarr", "inventory", this.context));
    return this.cached("inventory", budget, async () =>
      parseSonarrSeries(await this.client("api/v3/series", undefined, { requestBudget: budget }))
    );
  }

  private async version(budget: HttpRequestBudget): Promise<string> {
    return this.cached("version", budget, async () =>
      parseSonarrVersion(
        await this.client("api/v3/system/status", undefined, { requestBudget: budget })
      )
    );
  }

  async show(
    tvdbId: number,
    budget = new HttpRequestBudget(),
    refresh = false
  ): Promise<SonarrShow | null> {
    if (!Number.isSafeInteger(tvdbId) || tvdbId < 1 || tvdbId > 2_147_483_647)
      throw new SonarrUnavailableError();
    await this.version(budget);
    if (refresh) {
      metadata.delete(metadataCacheKey("sonarr", ["show", tvdbId], this.context));
      await this.inventory(budget, true);
    }
    return this.cached(["show", tvdbId], budget, async () => {
      const series = parseSonarrSeries(
        await this.client("api/v3/series", new URLSearchParams({ tvdbId: String(tvdbId) }), {
          requestBudget: budget,
        })
      );
      if (series.length === 0) return null;
      if (series.length !== 1 || series[0].tvdbId !== tvdbId) throw new SonarrUnavailableError();
      return this.episodes(series[0], budget, refresh);
    });
  }

  async episodes(
    series: SonarrSeriesMetadata,
    budget: HttpRequestBudget,
    refresh = false
  ): Promise<SonarrShow> {
    // Only accept a series verified by this instance, not a caller-supplied local ID.
    let inventory = await this.inventory(budget);
    let verified = inventory.find((item) => item.tvdbId === series.tvdbId);
    // A fresh filtered lookup can see an addition before the ten-minute RSS
    // inventory. Refresh one missing identity, sharing the caller's budget.
    if (!verified) {
      inventory = await this.inventory(budget, true);
      verified = inventory.find((item) => item.tvdbId === series.tvdbId);
    }
    if (!verified || verified.sonarrId !== series.sonarrId) throw new SonarrUnavailableError();
    if (refresh)
      metadata.delete(
        metadataCacheKey("sonarr", ["episodes", verified.sonarrId, verified.tvdbId], this.context)
      );
    return this.cached(["episodes", verified.sonarrId, verified.tvdbId], budget, async () => ({
      // Only instance inventory may supply title/aliases, not caller fields.
      series: verified,
      episodes: parseSonarrEpisodes(
        await this.client(
          "api/v3/episode",
          new URLSearchParams({ seriesId: String(verified.sonarrId) }),
          { requestBudget: budget }
        ),
        verified.sonarrId
      ),
    }));
  }
}

function coordinate(episode: { seasonNumber: number; episodeNumber: number }): string {
  return `${episode.seasonNumber}:${episode.episodeNumber}`;
}

/** Preserve the authoritative base verbatim; conflicting coordinates cannot become fallbacks. */
export function mergeSonarrShow(
  base: TvdbData | null,
  supplemental: SonarrShow | null
): TvdbData | null {
  if (!supplemental) return base;
  if (base && base.id !== supplemental.series.tvdbId) throw new SonarrUnavailableError();
  const episodes = [...(base?.episodes ?? [])];
  const existing = new Map(episodes.map((episode) => [coordinate(episode), episode]));
  const blocked = new Set(base?.sonarrBlockedCoordinates ?? []);
  for (const episode of supplemental.episodes) {
    const key = coordinate(episode);
    const original = existing.get(key);
    if (original) {
      if (
        (!isPlaceholderEpisodeTitle(original.name, original.episodeNumber) &&
          !isPlaceholderEpisodeTitle(episode.title, episode.episodeNumber) &&
          original.name.trim().normalize("NFC") !== episode.title.trim().normalize("NFC")) ||
        (original.aired &&
          episode.aired &&
          new Date(original.aired).toISOString().slice(0, 10) !==
            episode.aired.toISOString().slice(0, 10))
      )
        blocked.add(key);
      continue;
    }
    episodes.push({
      name: episode.title,
      aired: episode.aired,
      runtime: episode.expectedRuntimeSeconds === null ? null : episode.expectedRuntimeSeconds / 60,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      metadataSource: "sonarr",
    });
  }
  return {
    ...(base ?? {
      id: supplemental.series.tvdbId,
      name: supplemental.series.title,
      germanName: null,
      aliases: [],
    }),
    aliases: [
      ...(base?.aliases ?? []),
      ...(supplemental.series.aliases ?? [])
        .filter((name) => !base?.aliases.some((alias) => alias.name === name))
        .map((name) => ({ name, language: "und" })),
    ],
    episodes,
    sonarrVerifiedCoordinates: supplemental.episodes.map(coordinate),
    sonarrMonitoredCoordinates: supplemental.series.monitored
      ? supplemental.episodes
          .filter((episode) => episode.monitored && !episode.hasFile)
          .map(coordinate)
      : [],
    sonarrBlockedCoordinates: [...blocked],
  };
}
