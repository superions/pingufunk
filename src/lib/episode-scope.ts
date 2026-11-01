import type { MatchedEpisodeInfo } from "@/types";

/** All consumers use the complete verified scope; the legacy episode remains its first member. */
export const matchedEpisodeScope = (info: MatchedEpisodeInfo) =>
  info.pairedEpisodes ?? [info.episode];

/** Metadata is minutes. A missing member is unknown, never half of a whole programme. */
export function matchedRuntimeMinutes(info: MatchedEpisodeInfo): number | null {
  const episodes = matchedEpisodeScope(info);
  return episodes.every(
    (episode) => episode.runtime && Number.isFinite(episode.runtime) && episode.runtime > 0
  )
    ? episodes.reduce((sum, episode) => sum + episode.runtime!, 0)
    : null;
}
