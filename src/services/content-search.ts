import {
  MEDIATHEK_VIEW_MAX_PAGE_SIZE,
  queryMediathekView,
  type MediathekQueryField,
  type MediathekQueryOptions,
} from "@/lib/mediathek-client";
import { createHash } from "node:crypto";
import { getIndexerBaseUrl } from "@/lib/indexer-url";
import { cacheContextEpoch } from "@/lib/cache";
import { getSetting } from "@/lib/settings";
import { LANGUAGE_POLICY_SETTING_KEY, readLanguagePolicy } from "@/lib/language-policy";
import { srfProvider } from "@/providers/srf";
import { selectLanguageVariants } from "@/services/language-editions";
import type { ApiResultItem } from "@/types";
import { resolveArteSeriesEditions } from "./arte-editions";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const MAX_MEDIATHEK_CANDIDATES = 5000;
const MAX_PENDING_SEARCHES = 128;
const pendingSearches = new Map<string, Promise<ApiResultItem[] | null>>();

/** Fingerprint source identity and mutable matching policy without exposing secrets in keys. */
export async function searchCacheContext(): Promise<string> {
  const keys = [
    "provider.mediathekview.enabled",
    "provider.orf.enabled",
    "provider.srf.enabled",
    "download.enableHLS",
    "download.quality",
    "matching.strategy",
    "matching.threshold",
    "matching.minDuration",
    LANGUAGE_POLICY_SETTING_KEY,
    "api.srgssr.consumerKey",
    "api.srgssr.consumerSecret",
    "api.tvdb.key",
    "api.tvdb.pin",
    "api.tmdb.key",
    "integration.sonarr.enabled",
    "integration.sonarr.url",
    "integration.sonarr.windowDays",
    "matching.sonarr.tolerancePercent",
    "api.sonarr.key",
    "integration.radarr.enabled",
    "integration.radarr.url",
    "matching.movie.tolerancePercent",
    "api.radarr.key",
  ];
  const sonarrEnabled = (await getSetting("integration.sonarr.enabled")) === "true";
  const radarrEnabled = (await getSetting("integration.radarr.enabled")) === "true";
  const values = await Promise.all(
    keys.map((key) =>
      (key === "api.sonarr.key" && !sonarrEnabled) || (key === "api.radarr.key" && !radarrEnabled)
        ? null
        : getSetting(key)
    )
  );
  return createHash("sha256")
    .update(
      JSON.stringify([
        cacheContextEpoch(),
        process.env.DATABASE_URL ?? null,
        getIndexerBaseUrl(),
        values,
      ])
    )
    .digest("hex")
    .slice(0, 24);
}

async function queryMediathekCandidateWindow(
  queries: MediathekQueryField[],
  requestedSize: number,
  options: MediathekQueryOptions
): Promise<ApiResultItem[] | null> {
  if (requestedSize <= 0) return [];

  const candidates: ApiResultItem[] = [];

  // Scan a bounded source window before edition selection. MediathekViewWeb's
  // `id` hashes its full source row, so it is not a stable cursor or release key.
  for (let offset = 0; offset < MAX_MEDIATHEK_CANDIDATES; offset += MEDIATHEK_VIEW_MAX_PAGE_SIZE) {
    const pageSize = Math.min(MEDIATHEK_VIEW_MAX_PAGE_SIZE, MAX_MEDIATHEK_CANDIDATES - offset);
    const page = await queryMediathekView(queries, pageSize, { ...options, offset });
    if (page === null) return null;

    candidates.push(...page);
    if (page.length < pageSize) break;
  }

  // This is intentionally a bounded candidate set, not a claim that the provider
  // catalog or all matching releases have been exhausted.
  return candidates;
}

export async function getConfiguredLanguagePolicy() {
  return readLanguagePolicy(await getSetting(LANGUAGE_POLICY_SETTING_KEY));
}

/** Shared source for UI, Newznab and ruleset discovery, before episode/movie matching. */
async function queryContentUncoalesced(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  if (options.arteSeries && !options.requestBudget)
    options = { ...options, requestBudget: new HttpRequestBudget() };
  const deadlineAt = Math.min(
    options.deadlineAt ?? Date.now() + 20_000,
    options.requestBudget?.deadlineAt ?? Infinity
  );
  const [mvSetting, orfSetting, hlsSetting] = await Promise.all([
    getSetting("provider.mediathekview.enabled"),
    getSetting("provider.orf.enabled"),
    getSetting("download.enableHLS"),
  ]);
  const languagePolicy = await getConfiguredLanguagePolicy();
  const mvEnabled = mvSetting !== "false";
  const orfEnabled = orfSetting === "true" && hlsSetting === "true";
  // This scope cannot publish HLS/SRF references; avoid spending its bounded
  // Sonarr budget on sources whose only renditions are currently ineligible.
  const srfEnabled = !options.progressiveOnly && (await srfProvider.isEnabled());

  try {
    const [indexed, swiss] = await Promise.all([
      mvEnabled || orfEnabled
        ? queryMediathekCandidateWindow(
            !mvEnabled && orfEnabled
              ? [...queries, { fields: ["channel"], query: "ORF" }]
              : queries,
            size,
            { ...options, deadlineAt }
          )
        : Promise.resolve([]),
      srfEnabled && size > 0
        ? srfProvider.search({
            query: queries.find((q) => q.fields.includes("topic"))?.query || "",
            limit: Math.min(size, 100),
            requestBudget: options.requestBudget,
            deadlineAt,
          })
        : Promise.resolve([]),
    ]);
    // Do not cache incomplete results when an enabled source fails.
    if (indexed === null) return null;
    const items = indexed.filter((item) => (/^ORF\b/i.test(item.channel) ? orfEnabled : mvEnabled));
    for (const item of swiss) {
      const converted: ApiResultItem = {
        channel: item.channel,
        topic: item.topic,
        title: item.title,
        description: item.description,
        filmlisteTimestamp: item.timestamp,
        duration: item.duration,
        size: item.size,
        url_website: item.websiteUrl,
        url_video: item.videoUrls.standard,
        url_video_hd: item.videoUrls.high || "",
        url_video_low: item.videoUrls.low || "",
      };
      if (
        queries.every(({ fields, query }) =>
          fields.some((field) =>
            String(converted[field as keyof ApiResultItem] ?? "")
              .toLowerCase()
              .includes(query.toLowerCase())
          )
        )
      )
        items.push(converted);
    }
    const editions = options.arteSeries
      ? await resolveArteSeriesEditions(items, options.arteSeries, options.requestBudget!)
      : items;
    return editions === null
      ? null
      : options.deferLanguageSelection
        ? editions
        : selectLanguageVariants(editions, languagePolicy).slice(0, size);
  } catch {
    console.error("[ContentSearch] Provider failed");
    return null;
  }
}

/** Share only simultaneous identical searches; never retain failures or expiring media URLs. */
export async function queryContent(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  // An explicit caller deadline is part of its contract and must not inherit
  // another request's remaining budget through coalescing.
  if (options.deadlineAt !== undefined || options.requestBudget)
    return queryContentUncoalesced(queries, size, options);
  const context = await searchCacheContext();
  const key = JSON.stringify([context, queries, size, options]);
  const pending = pendingSearches.get(key);
  if (pending) return pending;
  if (pendingSearches.size >= MAX_PENDING_SEARCHES) return null;
  const operation = queryContentUncoalesced(queries, size, options);
  pendingSearches.set(key, operation);
  try {
    return await operation;
  } finally {
    if (pendingSearches.get(key) === operation) pendingSearches.delete(key);
  }
}
