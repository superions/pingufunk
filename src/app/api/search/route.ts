import { NextRequest, NextResponse } from "next/server";
import { getCategoriesForTopics, type CategoryType } from "@/services/category";
import { getMinDurationSeconds, getSetting, withSettingsSnapshot } from "@/lib/settings";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import {
  getConfiguredLanguagePolicy,
  queryContentWindow,
  type SearchProviderId,
} from "@/services/content-search";
import { selectLanguageVariants } from "@/services/language-editions";
import { eligibleRenditionItem, selectRenditions } from "@/services/rendition-quality";
import { createUiNzbDownloads, uiNzbFingerprints } from "@/services/ui-nzb";
import type { ApiResultItem, UiNzbDownloads, UiSearchCoverage } from "@/types";
import { recordDecision, withDecisionDiagnostics } from "@/server/decision-diagnostics";

export interface SearchResult {
  id: string;
  channel: string;
  topic: string;
  title: string;
  description: string;
  timestamp: number;
  duration: number;
  size: number;
  url_video: string;
  url_video_hd: string;
  url_video_low: string;
  url_website: string;
  category?: CategoryType;
  providerId?: SearchProviderId;
  nzbDownloads: UiNzbDownloads;
  nzbFingerprints: UiNzbDownloads;
}

const PROVIDERS = ["mediathekview", "orf", "srf"] as const;
const MAX_QUERY_LENGTH = 256;
const MAX_GUI_RESULTS = 100;

function itemProvider(item: ApiResultItem): SearchProviderId {
  return /^ORF\b/i.test(item.channel)
    ? "orf"
    : item.sourceProviderId === "srf"
      ? "srf"
      : "mediathekview";
}

function searchResult(
  item: ApiResultItem,
  hlsEnabled: boolean,
  providerForm: boolean,
  category?: CategoryType
): SearchResult {
  const defaultId = `${item.channel}-${item.topic}-${item.title}-${item.filmlisteTimestamp}`;
  const nzbDownloads = createUiNzbDownloads(item, hlsEnabled);
  return {
    // The two shipped forms retain their IDs; neither source-row hashes nor
    // better rendition facts manufacture a new GUI identity.
    id: providerForm && itemProvider(item) === "srf" ? (item.id ?? defaultId) : defaultId,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    timestamp: item.filmlisteTimestamp,
    duration: item.duration,
    size: item.size,
    url_video: item.url_video,
    url_video_hd: item.url_video_hd,
    url_video_low: item.url_video_low,
    url_website: item.url_website,
    category,
    ...(providerForm ? { providerId: itemProvider(item) } : {}),
    nzbDownloads,
    nzbFingerprints: uiNzbFingerprints(nzbDownloads),
  };
}

export async function GET(request: NextRequest) {
  const { result, report } = await withDecisionDiagnostics(() => handleSearchRequest(request));
  result.headers.set("X-Pingufunk-Diagnostic-Id", report.correlationId);
  return result;
}

async function handleSearchRequest(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const q = params.get("q")?.trim() ?? "";
  const rawLimit = params.get("limit") ?? "50";
  const type = params.get("type");
  const provider = params.get("provider");
  const rawProviders = params.get("providers");
  if (!q || q.length < 2) {
    recordDecision("request", "request_invalid", "conflicting");
    return NextResponse.json({ results: [], error: "Query too short" });
  }
  if (
    q.length > MAX_QUERY_LENGTH ||
    /[\x00-\x1f\x7f]/.test(params.get("q") ?? "") ||
    ["q", "limit", "type", "provider", "providers"].some((key) => params.getAll(key).length > 1) ||
    !/^\d{1,3}$/.test(rawLimit) ||
    Number(rawLimit) < 1 ||
    Number(rawLimit) > MAX_GUI_RESULTS ||
    (type !== null && !["all", "movie", "series"].includes(type)) ||
    (provider !== null && !PROVIDERS.includes(provider as SearchProviderId)) ||
    (rawProviders !== null && rawProviders !== "true" && rawProviders !== "false")
  ) {
    recordDecision("request", "request_invalid", "conflicting");
    return NextResponse.json({ results: [], error: "Invalid search parameters" }, { status: 400 });
  }

  try {
    return await withSettingsSnapshot(async () => {
      const limit = Number(rawLimit);
      // All selected sources and retries share the same attempts and wallclock.
      // Generic browsing never borrows the larger explicit TV identity budget.
      const requestBudget = new HttpRequestBudget();
      const hlsEnabled = (await getSetting("download.enableHLS")) === "true";
      const minDuration = type === "movie" ? await getMinDurationSeconds() : 0;
      const window = await queryContentWindow(
        [{ fields: ["topic", "title"], query: q }],
        100,
        { requestBudget, deferLanguageSelection: true },
        (provider as SearchProviderId | null) ?? undefined
      );
      // Eligibility precedes edition dedupe and the UI result limit. One HLS
      // slot cannot hide an independent MP4 slot or fill an absent HD slot.
      const eligible = selectLanguageVariants(
        window.items
          .map((item) => eligibleRenditionItem(item, hlsEnabled))
          .filter(
            (item) =>
              item.duration >= minDuration && selectRenditions(item, "all", hlsEnabled).length > 0
          ),
        await getConfiguredLanguagePolicy()
      ).sort((a, b) => b.filmlisteTimestamp - a.filmlisteTimestamp);
      const coverage: UiSearchCoverage = {
        ...window.coverage,
        eligibleCount: eligible.length,
        returnedCount: Math.min(limit, eligible.length),
        resultLimitReached: eligible.length > limit,
      };
      const selected = eligible.slice(0, limit);
      const categories = await getCategoriesForTopics([
        ...new Set(selected.map((item) => item.topic)),
      ]);
      const providerForm = rawProviders === "true" || provider !== null;
      const results = selected.map((item) =>
        searchResult(item, hlsEnabled, providerForm, categories.get(item.topic))
      );
      const errors = window.coverage.sources
        .filter((source) => source.state === "failed")
        .map(({ providerId }) => ({ providerId, error: "Provider search failed" }));
      const allFailed =
        errors.length > 0 && window.coverage.sources.every((source) => source.state !== "complete");
      return NextResponse.json(
        {
          results,
          coverage,
          ...(providerForm
            ? {
                providerCounts: Object.fromEntries(
                  PROVIDERS.filter((id) => provider === null || id === provider).map((id) => [
                    id,
                    eligible.filter((item) => itemProvider(item) === id).length,
                  ])
                ),
              }
            : {}),
          ...(errors.length ? { errors } : {}),
          ...(allFailed ? { error: "Provider search failed" } : {}),
        },
        { status: allFailed ? 502 : 200, headers: { "Cache-Control": "no-store" } }
      );
    });
  } catch {
    recordDecision("request", "request_failed", "unavailable");
    return NextResponse.json(
      { results: [], error: "Search temporarily unavailable" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
