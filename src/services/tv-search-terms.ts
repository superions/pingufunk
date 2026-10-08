import type { TvdbData } from "@/types";
import type { MediathekQueryField } from "@/lib/mediathek-client";
import { titleSearchTerms } from "@/lib/title-search-terms";
import { isPlaceholderEpisodeTitle } from "@/lib/episode-title";
import { getAllTopics, getRulesetsForTopic } from "./rulesets";
import { isSharedSeriesTopic } from "./ruleset-identity";

/** Dedicated, unambiguous configured topics identify a series; query words never do. */
export function verifiedRuleTopics(show: TvdbData): string[] {
  return getAllTopics()
    .filter((topic) => {
      const rules = getRulesetsForTopic(topic);
      return (
        !isSharedSeriesTopic(topic) &&
        rules.length > 0 &&
        rules.every((rule) => rule.media.media_tvdbId === show.id)
      );
    })
    .sort();
}

/** Six OR lookups share one caller budget; retrieval terms are never identity aliases. */
export function tvSearchQueries(
  show: TvdbData,
  query?: string | null,
  episodeTitle?: string
): MediathekQueryField[] {
  const names = [
    query,
    show.germanName,
    show.name,
    ...show.aliases.map((alias) => alias.name),
  ].filter((value): value is string => !!value?.trim());
  const topics = verifiedRuleTopics(show);
  const result: MediathekQueryField[] = [];
  const seen = new Set<string>();
  const add = (value: string, fields = ["topic", "title"]) => {
    const term = value.trim().replace(/\s+/g, " ");
    const key = term.toLocaleLowerCase("de-DE");
    if (term.length >= 3 && term.length <= 1024 && !seen.has(key) && result.length < 6) {
      seen.add(key);
      result.push({ fields, query: term });
    }
  };
  // Put bound rule topics ahead of heuristic words and long alias lists.
  if (names[0]) add(names[0].replace(/\s*\((?:19|20)\d{2}\)\s*$/, ""));
  topics.forEach((topic) => add(topic, ["topic"]));
  for (const name of names) add(name.replace(/\s*\((?:19|20)\d{2}\)\s*$/, ""));
  if (episodeTitle && !isPlaceholderEpisodeTitle(episodeTitle)) add(episodeTitle);
  for (const term of titleSearchTerms(names)) add(term);
  return result;
}
