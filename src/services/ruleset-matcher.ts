import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import { parseGermanDate } from "@/lib/german-date";
import type { HttpRequestBudget } from "@/lib/fetch-retry";
import { sourceEpoch } from "@/lib/content-dates";
import { getBaseShowInfoByTvdbId } from "./shows";
import { hasSharedTopicSeriesEvidence, isSharedSeriesTopic } from "./ruleset-identity";
import {
  ensureRulesetsLoaded,
  getRulesetsForTopic,
  getRulesetsForTopicAndTvdbId,
  getAllTopics,
  getOrGenerateRulesetForShow,
} from "./rulesets";
import { shouldSkipItem } from "./mediathek-release";
import { recordDecision } from "@/server/decision-diagnostics";
import type {
  ApiResultItem,
  TvdbData,
  TvdbEpisode,
  Ruleset,
  MatchedEpisodeInfo,
  Filter,
  TitleRegexRule,
  MatchType,
  TitleRegexRuleType,
  MatchingStrategy,
} from "@/types";
import { findEpisodeByAirDate, findEpisodeBySeasonAndNumber } from "@/types";

function getFieldValue(item: ApiResultItem, fieldName: string): string {
  switch (fieldName) {
    case "channel":
      return item.channel;
    case "topic":
      return item.topic;
    case "title":
      return item.title;
    case "description":
      return item.description;
    case "timestamp":
      return item.filmlisteTimestamp.toString();
    case "duration":
      return item.duration.toString();
    case "size":
      return item.size.toString();
    case "url_website":
      return item.url_website;
    case "url_video":
      return item.url_video;
    case "url_video_low":
      return item.url_video_low;
    case "url_video_hd":
      return item.url_video_hd;
    default:
      return "";
  }
}

function filterMatches(item: ApiResultItem, filter: Filter): boolean {
  const attributeValue = getFieldValue(item, filter.attribute);
  const filterValue = String(filter.value);

  switch (filter.type) {
    case "ExactMatch" as MatchType:
      return attributeValue.toLowerCase() === filterValue.toLowerCase();
    case "Contains" as MatchType:
      return attributeValue.toLowerCase().includes(filterValue.toLowerCase());
    case "Regex" as MatchType:
      try {
        return new RegExp(filterValue).test(attributeValue);
      } catch {
        return false;
      }
    case "GreaterThan" as MatchType: {
      const attrNum = parseFloat(attributeValue);
      const filterNum = parseFloat(filterValue);
      return !isNaN(attrNum) && !isNaN(filterNum) && attrNum > filterNum * 60;
    }
    case "LessThan" as MatchType: {
      const attrNum = parseFloat(attributeValue);
      const filterNum = parseFloat(filterValue);
      return !isNaN(attrNum) && !isNaN(filterNum) && attrNum < filterNum * 60;
    }
    default:
      return false;
  }
}

function extractValueUsingRegex(item: ApiResultItem, pattern: string | null): string | null {
  if (!pattern) return null;

  const fieldValue = getFieldValue(item, "title");
  if (!fieldValue) return null;

  try {
    const match = fieldValue.match(pattern);
    return match && match.length > 1 ? match[1] : null;
  } catch {
    return null;
  }
}

function buildTitleFromRegexRules(item: ApiResultItem, rulesJson: string): string | null {
  let rules: TitleRegexRule[];
  try {
    rules = JSON.parse(rulesJson);
  } catch {
    return null;
  }

  const parts: string[] = [];

  for (const rule of rules) {
    if (rule.type === ("static" as TitleRegexRuleType)) {
      if (rule.value) {
        parts.push(rule.value);
      }
    } else if (rule.type === ("regex" as TitleRegexRuleType)) {
      if (rule.pattern && rule.field) {
        const fieldValue = getFieldValue(item, rule.field);
        if (fieldValue) {
          try {
            const match = fieldValue.match(rule.pattern);
            if (match && match.length > 0) {
              // Use the last group
              parts.push(match[match.length - 1]);
            } else {
              return null; // Abort if regex match failed
            }
          } catch {
            return null;
          }
        }
      }
    }
  }

  return parts.join("");
}

function formatTitle(title: string): string {
  let formatted = title
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue");

  formatted = formatted.replace(/&/g, "and");
  formatted = formatted.replace(/[/:;,""''@#?$%^*+=!|<>,()]/g, "");
  formatted = formatted.replace(/\s+/g, ".").replace(/\.\./g, ".");

  return formatted;
}

// String similarity using Levenshtein distance
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

type MatchingStrategyPreference = "fuzzy" | "strict";

async function getMatchingSettings(): Promise<{
  strategy: MatchingStrategyPreference;
  threshold: number;
}> {
  const [strategySetting, thresholdSetting] = await Promise.all([
    getSetting("matching.strategy"),
    getSetting("matching.threshold"),
  ]);

  const strategy = configuredSetting(
    "matching.strategy",
    strategySetting
  ) as MatchingStrategyPreference;
  const threshold = Number(configuredSetting("matching.threshold", thresholdSetting));

  return { strategy, threshold };
}

async function getRulesetShow(
  tvdbId: number | null,
  provided?: TvdbData,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  if (tvdbId === null || !Number.isSafeInteger(tvdbId) || tvdbId < 1) return null;
  const show = provided?.id === tvdbId ? provided : await getBaseShowInfoByTvdbId(tvdbId, budget);
  // Supplementary metadata never enters permissive/fuzzy legacy ruleset matching.
  return show?.id === tvdbId
    ? { ...show, episodes: show.episodes.filter((episode) => episode.metadataSource !== "sonarr") }
    : null;
}

async function matchesSeasonAndEpisode(
  item: ApiResultItem,
  ruleset: Ruleset,
  provided?: TvdbData,
  budget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided, budget);
  if (!tvdbData?.episodes?.length) return null;

  const season = extractValueUsingRegex(item, ruleset.seasonRegex);
  const episode = extractValueUsingRegex(item, ruleset.episodeRegex);

  if (!season || !episode) return null;

  const seasonNum = parseInt(season);
  const episodeNum = parseInt(episode);
  if (isNaN(seasonNum) || isNaN(episodeNum)) return null;

  const matchedEpisode = findEpisodeBySeasonAndNumber(tvdbData, seasonNum, episodeNum);
  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: `S${season}E${episode}`,
    tvdbId: tvdbData.id,
  };
}

async function matchesItemTitleIncludes(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.7,
  provided?: TvdbData,
  budget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided, budget);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const formattedConstructed = formatTitle(constructedTitle).toLowerCase();

  // First try exact contains match
  let matchedEpisode = tvdbData.episodes.find((ep) =>
    formatTitle(ep.name).toLowerCase().includes(formattedConstructed)
  );

  // If no exact match, try fuzzy matching with threshold
  if (!matchedEpisode && threshold < 1.0) {
    let bestSimilarity = 0;
    for (const ep of tvdbData.episodes) {
      const similarity = stringSimilarity(formatTitle(ep.name), formattedConstructed);
      if (similarity >= threshold && similarity > bestSimilarity) {
        bestSimilarity = similarity;
        matchedEpisode = ep;
      }
    }
  }

  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: tvdbData.id,
  };
}

async function matchesItemTitleExact(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.95,
  provided?: TvdbData,
  budget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided, budget);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const formattedTitle = formatTitle(constructedTitle).toLowerCase();

  // First try exact match
  let matchedEpisodes = tvdbData.episodes.filter(
    (ep) => formatTitle(ep.name).toLowerCase() === formattedTitle
  );

  // If no exact match and threshold allows, try very high similarity matching
  if (matchedEpisodes.length === 0 && threshold < 1.0) {
    const highThreshold = Math.max(threshold, 0.9); // At least 90% for "exact" matching
    matchedEpisodes = tvdbData.episodes.filter((ep) => {
      const similarity = stringSimilarity(formatTitle(ep.name).toLowerCase(), formattedTitle);
      return similarity >= highThreshold;
    });
  }

  let matchedEpisode: TvdbEpisode | undefined;
  if (matchedEpisodes.length === 1) {
    matchedEpisode = matchedEpisodes[0];
  } else if (matchedEpisodes.length > 1) {
    // A catalogue refresh cannot disambiguate two identically named episodes.
    // Use an explicit source broadcast day only when it selects exactly one.
    const broadcastAt = sourceEpoch(item.contentDates?.broadcastAt);
    const sourceDay = broadcastAt ? new Date(broadcastAt * 1000).toISOString().slice(0, 10) : null;
    const sameDay = sourceDay
      ? matchedEpisodes.filter(
          (ep) =>
            ep.aired &&
            Number.isFinite(new Date(ep.aired).getTime()) &&
            new Date(ep.aired).toISOString().slice(0, 10) === sourceDay
        )
      : [];
    if (sameDay.length === 1) matchedEpisode = sameDay[0];
    else recordDecision("identity", "identity_ambiguous", "conflicting");
  }

  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: tvdbData.id,
  };
}

async function matchesItemTitleEqualsAirdate(
  item: ApiResultItem,
  ruleset: Ruleset,
  provided?: TvdbData,
  budget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided, budget);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const parsedDate = parseGermanDate(constructedTitle);
  if (!parsedDate) return null;

  const matchedEpisode = findEpisodeByAirDate(tvdbData, parsedDate);
  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: tvdbData.id,
  };
}

/** Existing ruleset assignment only; supplementary Sonarr identity has its own strict matcher. */
export async function applyRulesetFilters(
  results: ApiResultItem[],
  tvdbData: TvdbData | undefined,
  hlsEnabled: boolean,
  tvdbId: number | null = tvdbData?.id ?? null,
  budget?: HttpRequestBudget
): Promise<{ matchedEpisodes: MatchedEpisodeInfo[]; unmatchedItems: ApiResultItem[] }> {
  await ensureRulesetsLoaded(budget);
  const minDuration = await getMinDurationSeconds();
  const matchingSettings = await getMatchingSettings();
  console.log(
    `[Mediathek] Matching settings: strategy=${matchingSettings.strategy}, threshold=${matchingSettings.threshold}, minDuration=${minDuration}s, hlsEnabled=${hlsEnabled}`
  );

  const matchedEpisodes: MatchedEpisodeInfo[] = [];
  const unmatchedItems: ApiResultItem[] = [...results];

  // Log available rulesets for debugging
  if (tvdbData) {
    const allTopics = getAllTopics();
    console.log(`[Mediathek] Rulesets available: ${allTopics.length} topics`);

    // Check if any ruleset exists for this TVDB ID
    let foundRulesetForTvdbId = false;
    for (const topic of allTopics) {
      const rulesets = getRulesetsForTopicAndTvdbId(topic, tvdbData.id);
      if (rulesets.length > 0) {
        console.log(
          `[Mediathek] Found ${rulesets.length} ruleset(s) for topic "${topic}" with tvdbId ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      }
    }
    if (
      !foundRulesetForTvdbId &&
      !tvdbData.episodes.some((episode) => episode.metadataSource === "sonarr")
    ) {
      console.log(
        `[Mediathek] No rulesets found for tvdbId ${tvdbData.id} (${tvdbData.name}), attempting auto-generation...`
      );

      // Try to auto-generate a ruleset
      const generatedRuleset = await getOrGenerateRulesetForShow(tvdbData.id, tvdbData, budget);
      if (generatedRuleset) {
        console.log(
          `[Mediathek] Auto-generated ruleset for topic "${generatedRuleset.topic}" -> TVDB ${tvdbData.id}`
        );
        foundRulesetForTvdbId = true;
      } else {
        console.log(`[Mediathek] Could not auto-generate ruleset for ${tvdbData.name}`);
      }
    }
  }

  let checkedCount = 0;
  for (const item of results) {
    if (shouldSkipItem(item, minDuration, hlsEnabled)) {
      const idx = unmatchedItems.indexOf(item);
      if (idx > -1) unmatchedItems.splice(idx, 1);
      continue;
    }

    const targetTvdbId = tvdbData?.id ?? tvdbId;
    const rulesets =
      targetTvdbId === null
        ? getRulesetsForTopic(item.topic)
        : getRulesetsForTopicAndTvdbId(item.topic, targetTvdbId);

    // Log first few items to show what's being checked
    if (checkedCount < 5) {
      console.log(
        `[Mediathek] Checking item: topic="${item.topic}", title="${item.title}", rulesets found: ${rulesets.length}`
      );
      checkedCount++;
    }

    for (const ruleset of rulesets) {
      // Coordinates in a shared catalogue topic do not identify its series.
      if (isSharedSeriesTopic(item.topic)) {
        const show = await getRulesetShow(ruleset.media.media_tvdbId, tvdbData, budget);
        if (!show || !hasSharedTopicSeriesEvidence(item, show)) continue;
      }
      // Parse filters from JSON string
      let filters: Filter[];
      try {
        filters = JSON.parse(ruleset.filters);
      } catch {
        continue;
      }

      if (!filters.every((filter) => filterMatches(item, filter))) {
        continue;
      }

      let matchInfo: MatchedEpisodeInfo | null = null;

      // Apply matching with threshold from settings
      const threshold = matchingSettings.threshold;

      switch (ruleset.matchingStrategy) {
        case "SeasonAndEpisodeNumber" as MatchingStrategy:
          matchInfo = await matchesSeasonAndEpisode(item, ruleset, tvdbData, budget);
          break;
        case "ItemTitleIncludes" as MatchingStrategy:
          matchInfo = await matchesItemTitleIncludes(item, ruleset, threshold, tvdbData, budget);
          break;
        case "ItemTitleExact" as MatchingStrategy:
          // For strict strategy, require higher threshold
          const exactThreshold =
            matchingSettings.strategy === "strict" ? Math.max(threshold, 0.95) : threshold;
          matchInfo = await matchesItemTitleExact(item, ruleset, exactThreshold, tvdbData, budget);
          break;
        case "ItemTitleEqualsAirdate" as MatchingStrategy:
          matchInfo = await matchesItemTitleEqualsAirdate(item, ruleset, tvdbData, budget);
          break;
      }

      if (matchInfo) {
        matchedEpisodes.push(matchInfo);
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        break;
      }
    }
  }

  return { matchedEpisodes, unmatchedItems };
}
