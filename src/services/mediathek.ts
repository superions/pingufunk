import { cacheContextEpoch, mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import { getConfiguredLanguagePolicy, queryContent, searchCacheContext } from "./content-search";
import { enrichTvCandidates } from "./source-audio";
import { getBaseShowForSonarrRss } from "./shows";
import { getSonarrRssMatches } from "./sonarr-rss";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { SonarrUnavailableError } from "./sonarr-provider";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { createHash } from "node:crypto";
import { ensureRulesetsLoaded, getRulesetContext } from "./rulesets";
import {
  generateGenericRssItems,
  convertItemsToRss,
  serializeRss,
  getEmptyRssResult,
} from "./newznab";
import { matchMovieItems, movieSourceTitle, normalizeMovieTitle } from "./movie-matcher";
import { recordDecision } from "@/server/decision-diagnostics";

import { movieSearchTerms } from "./movie-search-terms";
import { tvSearchQueries, verifiedRuleTopics } from "./tv-search-terms";
import { getRadarrMonitoredMovies } from "./radarr-provider";
import type {
  ApiResultItem,
  TvdbData,
  TmdbMovieData,
  MatchedEpisodeInfo,
  NewznabItem,
  TvSearchContext,
} from "@/types";
import { applyRulesetFilters } from "./ruleset-matcher";
import { queryTvSearchCandidates, resolveArteCatalogueCandidates } from "./tv-search-candidates";
import {
  tvSearchContextKey,
  getDesiredEpisodes,
  hasEpisodeCoordinates,
  applyDesiredEpisodeFilter,
  matchesUnknownTvCandidate,
  matchesGenericSearchContext,
} from "./tv-search-matcher";
import {
  getQualityPreference,
  isHlsEnabled,
  SKIP_KEYWORDS,
  dedupeNewznabItems,
  assembleTvReleases,
  assembleMovieReleases,
  assembleRecentMovieReleases,
  assembleGenericMovieReleases,
} from "./mediathek-release";

const QUERY_FIELDS = ["topic", "title"];
const TV_SEARCH_CANDIDATE_LIMIT = 1500;
const RSS_SYNC_CANDIDATE_LIMIT = 6000;
const CONTENT_SEARCH_CACHE_VERSION = "v14-fresh-source-facts";

export async function fetchSearchResultsById(
  tvdbData: TvdbData,
  searchContext: TvSearchContext,
  limit: number,
  offset: number,
  requestBudget = new HttpRequestBudget(32)
): Promise<string> {
  const context: TvSearchContext = {
    ...searchContext,
    query: searchContext.query?.trim() || null,
    tvdbId: searchContext.tvdbId ?? tvdbData.id,
  };
  if (context.tvdbId !== tvdbData.id) return serializeRss(getEmptyRssResult(offset));

  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();
  const searchQuery = context.query || tvdbData.germanName || tvdbData.name;
  console.log(
    `[Mediathek] fetchSearchResultsById: tvdbId=${tvdbData.id}, name="${tvdbData.name}", germanName="${tvdbData.germanName}", season=${context.season}, episode=${context.episode}, quality=${quality}, minDuration=${minDuration}`
  );

  const contextKey = tvSearchContextKey(context);
  await ensureRulesetsLoaded(requestBudget);
  const rulesetContext = getRulesetContext();
  const sourceContext = await searchCacheContext();
  const metadataContext = createHash("sha256").update(JSON.stringify(tvdbData)).digest("hex");

  const desiredEpisodes = getDesiredEpisodes(tvdbData, context);
  console.log(`[Mediathek] Desired episodes: ${desiredEpisodes?.length ?? 0}`);
  if (hasEpisodeCoordinates(context) && desiredEpisodes?.length === 0) {
    if (tvdbData.sonarrUnavailable) throw new SonarrUnavailableError();
    console.log(
      `[Mediathek] No desired episodes found for season=${context.season}, episode=${context.episode}, returning empty`
    );
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  // Check for cached API response
  // Bound rule topics change retrieval itself, not only the final identity filter.
  const apiCacheKey = `mediathekapi_tvdb_arte-v1_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${sourceContext}_${metadataContext}_${rulesetContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi && cachedApi.results.length === 0) {
    console.log(`[Mediathek] Using cached API response for ${apiCacheKey}`);
    results = cachedApi.results;
  } else {
    console.log(`[Mediathek] Searching MediathekView API with query: "${searchQuery}"`);
    const supplemented = (desiredEpisodes ?? tvdbData.episodes).some(
      (episode) => episode.metadataSource === "sonarr"
    );
    const searchQueries = tvSearchQueries(
      tvdbData,
      searchQuery,
      desiredEpisodes?.length === 1 ? desiredEpisodes[0].name : undefined
    );
    const windows = await Promise.all(
      searchQueries.map((query) =>
        queryContent([query], TV_SEARCH_CANDIDATE_LIMIT, {
          arteSeries: tvdbData,
          deferLanguageSelection: true,
          ...(supplemented
            ? {
                requestBudget,
                progressiveOnly: (desiredEpisodes ?? tvdbData.episodes).every(
                  (episode) => episode.metadataSource === "sonarr"
                ),
              }
            : { requestBudget }),
        })
      )
    );
    results = windows.some((window) => window === null)
      ? null
      : [
          ...new Map(
            windows.flatMap((window) => window ?? []).map((item) => [JSON.stringify(item), item])
          ).values(),
        ];

    if (results === null) throw new Error("Search provider unavailable");
    if (results.length === 0) {
      return serializeRss(getEmptyRssResult(offset));
    }

    mediathekCache.set(apiCacheKey, { results });
  }

  console.log(`[Mediathek] API returned ${results.length} results`);
  if (results.length > 0) {
    const uniqueTopics = [...new Set(results.map((r) => r.topic))];
    console.log(
      `[Mediathek] Unique topics in results: ${uniqueTopics.slice(0, 10).join(", ")}${uniqueTopics.length > 10 ? ` ... (${uniqueTopics.length} total)` : ""}`
    );
  }

  const { matchedEpisodes, unmatchedItems } = await applyRulesetFilters(
    results,
    tvdbData,
    hlsEnabled,
    context.tvdbId,
    requestBudget
  );
  console.log(`[Mediathek] Matched episodes after ruleset filtering: ${matchedEpisodes.length}`);

  const tolerance = Number(
    configuredSetting(
      "matching.sonarr.tolerancePercent",
      await getSetting("matching.sonarr.tolerancePercent")
    )
  );
  const supplementalMatches = matchSonarrEpisodes(
    tvdbData,
    results,
    minDuration,
    tolerance,
    await getConfiguredLanguagePolicy(),
    hlsEnabled,
    true,
    verifiedRuleTopics(tvdbData)
  );
  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(
    [...matchedEpisodes, ...supplementalMatches],
    desiredEpisodes,
    context
  );
  console.log(`[Mediathek] Matched desired episodes: ${matchedDesiredEpisodes.length}`);

  const newznabItems = await assembleTvReleases(
    matchedDesiredEpisodes,
    requestBudget,
    quality,
    hlsEnabled
  );
  // The Sonarr matcher clones rows while removing ineligible URLs. Compare
  // source metadata, not object references or its sanitized rendition list.
  const supplementalSourceKey = (item: ApiResultItem) =>
    JSON.stringify({ ...item, url_video: "", url_video_low: "", url_video_hd: "" });
  const supplementalSources = new Set(
    supplementalMatches.map(({ item }) => supplementalSourceKey(item))
  );
  const sourceCandidates = (
    await enrichTvCandidates(
      unmatchedItems.filter(
        (item) =>
          !supplementalSources.has(supplementalSourceKey(item)) &&
          matchesUnknownTvCandidate(item, context, tvdbData)
      ),
      requestBudget,
      await getConfiguredLanguagePolicy(),
      quality,
      hlsEnabled
    )
  ).flatMap((item) => generateGenericRssItems(item, quality, hlsEnabled, "tv"));
  console.log(`[Mediathek] Generated ${newznabItems.length} Newznab items (quality: ${quality})`);

  const response = convertItemsToRss(
    dedupeNewznabItems([...newznabItems, ...sourceCandidates]),
    limit,
    offset
  );

  return response;
}

export async function fetchSearchResultsByString(
  searchContext: TvSearchContext,
  limit: number,
  offset: number,
  budget = new HttpRequestBudget(32)
): Promise<string> {
  const context: TvSearchContext = {
    ...searchContext,
    query: searchContext.query?.trim() || null,
  };
  const trimmedQ = context.query;
  await ensureRulesetsLoaded(budget);
  const quality = await getQualityPreference();
  const hlsEnabled = await isHlsEnabled();
  const contextKey = tvSearchContextKey(context);
  const sourceContext = await searchCacheContext();

  const apiCacheKey = `mediathekapi_q_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi && cachedApi.results.length === 0) {
    results = cachedApi.results;
  } else {
    results = await queryTvSearchCandidates(context, budget);
    if (results === null) {
      throw new Error("Search provider unavailable");
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  results = await resolveArteCatalogueCandidates(results, budget);
  if (results === null) throw new Error("Search provider unavailable");
  const { matchedEpisodes, unmatchedItems } = await applyRulesetFilters(
    results,
    undefined,
    hlsEnabled,
    context.tvdbId,
    budget
  );
  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(matchedEpisodes, null, context);
  const newznabItems = await assembleTvReleases(
    matchedDesiredEpisodes,
    budget,
    quality,
    hlsEnabled
  );

  // Coordinate-only candidates may span unrelated shows, so publish only items
  // tied to a ruleset unless the caller also supplied a text query.
  const hasTextQuery = !!trimmedQ;
  const enrichedCandidates = hasTextQuery
    ? await enrichTvCandidates(
        unmatchedItems.filter(
          (item) =>
            matchesGenericSearchContext(item, context) ||
            ((hasEpisodeCoordinates(context) || context.tvdbId !== null) &&
              matchesUnknownTvCandidate(item, context))
        ),
        budget,
        await getConfiguredLanguagePolicy(),
        quality,
        hlsEnabled
      )
    : [];
  const genericItems: NewznabItem[] = hasTextQuery
    ? enrichedCandidates
        .filter((item) => matchesGenericSearchContext(item, context))
        .flatMap((item) => generateGenericRssItems(item, quality, hlsEnabled))
    : [];
  const unknownCandidates =
    hasTextQuery && (hasEpisodeCoordinates(context) || context.tvdbId !== null)
      ? enrichedCandidates
          .filter((item) => matchesUnknownTvCandidate(item, context))
          .flatMap((item) => generateGenericRssItems(item, quality, hlsEnabled, "tv"))
      : [];

  const allItems = dedupeNewznabItems([...newznabItems, ...genericItems, ...unknownCandidates]);
  const response = convertItemsToRss(allItems, limit, offset);

  return response;
}

export async function fetchSearchResultsForRssSync(limit: number, offset: number): Promise<string> {
  const budget = new HttpRequestBudget();
  await ensureRulesetsLoaded(budget);
  const quality = await getQualityPreference();
  const hlsEnabled = await isHlsEnabled();
  const sourceContext = await searchCacheContext();
  // Reuse metadata goals, never an RSS body or cached signed media URL.
  let supplementalMatches: MatchedEpisodeInfo[] = [];
  let sonarrUnavailable = false;
  try {
    supplementalMatches = await getSonarrRssMatches(getBaseShowForSonarrRss, budget);
  } catch {
    sonarrUnavailable = true;
    recordDecision("catalogue", "source_failed", "unavailable");
  }

  const apiCacheKey = `rss_mediathekview_results_${CONTENT_SEARCH_CACHE_VERSION}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi && cachedApi.results.length === 0) {
    results = cachedApi.results;
  } else {
    // total below counts verified matches in this bounded source window only.
    results = await queryContent([], RSS_SYNC_CANDIDATE_LIMIT, {
      requestBudget: budget,
      deferLanguageSelection: true,
    });
    if (results === null) {
      throw new Error("Search provider unavailable");
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  results = await resolveArteCatalogueCandidates(results, budget);
  if (results === null) throw new Error("Search provider unavailable");
  const { matchedEpisodes } = await applyRulesetFilters(
    results,
    undefined,
    hlsEnabled,
    null,
    budget
  );
  if (sonarrUnavailable && matchedEpisodes.length === 0) throw new SonarrUnavailableError();
  const newznabItems = await assembleTvReleases(
    [...matchedEpisodes, ...supplementalMatches],
    budget,
    quality,
    hlsEnabled,
    false
  );
  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);

  return response;
}

// ============== MOVIE SEARCH FUNCTIONS ==============

/**
 * Recent film candidates need actual film goals. Without optional Radarr context
 * an empty feed is honest; broadcasting all unrelated long videos is not.
 */
export async function fetchMovieSearchForRssSync(
  limit: number,
  offset: number,
  budget = new HttpRequestBudget()
): Promise<string> {
  const epoch = cacheContextEpoch();
  const movies = await getRadarrMonitoredMovies(budget);
  if (movies.length === 0) return serializeRss(getEmptyRssResult(offset));
  const quality = await getQualityPreference();
  const minimum = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();
  const sourceContext = await searchCacheContext();
  // A minute-scoped source window cannot be kept stale by the usual hour TTL.
  const window = Math.floor(Date.now() / 60_000);
  const key = JSON.stringify(["movie-recent", CONTENT_SEARCH_CACHE_VERSION, window, sourceContext]);
  const cached = mediathekCache.get(key);
  let sources: ApiResultItem[];
  if (cached && cached.results.length === 0) sources = cached.results;
  else {
    const fetched = await queryContent([], RSS_SYNC_CANDIDATE_LIMIT, {
      requestBudget: budget,
      deferLanguageSelection: true,
    });
    if (fetched === null) throw new Error("Search provider unavailable");
    sources = fetched;
  }
  const eligible = sources.filter(
    (item) => !SKIP_KEYWORDS.some((word) => item.title.includes(word))
  );
  // Recent publishes exact source-title/alias candidates only. Index them once
  // instead of parsing every source again for every film in a large library.
  const byTitle = new Map<string, ApiResultItem[]>();
  for (const item of eligible) {
    const title = normalizeMovieTitle(movieSourceTitle(item.title).title);
    const bucket = byTitle.get(title);
    if (bucket) bucket.push(item);
    else byTitle.set(title, [item]);
  }
  const matches: {
    match: Awaited<ReturnType<typeof matchMovieItems>>[number];
    movie: TmdbMovieData;
  }[] = [];
  for (const movie of movies) {
    if (Date.now() >= budget.deadlineAt || epoch !== cacheContextEpoch())
      throw new Error("Search provider unavailable");
    const candidates = new Set(
      [movie.title, movie.germanTitle, ...(movie.aliases ?? [])].flatMap(
        (title) => byTitle.get(normalizeMovieTitle(title)) ?? []
      )
    );
    if (candidates.size === 0) continue;
    // RSS has no search target available to the consumer. Do not turn broad
    // partial-title ranking into automatic recent-release announcements.
    matches.push(
      ...(await matchMovieItems([...candidates], movie, minimum, hlsEnabled))
        .filter(({ titleMatch }) => titleMatch === "exact")
        .map((match) => ({ match, movie }))
    );
  }
  const rss = convertItemsToRss(
    await assembleRecentMovieReleases(matches, budget, quality, hlsEnabled),
    limit,
    offset
  );
  if (Date.now() >= budget.deadlineAt || epoch !== cacheContextEpoch())
    throw new Error("Search provider unavailable");
  // Only definitive empty source windows may be cached after a complete snapshot.
  mediathekCache.set(key, { results: sources });
  return rss;
}

/**
 * Search for a movie in the Mediathek by TMDB data
 */
export async function fetchMovieSearchResults(
  movieData: TmdbMovieData,
  limit: number,
  offset: number,
  requestBudget = new HttpRequestBudget()
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();
  console.log(
    `[Mediathek] fetchMovieSearchResults: tmdbId=${movieData.tmdbId}, title="${movieData.title}", germanTitle="${movieData.germanTitle}", runtime=${movieData.runtime} min, quality=${quality}, minDuration=${minDuration}s`
  );

  const sourceContext = await searchCacheContext();

  // Search by German title and original title in parallel
  const searchTerms = movieSearchTerms([
    movieData.germanTitle,
    movieData.title,
    ...(movieData.aliases ?? []),
  ]);

  // Helper function to fetch results for a single search term
  async function fetchForTerm(searchTerm: string): Promise<ApiResultItem[] | null> {
    const apiCacheKey = `mediathekapi_movie_${CONTENT_SEARCH_CACHE_VERSION}_${searchTerm}_${sourceContext}`;
    const cachedApi = mediathekCache.get(apiCacheKey);

    if (cachedApi && cachedApi.results.length === 0) {
      console.log(`[Mediathek] Using cached API response for movie search: "${searchTerm}"`);
      return cachedApi.results;
    }

    console.log(`[Mediathek] Searching MediathekView API for movie: "${searchTerm}"`);
    // A broadcaster/topic bearing the film's name must not crowd the bounded
    // source window with unrelated programmes before exact-title matching.
    const results = await queryContent([{ fields: ["title"], query: searchTerm }], 500, {
      requestBudget,
      deferLanguageSelection: true,
    });
    if (results === null) return null;
    console.log(`[Mediathek] API returned ${results.length} results for "${searchTerm}"`);
    mediathekCache.set(apiCacheKey, { results });
    return results;
  }

  // Fetch all search terms in parallel
  const resultsPerTerm = await Promise.all(searchTerms.map(fetchForTerm));
  if (resultsPerTerm.some((results) => results === null)) {
    throw new Error("Search provider unavailable");
  }

  // Merge search terms before choosing the best edition and deduplicating media URLs.
  const collectedResults: ApiResultItem[] = [];
  for (const results of resultsPerTerm) {
    if (results === null) continue;
    collectedResults.push(...results);
  }
  const allResults = collectedResults;

  if (allResults.length === 0) {
    console.log(`[Mediathek] No results found for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  console.log(`[Mediathek] Total results for movie matching: ${allResults.length}`);

  // Filter out trailers and other non-movie content
  const filteredResults = allResults.filter(
    (item) => !SKIP_KEYWORDS.some((kw) => item.title.includes(kw))
  );
  console.log(`[Mediathek] Results after filtering: ${filteredResults.length}`);

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No results after filtering for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  // Match results against movie data
  const matchResults = await matchMovieItems(filteredResults, movieData, minDuration, hlsEnabled);

  if (matchResults.length === 0) {
    console.log(`[Mediathek] No matches found for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  const newznabItems = await assembleMovieReleases(
    matchResults,
    movieData,
    requestBudget,
    quality,
    hlsEnabled
  );

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie (quality: ${quality})`
  );

  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);
  return response;
}

/**
 * Search for movies in the Mediathek by query string (for Radarr text search)
 * A duration policy limits candidates; it does not prove their genre or identity.
 */
export async function fetchMovieSearchByQuery(
  query: string,
  limit: number,
  offset: number,
  requestBudget = new HttpRequestBudget()
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();

  // Strip trailing year from query (Radarr sends "Movie Title 2018")
  const cleanedQuery = query.replace(/\s+\d{4}$/, "").trim();
  const yearMatch = query.match(/\s+(\d{4})$/);
  const searchYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  console.log(
    `[Mediathek] fetchMovieSearchByQuery: query="${query}", cleanedQuery="${cleanedQuery}", year=${searchYear}, quality=${quality}, minDuration=${minDuration}s`
  );

  const sourceContext = await searchCacheContext();

  // Search Mediathek by query (without year)
  const apiCacheKey = `mediathekapi_movie_query_${CONTENT_SEARCH_CACHE_VERSION}_${cleanedQuery}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi && cachedApi.results.length === 0) {
    console.log(`[Mediathek] Using cached API response for movie query: "${cleanedQuery}"`);
    results = cachedApi.results;
  } else {
    console.log(`[Mediathek] Searching MediathekView API for movie query: "${cleanedQuery}"`);
    const pages = await Promise.all(
      movieSearchTerms([cleanedQuery]).map((term) =>
        queryContent([{ fields: QUERY_FIELDS, query: term }], 500, {
          requestBudget,
          deferLanguageSelection: true,
        })
      )
    );
    if (pages.some((page) => page === null)) {
      throw new Error("Search provider unavailable");
    }
    results = pages.flatMap((page) => page ?? []);
    console.log(
      `[Mediathek] API returned ${results.length} results for movie query "${cleanedQuery}"`
    );
    mediathekCache.set(apiCacheKey, { results });
  }

  if (results.length === 0) {
    console.log(`[Mediathek] No API response for movie query`);
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  // Filter trailers and apply the configured minimum duration. Each URL variant
  // is checked for HLS below so direct alternatives remain available.
  const filteredResults = results.filter((item) => {
    if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return false;
    if (minDuration > 0 && item.duration < minDuration) return false;
    return true;
  });

  console.log(
    `[Mediathek] Results after movie filtering (min ${minDuration}s): ${filteredResults.length}`
  );

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No movie results after filtering`);
    const response = serializeRss(getEmptyRssResult(offset));
    return response;
  }

  // The query year and optional metadata describe the search goal, not these
  // source videos. Do not stamp IDs or turn the broadcast timestamp into a year.
  const newznabItems = await assembleGenericMovieReleases(
    filteredResults,
    requestBudget,
    quality,
    hlsEnabled
  );

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie query (quality: ${quality})`
  );

  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);
  return response;
}
