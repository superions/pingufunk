import type { ApiResultItem, TvSearchContext, TvdbData } from "@/types";
import { GERMAN_MONTHS } from "@/lib/german-date";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { titleSearchTerms } from "@/lib/title-search-terms";
import { getDailyDateKey, parseNumericCoordinate } from "./tv-search-matcher";
import { queryContent } from "./content-search";
import { getRulesetsForTopic } from "./rulesets";
import { getBaseShowForSonarrRss } from "./shows";
import { hasSharedTopicSeriesEvidence, isSharedSeriesTopic } from "./ruleset-identity";
import { arteVideoId, resolveArteSeriesEditions } from "./arte-editions";
const QUERY_FIELDS = ["topic", "title"];
const TV_SEARCH_CANDIDATE_LIMIT = 1500;

/** Broad bounded retrieval and verified catalogue ownership; publication remains separate. */
function getTvSearchCandidateQueries(
  context: TvSearchContext
): Array<{ fields: string[]; query: string }> {
  // Query alternatives separately: the provider combines clauses with AND.
  if (context.query)
    return titleSearchTerms([context.query]).map((query) => ({ fields: QUERY_FIELDS, query }));

  const dailyDate = getDailyDateKey(context);
  if (dailyDate === null) return [];
  if (dailyDate !== undefined) {
    const [year, month, day] = dailyDate.split("-");
    const monthNumber = Number(month) - 1;
    const monthName = Object.keys(GERMAN_MONTHS).find(
      (name) => GERMAN_MONTHS[name] === monthNumber
    );
    const localizedDate = monthName
      ? `${Number(day)}. ${monthName[0].toLocaleUpperCase("de-DE")}${monthName.slice(1)} ${year}`
      : null;
    const terms = [`${year}-${month}-${day}`, `${day}.${month}.${year}`, `${year}${month}${day}`];
    if (localizedDate) terms.push(localizedDate);
    return terms.map((query) => ({ fields: ["title"], query }));
  }

  if (context.season) {
    const season = parseNumericCoordinate(context.season);
    if (season === null) return [];
    const isYear = /^\d{4}$/.test(context.season) && season >= 1900 && season <= 2100;
    const terms = isYear
      ? [`S${season}`, String(season)]
      : [
          `S${String(season).padStart(2, "0")}`,
          `Staffel ${season}`,
          `Season ${season}`,
          `Saison ${season}`,
          `Temporada ${season}`,
          `Stagione ${season}`,
        ];
    return terms.map((query) => ({ fields: ["title"], query }));
  }

  if (context.episode) {
    const episode = parseNumericCoordinate(context.episode);
    if (episode === null) return [];
    const padded = String(episode).padStart(2, "0");
    return [`E${padded}`, `Episode ${episode}`, `Folge ${episode}`].map((query) => ({
      fields: ["title"],
      query,
    }));
  }

  return [];
}

/** Rules identify possible owners; verified metadata and title decide ownership. */
export async function resolveArteCatalogueCandidates(
  items: ApiResultItem[],
  budget: HttpRequestBudget
): Promise<ApiResultItem[] | null> {
  const ordinary: ApiResultItem[] = [];
  const owned = new Map<number, { show: TvdbData; items: ApiResultItem[] }>();
  const metadata = new Map<number, Promise<TvdbData | null>>();
  for (const item of items) {
    if (Date.now() >= budget.deadlineAt) return null;
    if (!arteVideoId(item.url_website) || !isSharedSeriesTopic(item.topic)) {
      ordinary.push(item);
      continue;
    }
    const shows = new Map<number, TvdbData>();
    for (const rule of getRulesetsForTopic(item.topic)) {
      const id = rule.media.media_tvdbId;
      if (id === null || !Number.isSafeInteger(id) || id <= 0) continue;
      // Discovery must not trigger a fresh external metadata cascade. Reuse
      // verified base cache/bundled identities, not names invented from a rule.
      if (!metadata.has(id)) metadata.set(id, getBaseShowForSonarrRss(id));
      const show = await metadata.get(id);
      if (show?.id !== id) continue;
      if (show && hasSharedTopicSeriesEvidence(item, show)) shows.set(show.id, show);
    }
    if (shows.size === 0) {
      ordinary.push(item);
      continue;
    }
    if (shows.size !== 1) continue;
    const show = [...shows.values()][0];
    const group = owned.get(show.id) ?? { show, items: [] };
    group.items.push(item);
    owned.set(show.id, group);
  }
  for (const [, { show, items }] of [...owned].sort(([a], [b]) => a - b)) {
    const resolved = await resolveArteSeriesEditions(items, show, budget);
    if (resolved === null) return null;
    ordinary.push(...resolved);
  }
  // Evidence enrichment and final language selection belong to the publishing
  // owner. Filtering here would discard editions before their audio is known.
  return ordinary;
}

export async function queryTvSearchCandidates(
  context: TvSearchContext,
  budget: HttpRequestBudget
): Promise<ApiResultItem[] | null> {
  const candidateQueries = getTvSearchCandidateQueries(context);
  if (candidateQueries.length === 0) return [];

  // Each provider query has its own source cap. The Newznab total describes
  // the filtered union, not the source's full catalog.
  const candidates = await Promise.all(
    candidateQueries.map((query) =>
      queryContent([query], TV_SEARCH_CANDIDATE_LIMIT, {
        requestBudget: budget,
        deferLanguageSelection: true,
      })
    )
  );
  if (candidates.some((results) => results === null)) return null;

  const uniqueCandidates = new Map<string, ApiResultItem>();
  for (const item of candidates.flatMap((results) => results ?? [])) {
    const identity = JSON.stringify(item);
    if (!uniqueCandidates.has(identity)) uniqueCandidates.set(identity, item);
  }

  // Return source rows only: ARTE ownership depends on the current rule catalogue.
  return [...uniqueCandidates.values()];
}
