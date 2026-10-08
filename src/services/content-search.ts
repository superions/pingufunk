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
import { providerItemToApiResult } from "@/providers/content-item";
import { recordDecision } from "@/server/decision-diagnostics";
import { eligibleRenditionItem } from "./rendition-quality";

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

export type SearchProviderId = "mediathekview" | "orf" | "srf";

export interface ContentSearchWindow {
  items: ApiResultItem[];
  /** Successful bounded retrieval is not a claim that the complete catalogue was searched. */
  coverage: {
    complete: boolean;
    candidateWindowLimited: boolean;
    sources: Array<{
      providerId: SearchProviderId;
      state: "complete" | "failed" | "disabled";
      candidateCount: number;
    }>;
  };
}

async function queryMediathekCandidateWindow(
  queries: MediathekQueryField[],
  requestedSize: number,
  options: MediathekQueryOptions
): Promise<{ items: ApiResultItem[]; limited: boolean } | null> {
  if (requestedSize <= 0) return { items: [], limited: false };

  const candidates: ApiResultItem[] = [];

  // Scan a bounded source window before edition selection. MediathekViewWeb's
  // `id` hashes its full source row, so it is not a stable cursor or release key.
  for (let offset = 0; offset < MAX_MEDIATHEK_CANDIDATES; offset += MEDIATHEK_VIEW_MAX_PAGE_SIZE) {
    const pageSize = Math.min(MEDIATHEK_VIEW_MAX_PAGE_SIZE, MAX_MEDIATHEK_CANDIDATES - offset);
    const page = await queryMediathekView(queries, pageSize, { ...options, offset });
    if (page === null || page.length > pageSize) {
      recordDecision("catalogue", offset > 0 ? "followup_failed" : "source_failed", "unavailable");
      return null;
    }

    candidates.push(...page);
    if (page.length < pageSize) return { items: candidates, limited: false };
  }

  // This is intentionally a bounded candidate set, not a claim that the provider
  // catalog or all matching releases have been exhausted.
  return { items: candidates, limited: true };
}

export async function getConfiguredLanguagePolicy() {
  return readLanguagePolicy(await getSetting(LANGUAGE_POLICY_SETTING_KEY));
}

/**
 * One bounded source window for GUI and indexer consumers. The GUI may explain
 * partial sources; automatic matching must use queryContent's fail-closed wrapper.
 */
export async function queryContentWindow(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {},
  providerId?: SearchProviderId
): Promise<ContentSearchWindow> {
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
  const mvEnabled = (!providerId || providerId === "mediathekview") && mvSetting !== "false";
  const orfEnabled =
    (!providerId || providerId === "orf") && orfSetting === "true" && hlsSetting === "true";
  // This scope cannot publish HLS/SRF references; avoid spending its bounded
  // Sonarr budget on sources whose only renditions are currently ineligible.
  const srfEnabled =
    (!providerId || providerId === "srf") &&
    !options.progressiveOnly &&
    (await srfProvider.isEnabled());

  try {
    const [indexedResult, swissResult] = await Promise.allSettled([
      mvEnabled || orfEnabled
        ? queryMediathekCandidateWindow(
            !mvEnabled && orfEnabled
              ? [...queries, { fields: ["channel"], query: "ORF" }]
              : queries,
            size,
            { ...options, deadlineAt }
          )
        : Promise.resolve({ items: [], limited: false }),
      srfEnabled && size > 0
        ? srfProvider.search({
            query: queries.find((q) => q.fields.includes("topic"))?.query || "",
            limit: Math.min(size, 100),
            requestBudget: options.requestBudget,
            deadlineAt,
          })
        : Promise.resolve([]),
    ]);
    // Never publish earlier pages of a failed source as complete candidates.
    const indexed = indexedResult.status === "fulfilled" ? indexedResult.value : null;
    const swiss = swissResult.status === "fulfilled" ? swissResult.value : null;
    const sources: ContentSearchWindow["coverage"]["sources"] = (
      ["mediathekview", "orf", "srf"] as const
    )
      .filter((id) => !providerId || id === providerId)
      .map((id) => {
        const enabled = id === "mediathekview" ? mvEnabled : id === "orf" ? orfEnabled : srfEnabled;
        const candidates =
          id === "srf"
            ? swiss
            : indexed?.items.filter((item) => /^ORF\b/i.test(item.channel) === (id === "orf"));
        return {
          providerId: id,
          state: !enabled
            ? "disabled"
            : candidates === null || candidates === undefined
              ? "failed"
              : "complete",
          candidateCount: enabled ? (candidates?.length ?? 0) : 0,
        };
      });
    const items = (indexed?.items ?? []).filter((item) =>
      /^ORF\b/i.test(item.channel) ? orfEnabled : mvEnabled
    );
    for (const item of swiss ?? []) {
      const converted = providerItemToApiResult(item);
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
    const complete = sources.every((source) => source.state !== "failed") && editions !== null;
    const available = (editions ?? []).map((item) =>
      eligibleRenditionItem(item, hlsSetting === "true")
    );
    for (const item of available)
      recordDecision(
        "language",
        item.audioLanguage ? "language_verified" : "language_unknown",
        item.audioLanguage ? "proven" : "missing"
      );
    for (const source of sources) {
      if (source.state === "failed") recordDecision("catalogue", "source_failed", "unavailable");
      else if (source.state === "complete")
        recordDecision(
          "catalogue",
          source.candidateCount ? "catalogue_candidates" : "catalogue_empty",
          "proven",
          source.candidateCount || 1
        );
    }
    if (sources.every((source) => source.state === "disabled"))
      recordDecision("catalogue", "sources_disabled", "not_required");
    if (indexed?.limited || (srfEnabled && size > 0 && (swiss?.length ?? 0) >= Math.min(size, 100)))
      recordDecision("catalogue", "window_limited", "missing");
    return {
      items:
        editions === null
          ? []
          : options.deferLanguageSelection
            ? available
            : selectLanguageVariants(available, languagePolicy),
      coverage: {
        complete,
        candidateWindowLimited:
          indexed?.limited === true ||
          (srfEnabled && size > 0 && (swiss?.length ?? 0) >= Math.min(size, 100)),
        sources,
      },
    };
  } catch {
    console.error("[ContentSearch] Provider failed");
    // Configuration/edition failures are not a successful empty catalogue.
    throw new Error("Content source unavailable");
  }
}

async function queryContentUncoalesced(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
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
