import type { ApiResultItem, MatchedEpisodeInfo, TvdbData } from "@/types";
import { youtubeSourceIdentitySchema } from "@/lib/youtube-source";
import { verifiedDurationCheck } from "@/lib/verified-duration";
/** Consume an adapter's explicit canonical binding; never reparse foreign publisher coordinates. */
export function matchBoundSourceEpisode(
  item: ApiResultItem,
  show: TvdbData,
  minimum: number,
  tolerance: number,
  includeRuntimeConflicts = false
): MatchedEpisodeInfo | null {
  if (!item.sourceRef) return null;
  const parsed = youtubeSourceIdentitySchema.strip().safeParse(item.sourceRef);
  if (!parsed.success) return null;
  const binding = parsed.data.programme;
  if (
    binding.kind !== "series" ||
    binding.targetId !== show.id ||
    show.sonarrBlockedCoordinates?.includes(`${binding.season}:${binding.episode}`)
  )
    return null;
  const episodes = show.episodes.filter(
    (episode) =>
      episode.seasonNumber === binding.season && episode.episodeNumber === binding.episode
  );
  if (episodes.length !== 1) return null;
  const episode = episodes[0];
  const conflict = !verifiedDurationCheck(
    item.duration,
    episode.runtime === null ? null : episode.runtime * 60,
    minimum,
    tolerance
  ).accepted;
  if (
    conflict &&
    !(includeRuntimeConflicts && item.duration > 0 && episode.runtime && episode.runtime > 0)
  )
    return null;
  return {
    episode,
    item,
    showName: show.germanName || show.name,
    releaseShowName: show.sonarrReleaseName,
    matchedTitle: item.title,
    tvdbId: show.id,
    ...(conflict ? { runtimeConflict: true, runtimeTolerancePercent: tolerance } : {}),
  };
}
