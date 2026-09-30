import { isRenditionAllowed } from "@/lib/stream-url";
import { verifiedDurationCheck } from "@/lib/verified-duration";
import { getSetting } from "@/lib/settings";
import type { ApiResultItem, TmdbMovieData } from "@/types";

export function normalizeMovieTitle(title: string): string {
  return title
    .normalize("NFC")
    .toLocaleLowerCase("de-DE")
    .replace(/[/:;,"'@#?$%^*+=!|<>()&]/g, "")
    .replace(/[-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface MovieMatchResult {
  item: ApiResultItem;
  score: number;
  titleMatch: "exact" | "fuzzy" | "partial";
  durationDiff: number;
  /** Only this flag permits canonical naming/IDs, not the retrieval score. */
  identityVerified?: boolean;
}

/** Rank plausible source candidates; missing proof is not an invented match. */
export async function matchMovieItems(
  items: ApiResultItem[],
  movieData: TmdbMovieData,
  minDurationSeconds: number,
  hlsEnabledOverride?: boolean
): Promise<MovieMatchResult[]> {
  const hlsEnabled = hlsEnabledOverride ?? (await getSetting("download.enableHLS")) === "true";
  const configured = await getSetting("matching.movie.tolerancePercent");
  const tolerance = configured === null ? 10 : Number(configured);
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 25)
    throw new Error("Invalid movie duration policy");
  const names = [movieData.title, movieData.germanTitle, ...(movieData.aliases ?? [])]
    .filter(Boolean)
    .map(normalizeMovieTitle);
  const year =
    movieData.productionYear ??
    (movieData.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(movieData.releaseDate)
      ? Number(movieData.releaseDate.slice(0, 4))
      : null);
  const expected =
    movieData.runtime !== null && movieData.runtime > 0 ? movieData.runtime * 60 : null;
  const results: MovieMatchResult[] = [];
  for (const item of items) {
    if (!Number.isFinite(item.duration) || item.duration <= 0) continue;
    if (
      ![item.url_video, item.url_video_low, item.url_video_hd].some((url) =>
        isRenditionAllowed(url, hlsEnabled)
      )
    )
      continue;
    const sourceYear = /\s+(?:\((\d{4})\)|(\d{4}))$/.exec(item.title.trim());
    const title = normalizeMovieTitle(
      sourceYear ? item.title.slice(0, sourceYear.index) : item.title
    );
    const topic = normalizeMovieTitle(item.topic);
    const exact = names.includes(title);
    const plausible =
      exact ||
      names.includes(topic) ||
      names.some((name) => {
        const words = name.split(" ").filter((word) => word.length >= 3);
        const source = new Set(title.split(" "));
        return (
          words.length >= 2 &&
          words.filter((word) => source.has(word)).length >= Math.ceil(words.length / 2)
        );
      });
    if (!plausible) continue;
    const duration = verifiedDurationCheck(item.duration, expected, minDurationSeconds, tolerance);
    const qualifiedShortFilm =
      exact &&
      year !== null &&
      Number(sourceYear?.[1] ?? sourceYear?.[2]) === year &&
      duration.expectedVerified &&
      !/\b(?:trailer|teaser|clip|preview|outtakes)\b/i.test(item.title);
    if (item.duration < minDurationSeconds && !qualifiedShortFilm) continue;
    // MediathekView has no verified film IDs/production-year field. Even exact
    // text/year/runtime correlation cannot justify copying a request ID.
    const identityVerified = false;
    results.push({
      item,
      score: exact ? 80 : 40,
      titleMatch: exact ? "exact" : "partial",
      durationDiff: expected === null ? 0 : Math.abs(item.duration - expected) / 60,
      identityVerified,
    });
  }
  return results.sort((a, b) => b.score - a.score);
}
