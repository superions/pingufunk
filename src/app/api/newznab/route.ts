import { NextRequest, NextResponse } from "next/server";
import {
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
  fetchMovieSearchResults,
  fetchMovieSearchByQuery,
} from "@/services/mediathek";
import { getShowInfoByTvdbId } from "@/services/shows";
import { getMovieInfoByTmdbId, getMovieInfoByImdbId } from "@/services/tmdb";
import {
  serializeRss,
  getEmptyRssResult,
  getValidationRss,
  isMovieCategoryRequest,
  parseNewznabCategoryIds,
} from "@/services/newznab";
import type { TvSearchContext } from "@/types";

function normalizeEpisodeParameter(value: string | null): string | null {
  const trimmed = value?.trim() || null;
  if (trimmed === null) return null;
  if (/^\d+$/.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isSafeInteger(numeric)) return String(numeric);
  }
  const daily = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
  return daily ? `${Number(daily[1])}/${Number(daily[2])}` : trimmed;
}

function normalizeSeasonParameter(value: string | null): string | null {
  const trimmed = value?.trim() || null;
  if (trimmed === null || !/^\d+$/.test(trimmed)) return trimmed;
  const numeric = Number(trimmed);
  return Number.isSafeInteger(numeric) ? String(numeric) : trimmed;
}

function parseTvSearchContext(searchParams: URLSearchParams): {
  context: TvSearchContext | null;
  error: string | null;
} {
  const shortEpisode = normalizeEpisodeParameter(searchParams.get("ep"));
  const longEpisode = normalizeEpisodeParameter(searchParams.get("episode"));
  if (shortEpisode !== null && longEpisode !== null && shortEpisode !== longEpisode) {
    return { context: null, error: "Conflicting ep and episode parameters" };
  }

  const rawTvdbId = searchParams.get("tvdbid")?.trim() || null;
  let tvdbId: number | null = null;
  if (rawTvdbId !== null) {
    const parsedId = Number(rawTvdbId);
    if (!/^\d+$/.test(rawTvdbId) || !Number.isSafeInteger(parsedId) || parsedId <= 0) {
      return { context: null, error: "Invalid tvdbid parameter" };
    }
    tvdbId = parsedId;
  }

  return {
    context: {
      query: searchParams.get("q")?.trim() || null,
      tvdbId,
      season: normalizeSeasonParameter(searchParams.get("season")),
      episode: shortEpisode ?? longEpisode,
    },
    error: null,
  };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const t = searchParams.get("t");
  const limit = parseInt(searchParams.get("limit") || "100", 10);
  const offset = parseInt(searchParams.get("offset") || "0", 10);
  const q = searchParams.get("q");
  const imdbid = searchParams.get("imdbid");
  const tmdbid = searchParams.get("tmdbid");
  const categoryIds = parseNewznabCategoryIds(searchParams.get("cat"));

  // Handle capabilities request
  if (t === "caps") {
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
    <limits max="5000" default="5000"/>
    <registration available="no" open="no"/>
    <searching>
        <search available="yes" supportedParams="q"/>
        <tv-search available="yes" supportedParams="q,season,ep,tvdbid"/>
        <movie-search available="yes" supportedParams="q,tmdbid,imdbid"/>
        <audio-search available="no" supportedParams="" />
    </searching>
    <categories>
        <category id="2000" name="Movies">
            <subcat id="2040" name="HD"/>
            <subcat id="2030" name="SD"/>
        </category>
        <category id="5000" name="TV">
            <subcat id="5040" name="HD"/>
            <subcat id="5030" name="SD"/>
        </category>
    </categories>
</caps>`;

    return new NextResponse(xmlContent, {
      status: 200,
      headers: { "Content-Type": "application/xml; charset=utf-8" },
    });
  }

  // Handle movie search requests
  if (t === "movie") {
    console.log(
      `[Newznab] Movie search request: t=${t}, q=${q}, tmdbid=${tmdbid}, imdbid=${imdbid}`
    );

    try {
      // Search by TMDB ID
      if (tmdbid) {
        const parsedTmdbId = parseInt(tmdbid, 10);
        console.log(`[Newznab] Searching movie by TMDB ID: ${parsedTmdbId}`);
        if (!isNaN(parsedTmdbId)) {
          const movieData = await getMovieInfoByTmdbId(parsedTmdbId);
          console.log(
            `[Newznab] TMDB lookup result: ${movieData ? `Found "${movieData.germanTitle}" (Original: "${movieData.title}")` : "Not found"}`
          );

          if (!movieData) {
            return new NextResponse(serializeRss(getEmptyRssResult(offset)), {
              status: 200,
              headers: { "Content-Type": "application/xml; charset=utf-8" },
            });
          }

          const searchResults = await fetchMovieSearchResults(movieData, limit, offset);

          return new NextResponse(searchResults, {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }
      }

      // Search by IMDB ID
      if (imdbid) {
        console.log(`[Newznab] Searching movie by IMDB ID: ${imdbid}`);
        const movieData = await getMovieInfoByImdbId(imdbid);
        console.log(
          `[Newznab] IMDB lookup result: ${movieData ? `Found "${movieData.germanTitle}" (Original: "${movieData.title}")` : "Not found"}`
        );

        if (!movieData) {
          return new NextResponse(serializeRss(getEmptyRssResult(offset)), {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }

        const searchResults = await fetchMovieSearchResults(movieData, limit, offset);

        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // Search by query string for movies
      if (q) {
        const searchResults = await fetchMovieSearchByQuery(q, limit, offset);
        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // No search criteria provided - return a category-compatible validation item
      return new NextResponse(getValidationRss(["2000", "2040"]), {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    } catch {
      console.error("[Newznab] Movie search failed");
      return NextResponse.json({ error: "Search temporarily unavailable" }, { status: 503 });
    }
  }

  // Handle TV search requests
  if (t === "tvsearch" || t === "search") {
    // Check if this is a movie search (by category)
    const isMovieSearch = isMovieCategoryRequest(categoryIds);

    if (isMovieSearch && q) {
      console.log(
        `[Newznab] Movie search via t=search detected: q=${q}, cat=${categoryIds.join(",")}`
      );

      try {
        const searchResults = await fetchMovieSearchByQuery(q, limit, offset);
        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      } catch {
        console.error("[Newznab] Movie search by query failed");
        return NextResponse.json({ error: "Search temporarily unavailable" }, { status: 503 });
      }
    }

    const { context, error: contextError } = parseTvSearchContext(searchParams);
    if (!context) {
      return NextResponse.json(
        { error: contextError ?? "Invalid TV search context" },
        { status: 400 }
      );
    }

    console.log(
      `[Newznab] TV search request: t=${t}, q=${context.query}, tvdbid=${context.tvdbId}, season=${context.season}, episode=${context.episode}`
    );

    try {
      // Search by TVDB ID
      if (context.tvdbId !== null) {
        console.log(`[Newznab] Searching by TVDB ID: ${context.tvdbId}`);
        const tvdbData = await getShowInfoByTvdbId(context.tvdbId);
        console.log(
          `[Newznab] TVDB lookup result: ${tvdbData ? `Found "${tvdbData.name}" (German: "${tvdbData.germanName}")` : "Not found"}`
        );

        if (!tvdbData) {
          if (context.query || context.season || context.episode) {
            const fallbackResults = await fetchSearchResultsByString(context, limit, offset);
            return new NextResponse(fallbackResults, {
              status: 200,
              headers: { "Content-Type": "application/xml; charset=utf-8" },
            });
          }
          return new NextResponse(serializeRss(getEmptyRssResult(offset)), {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }

        const searchResults = await fetchSearchResultsById(tvdbData, context, limit, offset);
        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // RSS sync (no params) - return dummy result for Sonarr test
      if (!context.query && !context.season && !context.episode && !imdbid && !tmdbid) {
        const searchResults = await fetchSearchResultsForRssSync(limit, offset);

        // If no results, return an item in the categories requested by the *arr app
        if (searchResults.includes('total="0"')) {
          return new NextResponse(getValidationRss(categoryIds), {
            status: 200,
            headers: { "Content-Type": "application/xml; charset=utf-8" },
          });
        }

        return new NextResponse(searchResults, {
          status: 200,
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      }

      // Search by query string
      const searchResults = await fetchSearchResultsByString(context, limit, offset);
      return new NextResponse(searchResults, {
        status: 200,
        headers: { "Content-Type": "application/xml; charset=utf-8" },
      });
    } catch {
      console.error("[Newznab] TV search failed");
      return NextResponse.json({ error: "Search temporarily unavailable" }, { status: 503 });
    }
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
