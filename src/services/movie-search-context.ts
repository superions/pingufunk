import { normalizeMovieTitle } from "./movie-matcher";
import { DEFAULT_PRODUCT_SETTINGS, normalizeSetting } from "@/lib/settings-schema";

const DEFAULT_YEAR_TOLERANCE = Number(DEFAULT_PRODUCT_SETTINGS["matching.movie.yearTolerance"]);
function assertYearTolerance(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    normalizeSetting("matching.movie.yearTolerance", String(value)) === null
  )
    throw new MovieSearchContextError();
}
import type { TmdbMovieData } from "@/types";

export class MovieSearchContextError extends Error {
  constructor() {
    super("Invalid or conflicting movie search context");
  }
}

export interface MovieSearchContext {
  query: string | null;
  year: number | null;
  /** Keep a distinct title-suffix year so tolerance cannot compound across fields. */
  queryYear?: number;
  tmdbId: number | null;
  imdbId: string | null;
}

/** Parse all route forms identically; duplicate identity fields are ambiguous. */
export function parseMovieSearchContext(
  params: URLSearchParams,
  yearTolerance = DEFAULT_YEAR_TOLERANCE
): MovieSearchContext {
  assertYearTolerance(yearTolerance);
  for (const key of ["q", "year", "tmdbid", "imdbid"]) {
    if (params.getAll(key).length > 1) throw new MovieSearchContextError();
  }
  const rawId = params.get("tmdbid");
  const tmdbId = rawId === null ? null : Number(rawId);
  if (
    rawId !== null &&
    (!/^\d+$/.test(rawId) ||
      !Number.isSafeInteger(tmdbId) ||
      tmdbId! < 1 ||
      tmdbId! > 2_147_483_647)
  )
    throw new MovieSearchContextError();
  const rawImdb = params.get("imdbid");
  if (rawImdb !== null && !/^(?:tt)?\d{7,10}$/.test(rawImdb)) throw new MovieSearchContextError();
  const imdbId = rawImdb === null ? null : rawImdb.startsWith("tt") ? rawImdb : `tt${rawImdb}`;
  const query = params.get("q")?.trim() || null;
  if (query && query.length > 500) throw new MovieSearchContextError();
  const queryYear = query?.match(/\s+(\d{4})$/)?.[1] ?? null;
  const rawYear = params.get("year");
  if (rawYear !== null && !/^\d{4}$/.test(rawYear)) throw new MovieSearchContextError();
  if (
    rawYear !== null &&
    queryYear !== null &&
    Math.abs(Number(rawYear) - Number(queryYear)) > yearTolerance
  )
    throw new MovieSearchContextError();
  const year = rawYear !== null || queryYear !== null ? Number(rawYear ?? queryYear) : null;
  if (year !== null && (year < 1800 || year > new Date().getUTCFullYear() + 2))
    throw new MovieSearchContextError();
  return {
    query: queryYear ? query!.replace(/\s+\d{4}$/, "").trim() : query,
    year,
    ...(rawYear !== null && queryYear !== null && Number(rawYear) !== Number(queryYear)
      ? { queryYear: Number(queryYear) }
      : {}),
    tmdbId,
    imdbId,
  };
}

/** Metadata verifies the search goal only, never all videos returned for it. */
export function assertMovieSearchGoal(
  context: MovieSearchContext,
  movie: TmdbMovieData,
  yearTolerance = DEFAULT_YEAR_TOLERANCE
): void {
  assertYearTolerance(yearTolerance);
  const year =
    movie.productionYear ?? (movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : null);
  const names = [movie.title, movie.germanTitle, ...(movie.aliases ?? [])].map(normalizeMovieTitle);
  if (
    (context.tmdbId !== null && context.tmdbId !== movie.tmdbId) ||
    (context.imdbId !== null && context.imdbId !== movie.imdbId) ||
    (context.year !== null &&
      (year === null || !Number.isFinite(year) || Math.abs(context.year - year) > yearTolerance)) ||
    (context.queryYear !== undefined &&
      (year === null ||
        !Number.isFinite(year) ||
        Math.abs(context.queryYear - year) > yearTolerance)) ||
    (context.query !== null && !names.includes(normalizeMovieTitle(context.query)))
  )
    throw new MovieSearchContextError();
}
