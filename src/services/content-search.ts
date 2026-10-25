import { createHash } from "node:crypto";
import { getIndexerBaseUrl } from "@/lib/indexer-url";
import { cacheContextEpoch } from "@/lib/cache";
import { getSetting } from "@/lib/settings";
import { LANGUAGE_POLICY_SETTING_KEY, readLanguagePolicy } from "@/lib/language-policy";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { selectLanguageVariants } from "./language-editions";
import { eligibleRenditionItem } from "./rendition-quality";
import { recordDecision } from "@/server/decision-diagnostics";
import { mediathekSearchAdapter } from "@/providers/mediathek/search";
import type { ApiResultItem } from "@/types";
import type {
  ContentQueryField,
  ContentSearchOptions,
  ContentSearchWindow,
  SearchProviderId,
} from "@/types/provider";
export type { ContentSearchWindow, SearchProviderId } from "@/types/provider";

// Preserve the shipped RSS reservation without importing a concrete API into the coordinator.
export const RSS_SYNC_CANDIDATE_LIMIT = 6000;
export const RSS_SOURCE_WINDOW_ATTEMPTS = mediathekSearchAdapter.rssWindowAttempts;
export const SEARCH_PROVIDER_IDS = mediathekSearchAdapter.providerIds;
const MAX_PENDING_SEARCHES = 128;
const pendingSearches = new Map<string, Promise<ApiResultItem[] | null>>();

/** Fingerprint source identity and mutable matching policy without exposing secrets in keys. */
export async function searchCacheContext(): Promise<string> {
  const keys = [
    ...mediathekSearchAdapter.cacheSettingKeys,
    "download.enableHLS",
    "download.quality",
    "matching.strategy",
    "matching.threshold",
    "matching.minDuration",
    LANGUAGE_POLICY_SETTING_KEY,
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
    "integration.radarr.inventoryMaxMiB",
    "matching.movie.tolerancePercent",
    "matching.movie.yearTolerance",
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

export async function getConfiguredLanguagePolicy() {
  return readLanguagePolicy(await getSetting(LANGUAGE_POLICY_SETTING_KEY));
}

/**
 * One bounded source window for GUI and indexer consumers. The GUI may explain
 * partial sources; automatic matching must use queryContent's fail-closed wrapper.
 */
export async function queryContentWindow(
  queries: ContentQueryField[],
  size: number,
  options: ContentSearchOptions = {},
  providerId?: SearchProviderId
): Promise<ContentSearchWindow> {
  if (options.arteSeries && !options.requestBudget)
    options = { ...options, requestBudget: new HttpRequestBudget() };
  const deadlineAt = Math.min(
    options.deadlineAt ?? Date.now() + 20_000,
    options.requestBudget?.deadlineAt ?? Infinity
  );
  try {
    const hlsEnabled = (await getSetting("download.enableHLS")) === "true";
    const policy = await getConfiguredLanguagePolicy();
    const window = await mediathekSearchAdapter.searchWindow(
      queries,
      size,
      { ...options, deadlineAt },
      hlsEnabled,
      providerId
    );
    const available = window.items.map((item) => eligibleRenditionItem(item, hlsEnabled));
    for (const item of available)
      recordDecision(
        "language",
        item.audioLanguage ? "language_verified" : "language_unknown",
        item.audioLanguage ? "proven" : "missing"
      );
    return {
      ...window,
      items: options.deferLanguageSelection ? available : selectLanguageVariants(available, policy),
    };
  } catch {
    console.error("[ContentSearch] Provider failed");
    throw new Error("Content source unavailable");
  }
}

/** Source-owned classification, never inferred separately by a GUI consumer. */
export function contentProviderForItem(item: ApiResultItem): SearchProviderId {
  return mediathekSearchAdapter.providerForItem(item);
}

async function queryContentUncoalesced(
  queries: ContentQueryField[],
  size: number,
  options: ContentSearchOptions = {}
): Promise<ApiResultItem[] | null> {
  try {
    const result = await queryContentWindow(queries, size, options);
    if (!result.coverage.complete) return null;
    return options.deferLanguageSelection ? result.items : result.items.slice(0, size);
  } catch {
    return null;
  }
}

/** Share only simultaneous identical searches; never retain failures or expiring media URLs. */
export async function queryContent(
  queries: ContentQueryField[],
  size: number,
  options: ContentSearchOptions = {}
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
