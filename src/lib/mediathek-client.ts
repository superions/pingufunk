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
import { fetchWithRetry, requestDeadline } from "@/lib/fetch-retry";
import type { ApiResultItem, MediathekApiResponse } from "@/types";

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
}

async function readBoundedJson(response: Response, deadlineAt: number): Promise<unknown> {
  const advertisedLength = Number(response.headers.get("content-length"));
  if (advertisedLength > MAX_RESPONSE_BYTES || !response.body) {
    throw new Error("Provider response exceeds size limit or has no body");
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) throw new Error("Provider response deadline exceeded");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          void reader.cancel().catch(() => {});
          reject(new Error("Provider response deadline exceeded"));
        }, remaining);
      });
      const next = await Promise.race([reader.read(), timeout]).finally(() => {
        if (timer) clearTimeout(timer);
      });
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("Provider response exceeds size limit");
      chunks.push(next.value);
    }
  } catch (error) {
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // A pending read can release its lock after cancellation settles.
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
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
  const deadlineAt = requestDeadline({ deadlineAt: options.deadlineAt });

  try {
    const response = await fetchWithRetry(
      MEDIATHEK_API_URL,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      },
      { deadlineAt }
    );

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.error(`[MediathekClient] API request failed with status ${response.status}`);
      return null;
    }

    const parsed = (await readBoundedJson(response, deadlineAt)) as MediathekApiResponse;
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
