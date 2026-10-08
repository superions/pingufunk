import {
  cacheMetadataMiss,
  coalesceMetadata,
  hasMetadataMiss,
  metadataCacheKey,
  tvdbCache,
} from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import type { HttpRequestBudget } from "@/lib/fetch-retry";
import { ProviderResponseError, readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { z } from "zod";
import { getSetting } from "@/lib/settings";
import type { TvdbData, TvdbEpisode, TmdbMovieData } from "@/types";

const TMDB_API_URL = "https://api.themoviedb.org/3";

async function getApiKey(): Promise<string | null> {
  const token = await getSetting("api.tmdb.key");
  // Legacy v3 API keys require a URL query parameter. Only read-access
  // bearer tokens may be used across this server-side credential boundary.
  return token?.startsWith("eyJ") ? token : null;
}

function getAuthHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };
}

function getApiUrl(endpoint: string): string {
  return `${TMDB_API_URL}${endpoint}`;
}

export async function getShowInfoByTvdbId(
  tvdbId: number,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    return null;
  }

  const cacheKey = metadataCacheKey("tmdb-series", tvdbId, apiKey);
  const cached = tvdbCache.get(cacheKey);
  if (cached && "episodes" in cached) {
    return cached;
  }

  if (hasMetadataMiss(cacheKey)) return null;
  if (budget) return fetchAndCacheSeriesData(tvdbId, apiKey, cacheKey, budget);
  return coalesceMetadata(cacheKey, () => fetchAndCacheSeriesData(tvdbId, apiKey, cacheKey)).catch(
    () => null
  );
}

async function fetchAndCacheSeriesData(
  tvdbId: number,
  apiKey: string,
  cacheKey: string,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  try {
    console.log(`[TMDB] Looking up TVDB ID ${tvdbId}`);
    const headers = getAuthHeaders(apiKey);
    const findUrl = getApiUrl(`/find/${tvdbId}?external_source=tvdb_id`);

    const findResponse = await fetchWithRetry(findUrl, { headers }, { requestBudget: budget });

    if (!findResponse.ok) {
      void findResponse.body?.cancel().catch(() => {});
      console.error(`[TMDB] Find request failed: ${findResponse.status}`);
      throw new ProviderResponseError();
    }

    const findData = z
      .object({
        tv_results: z
          .array(z.object({ id: z.number().int().positive(), name: z.string().optional() }))
          .max(1000),
      })
      .parse(
        await readBoundedProviderJson(
          findResponse,
          budget?.deadlineAt ?? Date.now() + 15_000,
          1024 * 1024
        )
      );
    return await processShowData(tvdbId, findData, apiKey, cacheKey, budget);
  } catch {
    console.error("[TMDB] Error fetching data");
    if (budget) throw new ProviderResponseError();
    return null;
  }
}

async function processShowData(
  tvdbId: number,
  findData: { tv_results: Array<{ id: number; name?: string }> },
  apiKey: string,
  cacheKey: string,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  if (!Array.isArray(findData.tv_results)) return null;
  if (findData.tv_results.length === 0) {
    console.log(`[TMDB] No show found for TVDB ID ${tvdbId}`);
    cacheMetadataMiss(cacheKey);
    return null;
  }
  if (findData.tv_results.length !== 1) throw new ProviderResponseError();

  const tmdbShow = findData.tv_results[0];
  const tmdbId = tmdbShow.id;
  console.log(`[TMDB] Found show: "${tmdbShow.name}" (TMDB ID: ${tmdbId})`);

  const headers = getAuthHeaders(apiKey);
  const detailsUrl = getApiUrl(`/tv/${tmdbId}?append_to_response=translations`);
  const detailsResponse = await fetchWithRetry(detailsUrl, { headers }, { requestBudget: budget });

  if (!detailsResponse.ok) {
    void detailsResponse.body?.cancel().catch(() => {});
    console.error(`[TMDB] Details request failed: ${detailsResponse.status}`);
    throw new ProviderResponseError();
  }

  const details = z
    .object({
      id: z.number().int().positive(),
      name: z.string().min(1).max(500),
      original_name: z.string().max(500).optional(),
      seasons: z.array(z.object({ season_number: z.number().int().nonnegative() })).max(1000),
      translations: z
        .object({
          translations: z
            .array(
              z.object({
                iso_639_1: z.string(),
                data: z.object({ name: z.string().max(500).optional() }),
              })
            )
            .max(1000),
        })
        .optional(),
    })
    .parse(
      await readBoundedProviderJson(
        detailsResponse,
        budget?.deadlineAt ?? Date.now() + 15_000,
        5 * 1024 * 1024
      )
    );
  if (details.id !== tmdbId) throw new ProviderResponseError();

  // Prefer a real TMDB "de" translation; but when none is populated (common -
  // translations aren't always filled in), fall back to original_name rather
  // than the English-localized `name`. For German/Austrian-origin shows
  // original_name already IS the German title, and it's what actually shows
  // up in MediathekView's search index - `name` here can be a wholly
  // different English title (e.g. SOKO Kitzbühel -> "Murder in the
  // Mountains"), which then fails every downstream Mediathek/provider search.
  let germanName = details.original_name || details.name;
  if (details.translations?.translations) {
    const germanTranslation = details.translations.translations.find((t) => t.iso_639_1 === "de");
    if (germanTranslation?.data?.name) {
      germanName = germanTranslation.data.name;
    }
  }
  console.log(`[TMDB] German name: "${germanName}"`);

  const episodes: TvdbEpisode[] = [];

  for (const season of details.seasons) {
    if (season.season_number === 0) continue;

    try {
      const seasonUrl = getApiUrl(`/tv/${tmdbId}/season/${season.season_number}?language=de-DE`);
      const seasonResponse = await fetchWithRetry(
        seasonUrl,
        { headers },
        { requestBudget: budget }
      );

      if (!seasonResponse.ok) {
        void seasonResponse.body?.cancel().catch(() => {});
        throw new ProviderResponseError();
      }
      const seasonData = z
        .object({
          episodes: z
            .array(
              z.object({
                name: z.string().nullable().optional(),
                season_number: z.number().int().nonnegative(),
                episode_number: z.number().int().nonnegative(),
                air_date: z.string().nullable().optional(),
                runtime: z.number().finite().nonnegative().nullable().optional(),
              })
            )
            .max(100_000),
        })
        .parse(
          await readBoundedProviderJson(
            seasonResponse,
            budget?.deadlineAt ?? Date.now() + 15_000,
            5 * 1024 * 1024
          )
        );

      for (const ep of seasonData.episodes) {
        if (ep.season_number !== season.season_number) throw new ProviderResponseError();
        episodes.push({
          name: ep.name || "",
          aired: ep.air_date ? new Date(ep.air_date) : null,
          runtime: ep.runtime || null,
          seasonNumber: ep.season_number,
          episodeNumber: ep.episode_number,
        });
      }
    } catch {
      console.error(`[TMDB] Error fetching season ${season.season_number}`);
      if (budget) throw new ProviderResponseError();
      return null;
    }
  }

  console.log(`[TMDB] Loaded ${episodes.length} episodes for "${details.name}"`);

  const tvdbData: TvdbData = {
    id: tvdbId,
    name: details.name,
    germanName: germanName,
    aliases: [],
    episodes: episodes,
  };

  tvdbCache.set(cacheKey, tvdbData);

  return tvdbData;
}

// ============== MOVIE FUNCTIONS ==============

interface TmdbMovieDetails {
  id: number;
  imdb_id: string | null;
  title: string;
  original_title: string;
  runtime: number | null;
  release_date: string | null;
}

/**
 * Get movie info by TMDB ID
 * Uses German locale to get German title
 */
export async function getMovieInfoByTmdbId(
  tmdbId: number,
  budget?: HttpRequestBudget
): Promise<TmdbMovieData | null> {
  if (!tmdbId) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = metadataCacheKey("tmdb-movie", tmdbId, apiKey);
  const cached = tvdbCache.get(cacheKey);
  if (cached && "tmdbId" in cached) {
    console.log(`[TMDB] Movie cache hit for TMDB ID ${tmdbId}`);
    return cached;
  }

  if (hasMetadataMiss(cacheKey)) return null;

  // A caller-owned search must not inherit another operation's remaining budget.
  if (budget) return fetchAndCacheMovie(tmdbId, apiKey, cacheKey, budget);
  return coalesceMetadata(cacheKey, () => fetchAndCacheMovie(tmdbId, apiKey, cacheKey)).catch(
    () => null
  );
}

async function fetchAndCacheMovie(
  tmdbId: number,
  apiKey: string,
  cacheKey: string,
  budget?: HttpRequestBudget
): Promise<TmdbMovieData | null> {
  try {
    console.log(`[TMDB] Looking up movie by TMDB ID ${tmdbId}`);
    const headers = getAuthHeaders(apiKey);

    // First get the original movie details (for runtime and imdb_id)
    const detailsUrl = getApiUrl(`/movie/${tmdbId}`);
    const detailsResponse = await fetchWithRetry(
      detailsUrl,
      { headers },
      { requestBudget: budget }
    );

    if (!detailsResponse.ok) {
      console.error(`[TMDB] Movie details request failed: ${detailsResponse.status}`);
      void detailsResponse.body?.cancel().catch(() => {});
      if (detailsResponse.status === 404) {
        cacheMetadataMiss(cacheKey);
        return null;
      }
      throw new ProviderResponseError();
    }

    const details = parseTmdbMovieDetails(
      await readBoundedProviderJson(
        detailsResponse,
        budget?.deadlineAt ?? Date.now() + 15_000,
        1024 * 1024
      )
    );
    if (details.id !== tmdbId) throw new ProviderResponseError();

    // Now get the German title
    const germanUrl = getApiUrl(`/movie/${tmdbId}?language=de-DE`);
    const germanResponse = await fetchWithRetry(germanUrl, { headers }, { requestBudget: budget });

    if (!germanResponse.ok) {
      void germanResponse.body?.cancel().catch(() => {});
      throw new ProviderResponseError();
    }
    const germanDetails = parseTmdbMovieDetails(
      await readBoundedProviderJson(
        germanResponse,
        budget?.deadlineAt ?? Date.now() + 15_000,
        1024 * 1024
      )
    );
    if (
      germanDetails.id !== tmdbId ||
      germanDetails.release_date !== details.release_date ||
      germanDetails.imdb_id !== details.imdb_id
    )
      throw new ProviderResponseError();
    const germanTitle = germanDetails.title || details.title;

    const movieData: TmdbMovieData = {
      tmdbId: details.id,
      imdbId: details.imdb_id,
      title: details.original_title || details.title,
      germanTitle: germanTitle,
      runtime: details.runtime,
      releaseDate: details.release_date,
    };

    console.log(
      `[TMDB] Found movie: "${movieData.title}" (German: "${movieData.germanTitle}"), runtime: ${movieData.runtime} min`
    );

    // Cache using metadata TTL
    tvdbCache.set(cacheKey, movieData);

    return movieData;
  } catch {
    console.error("[TMDB] Error fetching movie data");
    if (budget) throw new ProviderResponseError();
    return null;
  }
}

function parseTmdbMovieDetails(payload: unknown): TmdbMovieDetails {
  const parsed = z
    .object({
      id: z.number().int().positive().max(2_147_483_647),
      imdb_id: z
        .string()
        .regex(/^tt\d{7,10}$/)
        .nullable(),
      title: z.string().trim().min(1).max(500),
      original_title: z.string().trim().min(1).max(500),
      runtime: z.number().int().nonnegative().max(100_000).nullable(),
      release_date: z
        .string()
        .regex(/^(?:\d{4}-\d{2}-\d{2})?$/)
        .nullable(),
    })
    .safeParse(payload);
  if (!parsed.success) throw new ProviderResponseError();
  return parsed.data;
}

interface TmdbSearchMovieResult {
  results: Array<{
    id: number;
    title: string;
    original_title: string;
    release_date: string;
  }>;
}

/**
 * Search for a movie by title (and optionally year)
 * Returns the best matching movie from TMDB
 */
export async function searchMovieByTitle(
  title: string,
  year?: number | null
): Promise<TmdbMovieData | null> {
  if (!title) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = metadataCacheKey("tmdb-movie-search", [title, year], apiKey);
  const cached = tvdbCache.get(cacheKey);
  if (cached && "tmdbId" in cached) {
    console.log(`[TMDB] Movie search cache hit for "${title}" (${year})`);
    return cached;
  }

  if (hasMetadataMiss(cacheKey)) return null;

  return coalesceMetadata(cacheKey, () =>
    fetchAndCacheMovieSearch(title, year, apiKey, cacheKey)
  ).catch(() => null);
}

async function fetchAndCacheMovieSearch(
  title: string,
  year: number | null | undefined,
  apiKey: string,
  cacheKey: string
): Promise<TmdbMovieData | null> {
  try {
    console.log(`[TMDB] Searching movie by title: "${title}"${year ? ` (${year})` : ""}`);
    const headers = getAuthHeaders(apiKey);

    // Search with German language preference
    let searchUrl = getApiUrl(`/search/movie?query=${encodeURIComponent(title)}&language=de-DE`);
    if (year) {
      searchUrl += `&year=${year}`;
    }

    const searchResponse = await fetchWithRetry(searchUrl, { headers });

    if (!searchResponse.ok) {
      console.error(`[TMDB] Movie search request failed: ${searchResponse.status}`);
      return null;
    }

    const searchData: TmdbSearchMovieResult = await searchResponse.json();

    if (!Array.isArray(searchData.results)) return null;
    if (searchData.results.length === 0) {
      console.log(`[TMDB] No movie found for "${title}"`);
      cacheMetadataMiss(cacheKey);
      return null;
    }

    // Get the first (best) match
    const tmdbId = searchData.results[0].id;
    console.log(`[TMDB] Found movie: "${searchData.results[0].title}" (TMDB ID: ${tmdbId})`);

    // Get full movie info
    const movieData = await getMovieInfoByTmdbId(tmdbId);

    if (movieData) {
      tvdbCache.set(cacheKey, movieData);
    }

    return movieData;
  } catch {
    console.error("[TMDB] Error searching movie");
    return null;
  }
}

/**
 * Get movie info by IMDB ID
 * Uses TMDB /find endpoint to resolve IMDB ID to TMDB ID
 */
export async function getMovieInfoByImdbId(
  imdbId: string,
  budget?: HttpRequestBudget
): Promise<TmdbMovieData | null> {
  if (!imdbId) {
    return null;
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return null;
  }

  // Check memory cache first
  const cacheKey = metadataCacheKey("tmdb-movie-imdb", imdbId, apiKey);
  const cached = tvdbCache.get(cacheKey);
  if (cached && "tmdbId" in cached) {
    console.log(`[TMDB] Movie cache hit for IMDB ID ${imdbId}`);
    return cached;
  }

  if (hasMetadataMiss(cacheKey)) return null;

  if (budget) return fetchAndCacheMovieByImdbId(imdbId, apiKey, cacheKey, budget);
  return coalesceMetadata(cacheKey, () =>
    fetchAndCacheMovieByImdbId(imdbId, apiKey, cacheKey)
  ).catch(() => null);
}

async function fetchAndCacheMovieByImdbId(
  imdbId: string,
  apiKey: string,
  cacheKey: string,
  budget?: HttpRequestBudget
): Promise<TmdbMovieData | null> {
  try {
    console.log(`[TMDB] Looking up movie by IMDB ID ${imdbId}`);
    const headers = getAuthHeaders(apiKey);

    // Use /find endpoint to resolve IMDB ID
    const findUrl = getApiUrl(`/find/${imdbId}?external_source=imdb_id`);
    const findResponse = await fetchWithRetry(findUrl, { headers }, { requestBudget: budget });

    if (!findResponse.ok) {
      console.error(`[TMDB] Find request failed: ${findResponse.status}`);
      void findResponse.body?.cancel().catch(() => {});
      throw new ProviderResponseError();
    }

    const parsed = z
      .object({
        movie_results: z
          .array(z.object({ id: z.number().int().positive().max(2_147_483_647) }))
          .max(100),
      })
      .safeParse(
        await readBoundedProviderJson(
          findResponse,
          budget?.deadlineAt ?? Date.now() + 15_000,
          1024 * 1024
        )
      );
    if (!parsed.success) throw new ProviderResponseError();
    const findData = parsed.data;

    if (!Array.isArray(findData.movie_results)) return null;
    if (findData.movie_results.length === 0) {
      console.log(`[TMDB] No movie found for IMDB ID ${imdbId}`);
      cacheMetadataMiss(cacheKey);
      return null;
    }

    if (findData.movie_results.length !== 1) throw new ProviderResponseError();
    const tmdbId = findData.movie_results[0].id;
    console.log(`[TMDB] Resolved IMDB ID ${imdbId} to TMDB ID ${tmdbId}`);

    // Now get the full movie info using the TMDB ID
    const movieData = await getMovieInfoByTmdbId(tmdbId, budget);
    if (movieData && movieData.imdbId !== imdbId) throw new ProviderResponseError();

    if (movieData) {
      // Also cache under the IMDB ID
      tvdbCache.set(cacheKey, movieData);
    }

    return movieData;
  } catch {
    console.error("[TMDB] Error resolving IMDB ID");
    if (budget) throw new ProviderResponseError();
    return null;
  }
}

// ============== MULTI-SEARCH (for category detection) ==============

export interface TmdbMultiSearchResult {
  mediaType: "movie" | "tv" | "unknown";
  tmdbId: number | null;
}

interface TmdbMultiSearchResponse {
  results: Array<{
    id: number;
    media_type: "movie" | "tv" | "person";
    name?: string;
    title?: string;
  }>;
}

/**
 * Search TMDB with multi-search to determine if a topic is a movie or TV show
 * Returns the first matching result's media type
 */
export async function searchMulti(query: string): Promise<TmdbMultiSearchResult> {
  if (!query) {
    return { mediaType: "unknown", tmdbId: null };
  }

  const apiKey = await getApiKey();
  if (!apiKey) {
    console.error("[TMDB] No API key configured");
    return { mediaType: "unknown", tmdbId: null };
  }

  try {
    const headers = getAuthHeaders(apiKey);
    const searchUrl = getApiUrl(`/search/multi?query=${encodeURIComponent(query)}&language=de-DE`);

    const response = await fetchWithRetry(searchUrl, { headers });

    if (!response.ok) {
      console.error(`[TMDB] Multi-search request failed: ${response.status}`);
      return { mediaType: "unknown", tmdbId: null };
    }

    const data: TmdbMultiSearchResponse = await response.json();

    if (!data.results || data.results.length === 0) {
      console.log(`[TMDB] No results for multi-search: "${query}"`);
      return { mediaType: "unknown", tmdbId: null };
    }

    // Find first movie or TV result (skip person results)
    const mediaResult = data.results.find((r) => r.media_type === "movie" || r.media_type === "tv");

    if (!mediaResult) {
      return { mediaType: "unknown", tmdbId: null };
    }

    console.log(
      `[TMDB] Multi-search "${query}" -> ${mediaResult.media_type} (ID: ${mediaResult.id})`
    );

    return {
      mediaType: mediaResult.media_type as "movie" | "tv",
      tmdbId: mediaResult.id,
    };
  } catch {
    console.error("[TMDB] Error in multi-search");
    return { mediaType: "unknown", tmdbId: null };
  }
}
