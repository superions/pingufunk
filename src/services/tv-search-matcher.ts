import type {
  ApiResultItem,
  TvSearchContext,
  TvdbData,
  TvdbEpisode,
  MatchedEpisodeInfo,
} from "@/types";
import { isSharedSeriesTopic } from "./ruleset-identity";
import { parseEpisodeFromTitle } from "./newznab";

/** Request coordinates filter source facts; they never manufacture missing source identity. */
export function tvSearchContextKey(context: TvSearchContext): string {
  return JSON.stringify([context.query, context.tvdbId, context.season, context.episode]);
}

export function hasEpisodeCoordinates(context: TvSearchContext): boolean {
  return !!context.season || !!context.episode;
}

export function matchesGenericSearchContext(
  item: ApiResultItem,
  context: TvSearchContext
): boolean {
  if (context.tvdbId !== null) return false;
  return !hasEpisodeCoordinates(context) || matchesSourceCoordinates(item, context);
}

/** Missing source coordinates permit a neutral candidate, never request-coordinate adoption. */
export function matchesUnknownTvCandidate(
  item: ApiResultItem,
  context: TvSearchContext,
  show?: TvdbData
): boolean {
  // Date-scoped searches retain their exact aired-day gate; a malformed or
  // neighboring date cannot re-enter as "unknown coordinates".
  if (getDailyDateKey(context) !== undefined) return false;
  const parsed = parseEpisodeFromTitle(item.title);
  if (parsed.episodes.length > 0) return false;
  const names = show
    ? [show.name, show.germanName, ...show.aliases.map((alias) => alias.name)]
    : [context.query];
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
  return names
    .filter((name): name is string => !!name)
    .some((name) => {
      const goal = normalize(name);
      const title = normalize(item.title);
      return (
        goal.length >= 3 &&
        ((!isSharedSeriesTopic(item.topic) && normalize(item.topic) === goal) ||
          title === goal ||
          (title.startsWith(goal) && /^[\s:(\-–]/.test(title.slice(goal.length))))
      );
    });
}

export function parseNumericCoordinate(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function getDailyDateKey(context: TvSearchContext): string | null | undefined {
  if (!context.episode?.includes("/")) return undefined;
  if (!context.season || !/^\d{4}$/.test(context.season)) return null;

  const match = context.episode.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  const year = Number(context.season);
  const month = Number(match[1]);
  const day = Number(match[2]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;

  return `${context.season}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getAiredDateKey(aired: Date | null): string | null {
  if (!aired) return null;
  const date = new Date(aired);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function matchesTvdbEpisode(episode: TvdbEpisode, context: TvSearchContext): boolean {
  const dailyDate = getDailyDateKey(context);
  if (dailyDate !== undefined)
    return dailyDate !== null && getAiredDateKey(episode.aired) === dailyDate;

  const seasonText = context.season?.trim() || null;
  const episodeText = context.episode?.trim() || null;
  const season = parseNumericCoordinate(seasonText);
  const episodeNumber = parseNumericCoordinate(episodeText);

  if (seasonText && season === null) return false;
  if (episodeText && episodeNumber === null) return false;

  if (season !== null) {
    const isAiredYear =
      episodeText === null &&
      /^\d{4}$/.test(seasonText ?? "") &&
      season >= 1900 &&
      season <= 2100 &&
      getAiredDateKey(episode.aired)?.startsWith(`${season}-`);
    if (episode.seasonNumber !== season && !isAiredYear) return false;
  }

  return episodeNumber === null || episode.episodeNumber === episodeNumber;
}

function matchesSourceCoordinates(item: ApiResultItem, context: TvSearchContext): boolean {
  const dailyDate = getDailyDateKey(context);
  if (dailyDate !== undefined) return false;

  const parsed = parseEpisodeFromTitle(item.title);
  if (parsed.episodes.length === 0) return false;

  const seasonText = context.season?.trim() || null;
  const episodeText = context.episode?.trim() || null;
  const season = parseNumericCoordinate(seasonText);
  const episodeNumber = parseNumericCoordinate(episodeText);

  if (seasonText && (season === null || parsed.season !== season)) return false;
  if (episodeText && (episodeNumber === null || !parsed.episodes.includes(episodeNumber)))
    return false;
  return true;
}

export function getDesiredEpisodes(
  tvdbData: TvdbData,
  context: TvSearchContext
): TvdbEpisode[] | null {
  if (!context.season && !context.episode) return null;
  return tvdbData.episodes.filter((episode) => matchesTvdbEpisode(episode, context));
}

export function applyDesiredEpisodeFilter(
  matchedEpisodes: MatchedEpisodeInfo[],
  desiredEpisodes: TvdbEpisode[] | null,
  context: TvSearchContext
): MatchedEpisodeInfo[] {
  const hasCoordinates = !!context.season || !!context.episode;
  if (!hasCoordinates && context.tvdbId === null) return matchedEpisodes;

  return matchedEpisodes.filter((matched) => {
    if (context.tvdbId !== null && matched.tvdbId !== context.tvdbId) return false;
    if (!hasCoordinates) return true;
    if (desiredEpisodes?.length === 0) return false;

    if (matchesTvdbEpisode(matched.episode, context)) {
      return (
        desiredEpisodes === null ||
        desiredEpisodes.some(
          (desired) =>
            desired.seasonNumber === matched.episode.seasonNumber &&
            desired.episodeNumber === matched.episode.episodeNumber
        )
      );
    }

    if (desiredEpisodes === null) return matchesSourceCoordinates(matched.item, context);
    const parsed = parseEpisodeFromTitle(matched.item.title);
    return desiredEpisodes.some(
      (desired) =>
        parsed.season === desired.seasonNumber && parsed.episodes.includes(desired.episodeNumber)
    );
  });
}
