import {
  MEDIATHEK_VIEW_MAX_PAGE_SIZE,
  queryMediathekView,
  type MediathekQueryField,
  type MediathekQueryOptions,
} from "@/lib/mediathek-client";
import { getSetting } from "@/lib/settings";
import { srfProvider } from "@/providers/srf";
import { resolveArteSeriesEditions } from "@/services/arte-editions";
import { providerItemToApiResult } from "@/providers/content-item";
import { recordDecision } from "@/server/decision-diagnostics";
import type { ApiResultItem } from "@/types";
import type { ContentSearchAdapter, ContentSearchWindow, SearchProviderId } from "@/types/provider";

const MAX_MEDIATHEK_CANDIDATES = 5000;
const PROVIDER_IDS = ["mediathekview", "orf", "srf"] as const;

async function queryMediathekCandidateWindow(
  queries: MediathekQueryField[],
  requestedSize: number,
  options: MediathekQueryOptions
): Promise<{ items: ApiResultItem[]; limited: boolean } | null> {
  if (requestedSize <= 0) return { items: [], limited: false };

  const candidates: ApiResultItem[] = [];

  // Scan a bounded source window before edition selection. MediathekViewWeb's
  // `id` hashes its full source row, so it is not a stable cursor or release key.
  const pages = options.maxCandidatePages;
  if (pages !== undefined && (!Number.isSafeInteger(pages) || pages < 1 || pages > 5))
    throw new Error("Invalid candidate window");
  const candidateLimit = Math.min(
    MAX_MEDIATHEK_CANDIDATES,
    (pages ?? 5) * MEDIATHEK_VIEW_MAX_PAGE_SIZE
  );
  for (let offset = 0; offset < candidateLimit; offset += MEDIATHEK_VIEW_MAX_PAGE_SIZE) {
    const pageSize = Math.min(MEDIATHEK_VIEW_MAX_PAGE_SIZE, candidateLimit - offset);
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

async function searchWindow(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {},
  hlsEnabled: boolean,
  providerId?: SearchProviderId
): Promise<ContentSearchWindow> {
  if (providerId !== undefined && !PROVIDER_IDS.some((id) => id === providerId))
    throw new Error("Unknown content source");
  const scope = providerId ? [providerId] : undefined;
  const [mvSetting, orfSetting] = await Promise.all([
    getSetting("provider.mediathekview.enabled"),
    getSetting("provider.orf.enabled"),
  ]);
  const mvEnabled = (!scope || scope.includes("mediathekview")) && mvSetting !== "false";
  const orfEnabled = (!scope || scope.includes("orf")) && orfSetting === "true" && hlsEnabled;
  // This scope cannot publish HLS/SRF references; avoid spending its bounded
  // Sonarr budget on sources whose only renditions are currently ineligible.
  const srfEnabled =
    (!scope || scope.includes("srf")) &&
    !options.progressiveOnly &&
    (await srfProvider.isEnabled());

  const deadlineAt = options.deadlineAt;
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
    const sources: ContentSearchWindow["coverage"]["sources"] = PROVIDER_IDS.filter(
      (id) => !scope || scope.includes(id)
    ).map((id) => {
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
      items: editions ?? [],
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

/** One Mediathek family: MVW and ORF share pages, SRF retains its own API contract. */
export const mediathekSearchAdapter: ContentSearchAdapter = {
  providerIds: PROVIDER_IDS,
  rssWindowAttempts: Math.ceil(MAX_MEDIATHEK_CANDIDATES / MEDIATHEK_VIEW_MAX_PAGE_SIZE),
  cacheSettingKeys: [
    "provider.mediathekview.enabled",
    "provider.orf.enabled",
    "provider.srf.enabled",
    "api.srgssr.consumerKey",
    "api.srgssr.consumerSecret",
  ],
  providerForItem: (item) =>
    /^ORF\b/i.test(item.channel)
      ? "orf"
      : item.sourceProviderId === "srf"
        ? "srf"
        : "mediathekview",
  searchWindow,
};

/** Preserve the single-page helper contract used by the existing provider classes. */
export async function queryProviderCatalogue(
  provider: "mediathekview" | "orf",
  query: import("@/types/provider").ProviderSearchQuery
): Promise<ApiResultItem[]> {
  if (provider !== "mediathekview" && provider !== "orf") throw new Error("Unknown content source");
  const term = query.query.trim();
  if (!term || term.length < 2) return [];
  const hls = (await getSetting("download.enableHLS")) === "true";
  const enabled = await getSetting(`provider.${provider}.enabled`);
  if (enabled === "false" || (provider === "orf" && (enabled !== "true" || !hls))) return [];
  const result = await queryMediathekView(
    [
      { fields: ["topic", "title"], query: term },
      ...(provider === "orf" ? [{ fields: ["channel"], query: "ORF" }] : []),
    ],
    (query.limit || (provider === "mediathekview" ? 100 : 50)) * 3,
    { requestBudget: query.requestBudget, deadlineAt: query.deadlineAt }
  );
  if (result === null) throw new Error("Provider search failed");
  return result;
}
