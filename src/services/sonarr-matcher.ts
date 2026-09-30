import { parseEpisodeFromTitle } from "./newznab";
import { isStreamingUrl } from "@/lib/stream-url";
import { classifyLanguageEdition, isLanguageEditionVisible } from "./language-editions";
import { DEFAULT_LANGUAGE_POLICY, type LanguagePolicy } from "@/lib/language-policy";
import type { ApiResultItem, MatchedEpisodeInfo, TvdbData } from "@/types";
import { hasSharedTopicSeriesEvidence, isSharedSeriesTopic } from "./ruleset-identity";
import { arteVideoId } from "./arte-editions";
import { verifiedDurationCheck as sonarrDurationCheck } from "@/lib/verified-duration";

function normalized(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("de-DE");
}

function progressiveUrl(value: string): string {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      /\.(?:mp4|m4v|mkv|webm|mov)$/i.test(url.pathname) &&
      !isStreamingUrl(value)
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
  languagePolicy: LanguagePolicy = DEFAULT_LANGUAGE_POLICY
): MatchedEpisodeInfo[] {
  const names = [show.name, show.germanName, ...show.aliases.map((alias) => alias.name)]
    .filter((name): name is string => !!name)
    .map(normalized);
  const blocked = new Set(show.sonarrBlockedCoordinates ?? []);
  const episodes = show.episodes.filter(
    (episode) =>
      episode.metadataSource === "sonarr" &&
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
      ) ||
      /\b(?:trailer|teaser|preview|clip|outtakes)\b/i.test(candidate.title) ||
      !isLanguageEditionVisible(classifyLanguageEdition(candidate), languagePolicy)
    )
      continue;
    const item = {
      ...candidate,
      url_video: progressiveUrl(candidate.url_video),
      url_video_low: progressiveUrl(candidate.url_video_low),
      url_video_hd: progressiveUrl(candidate.url_video_hd),
    };
    if (![item.url_video, item.url_video_low, item.url_video_hd].some(Boolean)) continue;
    const parsed = parseEpisodeFromTitle(item.title);
    const sourceYears = [...parsed.episodeName.matchAll(/\b(19\d{2}|20\d{2})\b/g)].map((match) =>
      Number(match[1])
    );
    const title = normalized(
      parsed.episodeName
        .replace(/\s*\((?:klare Sprache|Gebärdensprache)\)\s*$/i, "")
        .replace(/\s*\((?:19|20)\d{2}\)\s*$/, "")
    );
    const possible = episodes.filter((episode) => {
      if (parsed.season !== null && parsed.season !== episode.seasonNumber) return false;
      if (
        parsed.episodes.length > 0 &&
        (parsed.episodes.length !== 1 || parsed.episodes[0] !== episode.episodeNumber)
      )
        return false;
      if (
        sourceYears.some(
          (year) => !episode.aired || year !== new Date(episode.aired).getUTCFullYear()
        )
      )
        return false;
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
      return (
        titleMatches &&
        sonarrDurationCheck(
          item.duration,
          episode.runtime === null ? null : episode.runtime * 60,
          minimumSeconds,
          tolerancePercent
        ).accepted
      );
    });
    // Repeated episode titles without discriminating coordinates/year never pick the newest.
    if (possible.length !== 1) continue;
    matches.push({
      episode: possible[0],
      item,
      showName: show.germanName || show.name,
      matchedTitle: item.title,
      tvdbId: show.id,
    });
  }
  return matches;
}
