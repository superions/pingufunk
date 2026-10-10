import { NextRequest, NextResponse } from "next/server";
import { getCategoriesForTopics, CategoryType } from "@/services/category";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { providerRegistry, initializeProviders } from "@/providers";
import type { ProviderContentItem } from "@/types/provider";

import { queryContent } from "@/services/content-search";
import { isStreamingUrl } from "@/lib/stream-url";
import { createUiNzbDownloads } from "@/services/ui-nzb";
import type { UiNzbDownloads } from "@/types";
import { searchTvSourceReviews } from "@/services/tv-source-review";

async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

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
  providerId?: string;
  nzbDownloads: UiNzbDownloads;
}

/**
 * Convert a ProviderContentItem to SearchResult format
 */
function providerItemToSearchResult(
  item: ProviderContentItem,
  hlsEnabled: boolean,
  category?: CategoryType
): SearchResult {
  return {
    id: item.id,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    timestamp: item.timestamp,
    duration: item.duration,
    size: item.size,
    url_video: item.videoUrls.standard,
    url_video_hd: item.videoUrls.high || item.videoUrls.standard,
    url_video_low: item.videoUrls.low || "",
    url_website: item.websiteUrl,
    category,
    providerId: item.providerId,
    nzbDownloads: createUiNzbDownloads(
      {
        ...item,
        filmlisteTimestamp: item.timestamp,
        url_website: item.websiteUrl,
        url_video: item.videoUrls.standard,
        url_video_hd: item.videoUrls.high || item.videoUrls.standard,
        url_video_low: item.videoUrls.low || "",
      },
      hlsEnabled
    ),
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q");
  const limit = parseInt(searchParams.get("limit") || "50", 10);
  const type = searchParams.get("type"); // "movie" for movies only
  const useProviders = searchParams.get("providers") === "true"; // Use provider system
  const providerId = searchParams.get("provider"); // Specific provider to search

  if (!q || q.trim().length < 2) {
    return NextResponse.json({ results: [], error: "Query too short" });
  }

  // UI searches and Newznab use the same enabled sources.
  if (!type || type === "series") {
    try {
      const bound = await searchTvSourceReviews(q);
      if (bound !== null) {
        // A provider selector cannot bypass an already verified series conflict.
        // This review follows the common enabled-source owner, not a separate indexer.
        if (providerId)
          return NextResponse.json(
            { results: [], error: "Für die Quellenprüfung bitte alle aktivierten Quellen wählen" },
            { status: 409 }
          );
        return NextResponse.json(
          {
            results: bound.slice(0, Math.min(limit, 100)).map(({ info, review }) => ({
              id: review.selector.sourceId,
              channel: info.item.channel,
              topic: info.item.topic,
              title: info.item.title,
              description: info.item.description,
              timestamp: info.item.filmlisteTimestamp,
              duration: info.item.duration,
              size: info.item.size,
              url_website: info.item.url_website,
              category: "tv",
              tvReview: review,
              nzbDownloads: review.runtimeConflict ? {} : createUiNzbDownloads(info.item, false),
            })),
          },
          { headers: { "Cache-Control": "no-store" } }
        );
      }
    } catch {
      // A bound but unverifiable series must not escape through generic source-only NZBs.
      return NextResponse.json(
        { results: [], error: "Serienquellen nicht eindeutig verifiziert" },
        { status: 502 }
      );
    }
  }
  if (useProviders || providerId) return handleProviderSearch(q, limit, type, providerId);
  return handleDefaultSearch(q, limit, type);
}

/**
 * Handle search using the provider system
 */
async function handleProviderSearch(
  q: string,
  limit: number,
  type: string | null,
  providerId: string | null
): Promise<NextResponse> {
  try {
    // Initialize providers if not already done
    await initializeProviders();

    const searchType = type === "movie" ? "movie" : type === "series" ? "series" : "all";

    let items: ProviderContentItem[];
    let providerCounts: Record<string, number> = {};
    let errors: Array<{ providerId: string; error: string }> = [];

    if (providerId) {
      // Search specific provider
      items = await providerRegistry.searchProvider(providerId, {
        query: q,
        limit,
        type: searchType,
      });
      providerCounts[providerId] = items.length;
    } else {
      // Search all enabled providers
      const result = await providerRegistry.searchAll({
        query: q,
        limit,
        type: searchType,
      });
      items = result.items;
      providerCounts = result.providerCounts;
      errors = result.errors;
    }

    // Collect unique topics for category lookup
    const topics = [...new Set(items.map((item) => item.topic))] as string[];
    const categoryMap = await getCategoriesForTopics(topics);

    // Convert to SearchResult format
    const hlsEnabled = await isHlsEnabled();
    const results: SearchResult[] = items.map((item) =>
      providerItemToSearchResult(item, hlsEnabled, categoryMap.get(item.topic))
    );

    return NextResponse.json({
      results,
      providerCounts,
      errors:
        errors.length > 0
          ? errors.map(({ providerId }) => ({ providerId, error: "Provider search failed" }))
          : undefined,
    });
  } catch {
    console.error("Provider search failed");
    return NextResponse.json({ results: [], error: "Search failed" }, { status: 500 });
  }
}

/**
 * Search enabled sources while preserving the UI response format
 */
async function handleDefaultSearch(
  q: string,
  limit: number,
  type: string | null
): Promise<NextResponse> {
  // Fetch more results than needed because accessibility filtering may remove many
  // For movie search: at least 3x limit or 150
  // For regular search: at least 3x limit to ensure enough results after filtering
  const fetchSize = type === "movie" ? Math.max(limit * 3, 150) : Math.max(limit * 3, 100);

  try {
    const items = await queryContent([{ fields: ["topic", "title"], query: q }], fetchSize);
    if (items === null) {
      return NextResponse.json({ results: [], error: "Provider search failed" }, { status: 502 });
    }

    // Filter out m3u8 streams (unless HLS enabled) and transform results
    // For movies: only items >= 60 minutes (3600 seconds)
    const minDuration = type === "movie" ? await getMinDurationSeconds() : 0;
    const hlsEnabled = await isHlsEnabled();

    const filteredItems = items
      .filter(
        (item: { url_video: string; duration: number }) =>
          (hlsEnabled || !isStreamingUrl(item.url_video)) && item.duration >= minDuration
      )
      .slice(0, limit);

    // Collect unique topics for category lookup
    const topics = [
      ...new Set(filteredItems.map((item: { topic: string }) => item.topic)),
    ] as string[];

    // Get categories for all topics
    const categoryMap = await getCategoriesForTopics(topics);

    const results: SearchResult[] = filteredItems.map((item) => ({
      id: `${item.channel}-${item.topic}-${item.title}-${item.filmlisteTimestamp}`,
      channel: item.channel,
      topic: item.topic,
      title: item.title,
      description: item.description,
      timestamp: item.filmlisteTimestamp,
      duration: item.duration,
      size: item.size,
      url_video: item.url_video,
      url_video_hd: item.url_video_hd || item.url_video,
      url_video_low: item.url_video_low || "",
      url_website: item.url_website,
      category: categoryMap.get(item.topic),
      nzbDownloads: createUiNzbDownloads(item, hlsEnabled),
    }));

    return NextResponse.json({ results });
  } catch {
    console.error("Search failed");
    return NextResponse.json({ results: [], error: "Search failed" }, { status: 500 });
  }
}
