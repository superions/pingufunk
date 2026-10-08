import { isRenditionAllowed } from "@/lib/stream-url";
import { getSetting } from "@/lib/settings";
import type { ApiResultItem, MatchedEpisodeInfo, NewznabItem, TmdbMovieData } from "@/types";
import type { QualityPreference } from "./newznab";
import { generateRssItems, generateGenericRssItems, generateMatchedMovieRssItems } from "./newznab";
import { getConfiguredLanguagePolicy } from "./content-search";
import { enrichTvMatches, enrichSourceAudio } from "./source-audio";
import { selectLanguageVariants } from "./language-editions";
import type { MovieMatchResult } from "./movie-matcher";
import type { HttpRequestBudget } from "@/lib/fetch-retry";
const VALID_QUALITIES: QualityPreference[] = ["all", "best", "1080p", "720p", "480p"];

/** Publishing policy and exact release dedupe, not a second identity matcher. */
export async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

export async function getQualityPreference(): Promise<QualityPreference> {
  const setting = await getSetting("download.quality");
  if (setting && VALID_QUALITIES.includes(setting as QualityPreference)) {
    return setting as QualityPreference;
  }
  return "all"; // Default to all qualities
}

// Keywords that are always skipped (trailers, outtakes, etc.)
export const SKIP_KEYWORDS = ["Trailer", "Outtakes:", "(klare Sprache)"];

export function shouldSkipItem(
  item: ApiResultItem,
  minDuration: number,
  hlsEnabled: boolean = false
): boolean {
  // Keep an item when any rendition is usable; generators apply this same gate
  // to each URL so a blocked HLS variant cannot discard or re-enter the feed.
  if (
    ![item.url_video, item.url_video_low, item.url_video_hd].some((url) =>
      isRenditionAllowed(url, hlsEnabled)
    )
  )
    return true;
  if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return true;
  if (minDuration > 0 && item.duration < minDuration) return true;
  return false;
}

export function dedupeNewznabItems(items: NewznabItem[]): NewznabItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    // Keep different URLs/qualities; remove only the same release emitted twice.
    const identity = JSON.stringify([item.guid.value, item.link, item.title]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

/** Source proof precedes serialization; explicit searches and RSS retain their distinct policy. */
export async function assembleTvReleases(
  matches: MatchedEpisodeInfo[],
  budget: HttpRequestBudget,
  quality: QualityPreference,
  hlsEnabled: boolean,
  explicitSearch = true
): Promise<NewznabItem[]> {
  const enriched = await enrichTvMatches(
    matches,
    budget,
    await getConfiguredLanguagePolicy(),
    quality,
    hlsEnabled,
    explicitSearch
  );
  return enriched.flatMap((info) => generateRssItems(info, quality, hlsEnabled));
}

export interface RecentMovieMatch {
  match: MovieMatchResult;
  movie: TmdbMovieData;
}

/** Exact matched owners survive source enrichment; conflicts serialize as neutral candidates. */
export async function assembleRecentMovieReleases(
  matches: RecentMovieMatch[],
  budget: HttpRequestBudget,
  quality: QualityPreference,
  hlsEnabled: boolean
): Promise<NewznabItem[]> {
  const owners = new Map<ApiResultItem, RecentMovieMatch[]>();
  for (const entry of matches)
    owners.set(entry.match.item, [...(owners.get(entry.match.item) ?? []), entry]);
  const editions = await enrichSourceAudio([...owners.keys()], budget);
  const editionOwners = new Map<ApiResultItem, RecentMovieMatch[]>();
  for (const [source, renditions] of editions)
    for (const item of renditions)
      editionOwners.set(
        item,
        owners.get(source)!.map((entry) => ({ ...entry, match: { ...entry.match, item } }))
      );
  const selected = selectLanguageVariants(
    [...editionOwners.keys()],
    await getConfiguredLanguagePolicy()
  );
  return dedupeNewznabItems(
    selected.flatMap((item) => {
      const entries = editionOwners.get(item)!;
      const verified = entries.filter(({ match }) => match.identityVerified);
      // Same-title remakes must not inherit whichever inventory entry was first.
      if (new Set(verified.map(({ movie }) => movie.tmdbId)).size !== 1)
        return generateGenericRssItems(item, quality, hlsEnabled, "movie");
      return generateMatchedMovieRssItems(
        verified[0].match,
        verified[0].movie,
        quality,
        hlsEnabled
      );
    })
  );
}

/** Match identity and current source editions are combined once before NZB/RSS serialization. */
export async function assembleMovieReleases(
  matchResults: MovieMatchResult[],
  movieData: TmdbMovieData,
  budget: HttpRequestBudget,
  quality: QualityPreference,
  hlsEnabled: boolean
): Promise<NewznabItem[]> {
  // Generate RSS items using the same rendition setting used for matching.
  const editions = await enrichSourceAudio(
    matchResults.map((match) => match.item),
    budget
  );
  const matchesByItem = new Map<ApiResultItem, (typeof matchResults)[number]>();
  for (const match of matchResults)
    for (const item of editions.get(match.item)!) matchesByItem.set(item, { ...match, item });
  const selected = selectLanguageVariants(
    [...matchesByItem.keys()],
    await getConfiguredLanguagePolicy()
  );
  return selected.flatMap((item) =>
    generateMatchedMovieRssItems(matchesByItem.get(item)!, movieData, quality, hlsEnabled)
  );
}

/** Text queries describe goals, not authoritative IDs, years or source language. */
export async function assembleGenericMovieReleases(
  candidates: ApiResultItem[],
  budget: HttpRequestBudget,
  quality: QualityPreference,
  hlsEnabled: boolean
): Promise<NewznabItem[]> {
  const editions = await enrichSourceAudio(candidates, budget);
  const selected = selectLanguageVariants(
    [...editions.values()].flat(),
    await getConfiguredLanguagePolicy()
  );
  return selected.flatMap((item) => generateGenericRssItems(item, quality, hlsEnabled, "movie"));
}
