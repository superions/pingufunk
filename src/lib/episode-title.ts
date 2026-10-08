/** A placeholder supplies no title identity, but never overrides a concrete title conflict. */
export function isPlaceholderEpisodeTitle(title: string, episodeNumber?: number): boolean {
  return (
    /^(?:TBA|TBD|To be announced|To be determined)$/i.test(title.trim()) ||
    new RegExp(
      `^(?:Episode|Folge)\\s+${episodeNumber === undefined ? "\\d+" : `0*${episodeNumber}`}$`,
      "i"
    ).test(title.trim())
  );
}
