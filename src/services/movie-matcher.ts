import { isRenditionAllowed } from "@/lib/stream-url";
import { verifiedDurationCheck } from "@/lib/verified-duration";
import { getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import type { ApiResultItem, TmdbMovieData } from "@/types";
import { recordDecision } from "@/server/decision-diagnostics";

export function movieSourceTitle(value: string): { title: string; year: number | null } {
  let title = value.trim();
  let year: number | null = null;
  for (let pass = 0; pass < 3; pass++) {
    const edition =
      /\s*\((?:mit Untertitel|Originalversion(?: mit Untertitel)?|Audiodeskription|Hörfassung|Englisch|Französisch|Deutsch|OV|OmU)\)\s*$/i;
    if (edition.test(title)) {
      title = title.replace(edition, "").trim();
      continue;
    }
    const match = /\s+(?:\((19\d{2}|20\d{2})\)|(19\d{2}|20\d{2}))$/.exec(title);
    if (match) {
      const found = Number(match[1] ?? match[2]);
      if (year !== null && year !== found) return { title: value, year: null };
      year = found;
      title = title.slice(0, match.index).trim();
      continue;
    }
    break;
  }
  return { title, year };
}

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
  const tolerance = Number(
    configuredSetting(
      "matching.movie.tolerancePercent",
      await getSetting("matching.movie.tolerancePercent")
    )
  );
  const yearTolerance = Number(
    configuredSetting(
      "matching.movie.yearTolerance",
      await getSetting("matching.movie.yearTolerance")
    )
  );
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
    if (!Number.isFinite(item.duration) || item.duration <= 0) {
      recordDecision("runtime", "runtime_invalid", "missing");
      continue;
    }
    if (
      ![item.url_video, item.url_video_low, item.url_video_hd].some((url) =>
        isRenditionAllowed(url, hlsEnabled)
      )
    ) {
      recordDecision("rendition", "rendition_unavailable", "unavailable");
      continue;
    }
    const source = movieSourceTitle(item.title);
    const title = normalizeMovieTitle(source.title);
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
    if (!plausible) {
      recordDecision("identity", "alias_conflict", "conflicting");
      continue;
    }
    const duration = verifiedDurationCheck(item.duration, expected, minDurationSeconds, tolerance);
    const qualifiedShortFilm =
      exact &&
      year !== null &&
      source.year !== null &&
      Math.abs(source.year - year) <= yearTolerance &&
      duration.expectedVerified &&
      !/\b(?:trailer|teaser|clip|preview|outtakes)\b/i.test(item.title);
    if (item.duration < minDurationSeconds && !qualifiedShortFilm) {
      recordDecision("runtime", "minimum_duration", "conflicting");
      continue;
    }
    // Explicitly approved metadata-backed correlation, not a fuzzy score or
    // a request stamp. Unknown runtime/year, conflicting years and clips remain
    // source candidates, including on the exact-title retrieval path.
    const identityVerified =
      exact &&
      duration.expectedVerified &&
      year !== null &&
      Number.isSafeInteger(year) &&
      year >= 1800 &&
      (source.year === null || Math.abs(source.year - year) <= yearTolerance) &&
      !/\b(?:trailer|teaser|clip|preview|outtakes)\b/i.test(item.title);
    recordDecision(
      "runtime",
      expected === null
        ? "runtime_missing"
        : duration.expectedVerified
          ? "runtime_verified"
          : "runtime_outside_tolerance",
      expected === null ? "missing" : duration.expectedVerified ? "proven" : "conflicting"
    );
    recordDecision(
      "identity",
      identityVerified
        ? "identity_verified"
        : source.year !== null && year !== null && Math.abs(source.year - year) > yearTolerance
          ? "year_conflict"
          : !exact
            ? "alias_conflict"
            : "identity_missing",
      identityVerified
        ? "proven"
        : source.year !== null && year !== null && Math.abs(source.year - year) > yearTolerance
          ? "conflicting"
          : "missing"
    );
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
