/**
 * Shared MediathekViewWeb API client.
 *
 * Before this existed, the same "POST to mediathekviewweb.de/api/query,
 * parse `result.results`" logic was reimplemented independently in
 * services/mediathek.ts, services/ruleset-generator.ts, and
 * providers/mediathekview.ts - each with its own response-parsing types.
 * They drifted apart: ruleset-generator's copy read `data.results` instead
 * of the real `data.result.results`, silently returning empty for every
 * query and breaking ruleset auto-generation for every show. Consolidating
 * to one implementation removes that whole class of bug.
 */
import { fetchWithRetry, requestDeadline, type HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import type { ApiResultItem, MediathekApiResponse, TvdbData } from "@/types";

const MEDIATHEK_API_URL = "https://mediathekviewweb.de/api/query";
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;

// MediathekViewWeb caps every response page at 1,000 results; callers page with offset.
export const MEDIATHEK_VIEW_MAX_PAGE_SIZE = 1000;

export interface MediathekQueryField {
  fields: string[];
  query: string;
}

export interface MediathekQueryOptions {
  sortBy?: string;
  sortOrder?: "asc" | "desc";
  future?: boolean;
  offset?: number;
  deadlineAt?: number;
  requestBudget?: HttpRequestBudget;
  /** Sonarr fallback is progressive-only until the P09 HLS validation gate. */
  progressiveOnly?: boolean;
  /** Verified metadata owner; shared-topic ARTE editions are resolved before language selection. */
  arteSeries?: TvdbData;
  /** Internal catalogue owner must resolve verified editions before final selection. */
  deferLanguageSelection?: boolean;
}

/**
 * Query MediathekViewWeb and return the parsed result items.
 * Returns null on request, API, or parse failures so callers can avoid
 * caching an outage as a successful empty result.
 */
export async function queryMediathekView(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  const normalizedSize = Number.isFinite(size)
    ? Math.max(0, Math.min(Math.trunc(size), MEDIATHEK_VIEW_MAX_PAGE_SIZE))
    : 0;
  const normalizedOffset = Number.isFinite(options.offset)
    ? Math.max(0, Math.trunc(options.offset!))
    : 0;
  const requestBody = {
    queries,
    sortBy: options.sortBy ?? "filmlisteTimestamp",
    sortOrder: options.sortOrder ?? "desc",
    future: options.future ?? true,
    offset: normalizedOffset,
    size: normalizedSize,
  };
  const deadlineAt = requestDeadline({
    deadlineAt: options.deadlineAt,
    requestBudget: options.requestBudget,
  });

  try {
    const response = await fetchWithRetry(
      MEDIATHEK_API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
      { deadlineAt, requestBudget: options.requestBudget }
    );

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.error(`[MediathekClient] API request failed with status ${response.status}`);
      return null;
    }

    const parsed = (await readBoundedProviderJson(
      response,
      deadlineAt,
      MAX_RESPONSE_BYTES
    )) as MediathekApiResponse;
    if (parsed?.err || !Array.isArray(parsed?.result?.results)) {
      console.error("[MediathekClient] Invalid or unsuccessful API response");
      return null;
    }
    // HLS entries use null for an unknown byte size in the live API.
    const items = parsed.result.results.map((item) =>
      item && typeof item === "object" && item.size === null ? { ...item, size: 0 } : item
    );
    if (
      !items.every(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          [
            "channel",
            "topic",
            "title",
            "description",
            "url_website",
            "url_video",
            "url_video_low",
            "url_video_hd",
          ].every((key) => typeof item[key as keyof ApiResultItem] === "string") &&
          ["filmlisteTimestamp", "duration", "size"].every(
            (key) =>
              typeof item[key as keyof ApiResultItem] === "number" &&
              Number.isFinite(item[key as keyof ApiResultItem])
          )
      )
    ) {
      console.error("[MediathekClient] Invalid result item");
      return null;
    }
    // Keep this boundary aligned with the provider's Filmliste schema. In particular,
    // arbitrary response properties must not silently become audio-language evidence.
    return items.map((item) => ({
      ...(typeof item.id === "string" ? { id: item.id } : {}),
      channel: item.channel,
      topic: item.topic,
      title: item.title,
      description: item.description,
      filmlisteTimestamp: item.filmlisteTimestamp,
      duration: item.duration,
      size: item.size,
      url_website: item.url_website,
      url_video: item.url_video,
      url_video_low: item.url_video_low,
      url_video_hd: item.url_video_hd,
    }));
  } catch {
    // Error objects and provider bodies can contain access URLs or credentials.
    console.error("[MediathekClient] Provider request or response failed");
    return null;
  }
}
