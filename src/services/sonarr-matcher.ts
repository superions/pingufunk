import { parseEpisodeFromTitle } from "./newznab";
import { isPlaceholderEpisodeTitle } from "@/lib/episode-title";
import { isStreamingUrl } from "@/lib/stream-url";
import { classifyLanguageEdition, isLanguageEditionVisible } from "./language-editions";
import { DEFAULT_LANGUAGE_POLICY, type LanguagePolicy } from "@/lib/language-policy";
import type { ApiResultItem, MatchedEpisodeInfo, TvdbData } from "@/types";
import { hasSharedTopicSeriesEvidence, isSharedSeriesTopic } from "./ruleset-identity";
import { arteVideoId } from "./arte-editions";
import { verifiedDurationCheck as sonarrDurationCheck } from "@/lib/verified-duration";
import { recordDecision } from "@/server/decision-diagnostics";

function normalized(value: string): string {
  return value
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss");
}

function eligibleRenditionUrl(value: string, hlsEnabled: boolean): string {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      (isStreamingUrl(value) ? hlsEnabled : /\.(?:mp4|m4v|mkv|webm|mov)$/i.test(url.pathname))
      ? value
      : "";
  } catch {
    return "";
  }
}

export { verifiedDurationCheck as sonarrDurationCheck } from "@/lib/verified-duration";

/** The same final owner is used for exact, season and RSS supplemental candidates. */
export function matchSonarrEpisodes(
  show: TvdbData,
  candidates: ApiResultItem[],
  minimumSeconds: number,
  tolerancePercent: number,
  languagePolicy: LanguagePolicy = DEFAULT_LANGUAGE_POLICY,
  hlsEnabled = false,
  deferLanguageSelection = false,
  ruleTopics: readonly string[] = [],
  includeRuntimeConflicts = false
): MatchedEpisodeInfo[] {
  const names = [
    show.name,
    show.germanName,
    ...show.aliases.map((alias) => alias.name),
    ...ruleTopics,
  ]
    .filter((name): name is string => !!name)
    .map(normalized);
  const blocked = new Set(show.sonarrBlockedCoordinates ?? []);
  const verified = new Set(show.sonarrVerifiedCoordinates ?? []);
  const episodes = show.episodes.filter(
    (episode) =>
      (episode.metadataSource === "sonarr" ||
        (verified.has(`${episode.seasonNumber}:${episode.episodeNumber}`) &&
          isPlaceholderEpisodeTitle(episode.name, episode.episodeNumber))) &&
      !blocked.has(`${episode.seasonNumber}:${episode.episodeNumber}`)
  );
  const matches: MatchedEpisodeInfo[] = [];
  for (const candidate of candidates) {
    if (
      !(
        names.includes(normalized(candidate.topic)) ||
        (isSharedSeriesTopic(candidate.topic) &&
          candidate.arteVerifiedVideoId &&
          candidate.arteVerifiedVideoId === arteVideoId(candidate.url_website) &&
          hasSharedTopicSeriesEvidence(candidate, show))
      )
    ) {
      recordDecision("identity", "alias_conflict", "conflicting");
      continue;
    }
    if (/\b(?:trailer|teaser|preview|clip|outtakes)\b/i.test(candidate.title)) {
      recordDecision("identity", "identity_missing", "missing");
      continue;
    }
    if (
      !deferLanguageSelection &&
      !isLanguageEditionVisible(classifyLanguageEdition(candidate), languagePolicy)
    ) {
      recordDecision("language", "language_excluded", "conflicting");
      continue;
    }
    const item = {
      ...candidate,
      url_video: eligibleRenditionUrl(candidate.url_video, hlsEnabled),
      url_video_low: eligibleRenditionUrl(candidate.url_video_low, hlsEnabled),
      url_video_hd: eligibleRenditionUrl(candidate.url_video_hd, hlsEnabled),
    };
    if (![item.url_video, item.url_video_low, item.url_video_hd].some(Boolean)) {
      recordDecision("rendition", "rendition_unavailable", "unavailable");
      continue;
    }
    const parsed = parseEpisodeFromTitle(item.title);
    const part = /\((\d{1,4})\s*\/\s*(\d{1,4})\)/.exec(item.title);
    const regular = show.episodes.filter((episode) => episode.seasonNumber > 0);
    // A bare fraction never implies S01. Only a verified ARTE programme and
    // the complete, single-season Sonarr inventory can disambiguate its part.
    const partSeason =
      parsed.season === null &&
      part &&
      item.arteVerifiedVideoId &&
      arteVideoId(item.url_website) === item.arteVerifiedVideoId &&
      regular.length === Number(part[2]) &&
      regular.every((episode) => episode.metadataSource === "sonarr") &&
      new Set(regular.map((episode) => episode.seasonNumber)).size === 1 &&
      new Set(regular.map((episode) => episode.episodeNumber)).size === regular.length &&
      regular.every(
        (episode) => episode.episodeNumber >= 1 && episode.episodeNumber <= regular.length
      )
        ? regular[0].seasonNumber
        : null;
    const sourceSeason = parsed.season ?? partSeason;
    const sourceYears = [...parsed.episodeName.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) =>
      Number(match[1])
    );
    const title = normalized(
      parsed.episodeName
        .replace(/\s*\((?:klare Sprache|Gebärdensprache)\)\s*$/i, "")
        .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")
    );
    const possible = episodes.filter((episode) => {
      if (sourceSeason !== null && sourceSeason !== episode.seasonNumber) {
        recordDecision("identity", "coordinate_conflict", "conflicting");
        return false;
      }
      if (
        parsed.episodes.length > 0 &&
        (parsed.episodes.length !== 1 || parsed.episodes[0] !== episode.episodeNumber)
      ) {
        recordDecision("identity", "coordinate_conflict", "conflicting");
        return false;
      }
      if (
        sourceYears.some(
          (year) => !episode.aired || year !== new Date(episode.aired).getUTCFullYear()
        )
      ) {
        recordDecision("identity", "year_conflict", "conflicting");
        return false;
      }
      const full = normalized(episode.name);
      const tail = full.split(/\s*[:–—|]\s*|\s+-\s+/).at(-1)!;
      if ([...full].length < 3) return false;
      const titleMatches =
        title === full ||
        ([...tail].length >= 3 && title === tail) ||
        names.some(
          (name) =>
            title === `${name}: ${full}` ||
            title === `${name} - ${full}` ||
            ([...tail].length >= 3 &&
              (title === `${name}: ${tail}` || title === `${name} - ${tail}`))
        );
      // An explicit source coordinate with verified series identity and runtime
      // is stronger than translated/generic metadata titles (e.g. "Episode 3").
      const genericMetadataTitle = isPlaceholderEpisodeTitle(episode.name, episode.episodeNumber);
      const coordinateMatches =
        genericMetadataTitle &&
        sourceSeason !== null &&
        parsed.episodes.length === 1 &&
        episode.runtime !== null &&
        Number.isFinite(episode.runtime) &&
        episode.runtime > 0;
      if (!((!genericMetadataTitle && titleMatches) || coordinateMatches)) {
        recordDecision(
          "identity",
          genericMetadataTitle ? "identity_missing" : "alias_conflict",
          genericMetadataTitle ? "missing" : "conflicting"
        );
        return false;
      }
      return true;
    });
    // Repeated episode titles without discriminating coordinates/year never pick the newest.
    if (possible.length !== 1) {
      recordDecision(
        "identity",
        possible.length > 1 ? "identity_ambiguous" : "identity_missing",
        possible.length > 1 ? "conflicting" : "missing"
      );
      continue;
    }
    // Resolve identity before duration: a length difference cannot disambiguate
    // two same-title episodes, nor authorize stamping the requested coordinate.
    const episode = possible[0];
    const duration = sonarrDurationCheck(
      item.duration,
      episode.runtime === null ? null : episode.runtime * 60,
      minimumSeconds,
      tolerancePercent
    );
    recordDecision(
      "runtime",
      duration.accepted
        ? duration.expectedVerified
          ? "runtime_verified"
          : "runtime_missing"
        : "runtime_outside_tolerance",
      duration.accepted ? (duration.expectedVerified ? "proven" : "missing") : "conflicting"
    );
    const runtimeConflict = !duration.accepted;
    if (
      runtimeConflict &&
      !(
        includeRuntimeConflicts &&
        sourceSeason !== null &&
        parsed.episodes.length === 1 &&
        Number.isFinite(item.duration) &&
        item.duration > 0 &&
        episode.runtime !== null &&
        Number.isFinite(episode.runtime) &&
        episode.runtime > 0
      )
    )
      continue;
    recordDecision("identity", "identity_verified", "proven");
    matches.push({
      episode,
      item,
      showName: show.germanName || show.name,
      matchedTitle: item.title,
      tvdbId: show.id,
      ...(runtimeConflict ? { runtimeConflict: true } : {}),
    });
  }
  return matches;
}
