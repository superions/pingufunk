import { isRenditionAllowed } from "@/lib/stream-url";
import { mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { getConfiguredLanguagePolicy, queryContent, searchCacheContext } from "./content-search";
import { selectLanguageVariants } from "./language-editions";
import { getBaseShowInfoByTvdbId, getBaseShowForSonarrRss } from "./shows";
import { getSonarrRssMatches } from "./sonarr-rss";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { SonarrUnavailableError } from "./sonarr-provider";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { createHash } from "node:crypto";
import {
  ensureRulesetsLoaded,
  getRulesetsForTopic,
  getRulesetsForTopicAndTvdbId,
  getAllTopics,
  getOrGenerateRulesetForShow,
} from "./rulesets";
import {
  generateRssItems,
  generateMovieRssItems,
  generateGenericRssItems,
  applyLanguageEdition,
  buildReleaseGuid,
  convertItemsToRss,
  serializeRss,
  getEmptyRssResult,
  QualityPreference,
  parseEpisodeFromTitle,
} from "./newznab";
import { matchMovieItems } from "./movie-matcher";
import { createFakeNzbDownloadUrl } from "./nzb-release";
import { searchMovieByTitle } from "./tmdb";
import type {
  ApiResultItem,
  TvdbData,
  TvdbEpisode,
  TmdbMovieData,
  Ruleset,
  MatchedEpisodeInfo,
  NewznabItem,
  Filter,
  TitleRegexRule,
  MatchType,
  TitleRegexRuleType,
  MatchingStrategy,
  TvSearchContext,
} from "@/types";
import { findEpisodeByAirDate, findEpisodeBySeasonAndNumber } from "@/types";

const QUERY_FIELDS = ["topic", "title"];
const VALID_QUALITIES: QualityPreference[] = ["all", "best", "1080p", "720p", "480p"];
const TV_SEARCH_CANDIDATE_LIMIT = 1500;
const RSS_SYNC_CANDIDATE_LIMIT = 6000;
const CONTENT_SEARCH_CACHE_VERSION = "v3";
const GERMAN_MONTHS: Record<string, number> = {
  januar: 0,
  februar: 1,
  märz: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  dezember: 11,
};

function tvSearchContextKey(context: TvSearchContext): string {
  return JSON.stringify([context.query, context.tvdbId, context.season, context.episode]);
}

function hasEpisodeCoordinates(context: TvSearchContext): boolean {
  return !!context.season || !!context.episode;
}

function matchesGenericSearchContext(item: ApiResultItem, context: TvSearchContext): boolean {
  if (context.tvdbId !== null) return false;
  return !hasEpisodeCoordinates(context) || matchesSourceCoordinates(item, context);
}

async function isHlsEnabled(): Promise<boolean> {
  const setting = await getSetting("download.enableHLS");
  return setting === "true";
}

async function getQualityPreference(): Promise<QualityPreference> {
  const setting = await getSetting("download.quality");
  if (setting && VALID_QUALITIES.includes(setting as QualityPreference)) {
    return setting as QualityPreference;
  }
  return "all"; // Default to all qualities
}

// Keywords that are always skipped (trailers, outtakes, etc.)
const SKIP_KEYWORDS = ["Trailer", "Outtakes:", "(klare Sprache)"];

function shouldSkipItem(
  item: ApiResultItem,
  minDuration: number,
  hlsEnabled: boolean = false
): boolean {
  // Keep an item when any rendition is usable; generators apply this same gate
  // to each URL so a blocked HLS variant cannot discard or re-enter the feed.
  if (
    ![item.url_video, item.url_video_low, item.url_video_hd].some((url) =>
      isRenditionAllowed(url, hlsEnabled)
    )
  )
    return true;
  if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return true;
  if (minDuration > 0 && item.duration < minDuration) return true;
  return false;
}

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

  const strategy: MatchingStrategyPreference = strategySetting === "strict" ? "strict" : "fuzzy";

  let threshold = 0.7;
  if (thresholdSetting) {
    // Handle both "0.7" and "0,7" formats
    const parsed = parseFloat(thresholdSetting.replace(",", "."));
    if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) {
      threshold = parsed;
    }
  }

  return { strategy, threshold };
}

function tryParseDate(dateString: string): Date | null {
  // Supported German date formats:
  // - "d. MMMM yyyy" (e.g., "7. Juni 2024")
  // - "dd.MM.yyyy" (e.g., "31.12.2017")
  // - "yyyy-MM-dd" (e.g., "2017-12-01")
  // - "yyyyMMdd" (e.g., "20171201")

  const makeDate = (year: number, month: number, day: number): Date | null => {
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date
      : null;
  };

  // Try "d. MMMM yyyy" format
  const match1 = dateString.match(/^(\d{1,2})\. (\p{L}+) (\d{4})$/u);
  if (match1) {
    const day = parseInt(match1[1]);
    const month = GERMAN_MONTHS[match1[2].toLowerCase()];
    const year = parseInt(match1[3]);
    if (month !== undefined) {
      return makeDate(year, month, day);
    }
  }

  // Try "dd.MM.yyyy" format
  const match2 = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match2) {
    return makeDate(parseInt(match2[3]), parseInt(match2[2]) - 1, parseInt(match2[1]));
  }

  // Try "yyyy-MM-dd" format
  const match3 = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match3) {
    return makeDate(parseInt(match3[1]), parseInt(match3[2]) - 1, parseInt(match3[3]));
  }

  // Try "yyyyMMdd" format
  const match4 = dateString.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match4) {
    return makeDate(parseInt(match4[1]), parseInt(match4[2]) - 1, parseInt(match4[3]));
  }

  return null;
}

async function getRulesetShow(tvdbId: number, provided?: TvdbData): Promise<TvdbData | null> {
  const show = provided?.id === tvdbId ? provided : await getBaseShowInfoByTvdbId(tvdbId);
  // Supplementary metadata never enters permissive/fuzzy legacy ruleset matching.
  return show
    ? { ...show, episodes: show.episodes.filter((episode) => episode.metadataSource !== "sonarr") }
    : null;
}

async function matchesSeasonAndEpisode(
  item: ApiResultItem,
  ruleset: Ruleset,
  provided?: TvdbData
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided);
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
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleIncludes(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.7,
  provided?: TvdbData
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided);
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
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleExact(
  item: ApiResultItem,
  ruleset: Ruleset,
  threshold: number = 0.95,
  provided?: TvdbData
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided);
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
    // Try to match by aired date
    const itemDate = new Date(item.filmlisteTimestamp * 1000);
    matchedEpisode = matchedEpisodes.find((ep) => {
      if (!ep.aired) return false;
      const epDate = new Date(ep.aired);
      return epDate.toDateString() === itemDate.toDateString();
    });
    // Fallback to newest
    if (!matchedEpisode) {
      matchedEpisode = matchedEpisodes.sort((a, b) => {
        const aDate = a.aired ? new Date(a.aired).getTime() : 0;
        const bDate = b.aired ? new Date(b.aired).getTime() : 0;
        return bDate - aDate;
      })[0];
    }
  }

  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function matchesItemTitleEqualsAirdate(
  item: ApiResultItem,
  ruleset: Ruleset,
  provided?: TvdbData
): Promise<MatchedEpisodeInfo | null> {
  const tvdbData = await getRulesetShow(ruleset.media.media_tvdbId, provided);
  if (!tvdbData?.episodes?.length) return null;

  const constructedTitle = buildTitleFromRegexRules(item, ruleset.titleRegexRules);
  if (!constructedTitle) return null;

  const parsedDate = tryParseDate(constructedTitle);
  if (!parsedDate) return null;

  const matchedEpisode = findEpisodeByAirDate(tvdbData, parsedDate);
  if (!matchedEpisode) return null;

  return {
    episode: matchedEpisode,
    item,
    showName: tvdbData.name || tvdbData.germanName || "",
    matchedTitle: constructedTitle,
    tvdbId: ruleset.media.media_tvdbId,
  };
}

async function applyRulesetFilters(
  results: ApiResultItem[],
  tvdbData: TvdbData | undefined,
  hlsEnabled: boolean,
  tvdbId: number | null = tvdbData?.id ?? null
): Promise<{ matchedEpisodes: MatchedEpisodeInfo[]; unmatchedItems: ApiResultItem[] }> {
  await ensureRulesetsLoaded();
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
      const generatedRuleset = await getOrGenerateRulesetForShow(tvdbData.id, tvdbData);
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
      // Parse filters from JSON string
      let filters: Filter[];
      try {
        filters = JSON.parse(ruleset.filters);
      } catch {
        filters = [];
      }

      if (!filters.every((filter) => filterMatches(item, filter))) {
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        continue;
      }

      let matchInfo: MatchedEpisodeInfo | null = null;

      // Apply matching with threshold from settings
      const threshold = matchingSettings.threshold;

      switch (ruleset.matchingStrategy) {
        case "SeasonAndEpisodeNumber" as MatchingStrategy:
          matchInfo = await matchesSeasonAndEpisode(item, ruleset, tvdbData);
          break;
        case "ItemTitleIncludes" as MatchingStrategy:
          matchInfo = await matchesItemTitleIncludes(item, ruleset, threshold, tvdbData);
          break;
        case "ItemTitleExact" as MatchingStrategy:
          // For strict strategy, require higher threshold
          const exactThreshold =
            matchingSettings.strategy === "strict" ? Math.max(threshold, 0.95) : threshold;
          matchInfo = await matchesItemTitleExact(item, ruleset, exactThreshold, tvdbData);
          break;
        case "ItemTitleEqualsAirdate" as MatchingStrategy:
          matchInfo = await matchesItemTitleEqualsAirdate(item, ruleset, tvdbData);
          break;
      }

      if (matchInfo) {
        matchedEpisodes.push(matchInfo);
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
        break;
      } else {
        const idx = unmatchedItems.indexOf(item);
        if (idx > -1) unmatchedItems.splice(idx, 1);
      }
    }
  }

  return { matchedEpisodes, unmatchedItems };
}

function parseNumericCoordinate(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function getDailyDateKey(context: TvSearchContext): string | null | undefined {
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

function getDesiredEpisodes(tvdbData: TvdbData, context: TvSearchContext): TvdbEpisode[] | null {
  if (!context.season && !context.episode) return null;
  return tvdbData.episodes.filter((episode) => matchesTvdbEpisode(episode, context));
}

function getTvSearchCandidateQueries(
  context: TvSearchContext
): Array<{ fields: string[]; query: string }> {
  // Query alternatives separately: the provider combines clauses with AND.
  if (context.query) return [{ fields: QUERY_FIELDS, query: context.query }];

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

async function queryTvSearchCandidates(context: TvSearchContext): Promise<ApiResultItem[] | null> {
  const candidateQueries = getTvSearchCandidateQueries(context);
  if (candidateQueries.length === 0) return [];

  // Each provider query has its own source cap. Newznab total below describes
  // the filtered union, not the source's full catalog.
  const candidates = await Promise.all(
    candidateQueries.map((query) => queryContent([query], TV_SEARCH_CANDIDATE_LIMIT))
  );
  if (candidates.some((results) => results === null)) return null;

  const uniqueCandidates = new Map<string, ApiResultItem>();
  for (const item of candidates.flatMap((results) => results ?? [])) {
    const identity = JSON.stringify(item);
    if (!uniqueCandidates.has(identity)) uniqueCandidates.set(identity, item);
  }

  return selectLanguageVariants(
    [...uniqueCandidates.values()],
    await getConfiguredLanguagePolicy()
  );
}

function dedupeNewznabItems(items: NewznabItem[]): NewznabItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    // Keep different URLs/qualities; remove only the same release emitted twice.
    const identity = JSON.stringify([item.guid.value, item.link, item.title]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}

function applyDesiredEpisodeFilter(
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

export async function fetchSearchResultsById(
  tvdbData: TvdbData,
  searchContext: TvSearchContext,
  limit: number,
  offset: number,
  requestBudget?: HttpRequestBudget
): Promise<string> {
  const context: TvSearchContext = {
    ...searchContext,
    query: searchContext.query?.trim() || null,
    tvdbId: searchContext.tvdbId ?? tvdbData.id,
  };
  if (context.tvdbId !== tvdbData.id) return serializeRss(getEmptyRssResult(offset));

  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const matchingSettings = await getMatchingSettings();
  const hlsEnabled = await isHlsEnabled();
  const searchQuery = context.query || tvdbData.germanName || tvdbData.name;
  console.log(
    `[Mediathek] fetchSearchResultsById: tvdbId=${tvdbData.id}, name="${tvdbData.name}", germanName="${tvdbData.germanName}", season=${context.season}, episode=${context.episode}, quality=${quality}, minDuration=${minDuration}`
  );

  const contextKey = tvSearchContextKey(context);
  const sourceContext = await searchCacheContext();
  const metadataContext = createHash("sha256").update(JSON.stringify(tvdbData)).digest("hex");
  const cacheKey = `tvdb_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}_${hlsEnabled}_${sourceContext}_${metadataContext}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  const desiredEpisodes = getDesiredEpisodes(tvdbData, context);
  console.log(`[Mediathek] Desired episodes: ${desiredEpisodes?.length ?? 0}`);
  if (hasEpisodeCoordinates(context) && desiredEpisodes?.length === 0) {
    if (tvdbData.sonarrUnavailable) throw new SonarrUnavailableError();
    console.log(
      `[Mediathek] No desired episodes found for season=${context.season}, episode=${context.episode}, returning empty`
    );
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Check for cached API response
  const apiCacheKey = `mediathekapi_tvdb_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    console.log(`[Mediathek] Using cached API response for ${apiCacheKey}`);
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    console.log(`[Mediathek] Searching MediathekView API with query: "${searchQuery}"`);
    const supplemented = (desiredEpisodes ?? tvdbData.episodes).some(
      (episode) => episode.metadataSource === "sonarr"
    );
    results = await queryContent(
      [{ fields: QUERY_FIELDS, query: searchQuery }],
      10000,
      supplemented
        ? {
            requestBudget: requestBudget ?? new HttpRequestBudget(),
            progressiveOnly: (desiredEpisodes ?? tvdbData.episodes).every(
              (episode) => episode.metadataSource === "sonarr"
            ),
          }
        : {}
    );

    if (results === null) throw new Error("Search provider unavailable");
    if (results.length === 0) {
      return serializeRss(getEmptyRssResult(offset));
    }

    mediathekCache.set(apiCacheKey, { results });
  }

  console.log(`[Mediathek] API returned ${results.length} results`);
  if (results.length > 0) {
    const uniqueTopics = [...new Set(results.map((r) => r.topic))];
    console.log(
      `[Mediathek] Unique topics in results: ${uniqueTopics.slice(0, 10).join(", ")}${uniqueTopics.length > 10 ? ` ... (${uniqueTopics.length} total)` : ""}`
    );
  }

  const { matchedEpisodes } = await applyRulesetFilters(
    results,
    tvdbData,
    hlsEnabled,
    context.tvdbId
  );
  console.log(`[Mediathek] Matched episodes after ruleset filtering: ${matchedEpisodes.length}`);

  const toleranceSetting = await getSetting("matching.sonarr.tolerancePercent");
  const tolerance = toleranceSetting === null ? 10 : Number(toleranceSetting);
  const supplementalMatches = matchSonarrEpisodes(
    tvdbData,
    results,
    minDuration,
    tolerance,
    await getConfiguredLanguagePolicy()
  );
  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(
    [...matchedEpisodes, ...supplementalMatches],
    desiredEpisodes,
    context
  );
  console.log(`[Mediathek] Matched desired episodes: ${matchedDesiredEpisodes.length}`);

  const newznabItems: NewznabItem[] = matchedDesiredEpisodes.flatMap((info) =>
    generateRssItems(info, quality, info.episode.metadataSource === "sonarr" ? false : hlsEnabled)
  );
  console.log(`[Mediathek] Generated ${newznabItems.length} Newznab items (quality: ${quality})`);

  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

export async function fetchSearchResultsByString(
  searchContext: TvSearchContext,
  limit: number,
  offset: number
): Promise<string> {
  const context: TvSearchContext = {
    ...searchContext,
    query: searchContext.query?.trim() || null,
  };
  const trimmedQ = context.query;
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const matchingSettings = await getMatchingSettings();
  const hlsEnabled = await isHlsEnabled();
  const contextKey = tvSearchContextKey(context);
  const sourceContext = await searchCacheContext();
  const cacheKey = `q_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}_${hlsEnabled}_${sourceContext}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = `mediathekapi_q_${CONTENT_SEARCH_CACHE_VERSION}_${contextKey}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    results = await queryTvSearchCandidates(context);
    if (results === null) {
      throw new Error("Search provider unavailable");
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  const { matchedEpisodes, unmatchedItems } = await applyRulesetFilters(
    results,
    undefined,
    hlsEnabled,
    context.tvdbId
  );
  const matchedDesiredEpisodes = applyDesiredEpisodeFilter(matchedEpisodes, null, context);
  const newznabItems: NewznabItem[] = matchedDesiredEpisodes.flatMap((info) =>
    generateRssItems(info, quality, hlsEnabled)
  );

  // Coordinate-only candidates may span unrelated shows, so publish only items
  // tied to a ruleset unless the caller also supplied a text query.
  const hasTextQuery = !!trimmedQ;
  const genericItems: NewznabItem[] = hasTextQuery
    ? unmatchedItems
        .filter((item) => matchesGenericSearchContext(item, context))
        .flatMap((item) => generateGenericRssItems(item, quality, hlsEnabled))
    : [];

  const allItems = dedupeNewznabItems([...newznabItems, ...genericItems]);
  const response = convertItemsToRss(allItems, limit, offset);

  mediathekCache.set(cacheKey, { response });
  return response;
}

export async function fetchSearchResultsForRssSync(limit: number, offset: number): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const matchingSettings = await getMatchingSettings();
  const hlsEnabled = await isHlsEnabled();
  const sourceContext = await searchCacheContext();
  // Build before consulting the normal RSS response cache: otherwise its hour
  // TTL would prevent the 60s Sonarr snapshot/cursor from ever refreshing.
  let supplementalMatches: MatchedEpisodeInfo[] = [];
  let sonarrUnavailable = false;
  try {
    supplementalMatches = await getSonarrRssMatches(getBaseShowForSonarrRss);
  } catch {
    sonarrUnavailable = true;
  }
  const supplementalContext = createHash("sha256")
    .update(JSON.stringify(supplementalMatches))
    .digest("hex");
  const cacheKey = `rss_${CONTENT_SEARCH_CACHE_VERSION}_${limit}_${offset}_${quality}_${minDuration}_${matchingSettings.threshold}_${hlsEnabled}_${sourceContext}_${supplementalContext}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && !sonarrUnavailable) {
    return (cached as { response: string }).response;
  }

  const apiCacheKey = `rss_mediathekview_results_${CONTENT_SEARCH_CACHE_VERSION}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    // total below counts verified matches in this bounded source window only.
    results = await queryContent([], RSS_SYNC_CANDIDATE_LIMIT);
    if (results === null) {
      throw new Error("Search provider unavailable");
    }
    mediathekCache.set(apiCacheKey, { results });
  }

  const { matchedEpisodes } = await applyRulesetFilters(results, undefined, hlsEnabled);
  if (sonarrUnavailable && matchedEpisodes.length === 0) throw new SonarrUnavailableError();
  const newznabItems: NewznabItem[] = [...matchedEpisodes, ...supplementalMatches].flatMap((info) =>
    generateRssItems(info, quality, info.episode.metadataSource === "sonarr" ? false : hlsEnabled)
  );
  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);

  if (!sonarrUnavailable) mediathekCache.set(cacheKey, { response });
  return response;
}

// ============== MOVIE SEARCH FUNCTIONS ==============

/**
 * Search for a movie in the Mediathek by TMDB data
 */
export async function fetchMovieSearchResults(
  movieData: TmdbMovieData,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();
  console.log(
    `[Mediathek] fetchMovieSearchResults: tmdbId=${movieData.tmdbId}, title="${movieData.title}", germanTitle="${movieData.germanTitle}", runtime=${movieData.runtime} min, quality=${quality}, minDuration=${minDuration}s`
  );

  const sourceContext = await searchCacheContext();
  const cacheKey = `movie_${CONTENT_SEARCH_CACHE_VERSION}_${movieData.tmdbId}_${limit}_${offset}_${quality}_${minDuration}_${hlsEnabled}_${sourceContext}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached movie response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search by German title and original title in parallel
  const searchTerms = [movieData.germanTitle];
  if (movieData.title !== movieData.germanTitle) {
    searchTerms.push(movieData.title);
  }
  const deadlineAt = Date.now() + 20_000;

  // Helper function to fetch results for a single search term
  async function fetchForTerm(searchTerm: string): Promise<ApiResultItem[] | null> {
    const apiCacheKey = `mediathekapi_movie_${CONTENT_SEARCH_CACHE_VERSION}_${searchTerm}_${sourceContext}`;
    const cachedApi = mediathekCache.get(apiCacheKey);

    if (cachedApi) {
      console.log(`[Mediathek] Using cached API response for movie search: "${searchTerm}"`);
      return (cachedApi as { results: ApiResultItem[] }).results;
    }

    console.log(`[Mediathek] Searching MediathekView API for movie: "${searchTerm}"`);
    const results = await queryContent([{ fields: QUERY_FIELDS, query: searchTerm }], 500, {
      deadlineAt,
    });
    if (results === null) return null;
    console.log(`[Mediathek] API returned ${results.length} results for "${searchTerm}"`);
    mediathekCache.set(apiCacheKey, { results });
    return results;
  }

  // Fetch all search terms in parallel
  const resultsPerTerm = await Promise.all(searchTerms.map(fetchForTerm));
  if (resultsPerTerm.some((results) => results === null)) {
    throw new Error("Search provider unavailable");
  }

  // Merge search terms before choosing the best edition and deduplicating media URLs.
  const collectedResults: ApiResultItem[] = [];
  for (const results of resultsPerTerm) {
    if (results === null) continue;
    collectedResults.push(...results);
  }
  const allResults = selectLanguageVariants(collectedResults, await getConfiguredLanguagePolicy());

  if (allResults.length === 0) {
    console.log(`[Mediathek] No results found for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  console.log(`[Mediathek] Total results for movie matching: ${allResults.length}`);

  // Filter out trailers and other non-movie content
  const filteredResults = allResults.filter(
    (item) => !SKIP_KEYWORDS.some((kw) => item.title.includes(kw))
  );
  console.log(`[Mediathek] Results after filtering: ${filteredResults.length}`);

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No results after filtering for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Match results against movie data
  const matchResults = await matchMovieItems(filteredResults, movieData, minDuration, hlsEnabled);

  if (matchResults.length === 0) {
    console.log(`[Mediathek] No matches found for movie`);
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Generate RSS items using the same rendition setting used for matching.
  const newznabItems: NewznabItem[] = matchResults.flatMap((match) =>
    generateMovieRssItems(match, movieData, quality, hlsEnabled)
  );

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie (quality: ${quality})`
  );

  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);
  mediathekCache.set(cacheKey, { response });
  return response;
}

/**
 * Search for movies in the Mediathek by query string (for Radarr text search)
 * Filters by minimum duration to identify feature films
 */
export async function fetchMovieSearchByQuery(
  query: string,
  limit: number,
  offset: number
): Promise<string> {
  const quality = await getQualityPreference();
  const minDuration = await getMinDurationSeconds();
  const hlsEnabled = await isHlsEnabled();

  // Strip trailing year from query (Radarr sends "Movie Title 2018")
  const cleanedQuery = query.replace(/\s+\d{4}$/, "").trim();
  const yearMatch = query.match(/\s+(\d{4})$/);
  const searchYear = yearMatch ? parseInt(yearMatch[1], 10) : null;

  console.log(
    `[Mediathek] fetchMovieSearchByQuery: query="${query}", cleanedQuery="${cleanedQuery}", year=${searchYear}, quality=${quality}, minDuration=${minDuration}s`
  );

  // Try to find the movie on TMDB to get IDs for Radarr matching
  const tmdbMovie = await searchMovieByTitle(cleanedQuery, searchYear);
  if (tmdbMovie) {
    console.log(
      `[Mediathek] Found TMDB match: "${tmdbMovie.germanTitle}" (TMDB: ${tmdbMovie.tmdbId}, IMDB: ${tmdbMovie.imdbId})`
    );
  }

  const sourceContext = await searchCacheContext();
  const cacheKey = `movie_query_${CONTENT_SEARCH_CACHE_VERSION}_${cleanedQuery}_${searchYear || ""}_${limit}_${offset}_${quality}_${minDuration}_${hlsEnabled}_${sourceContext}`;

  const cached = mediathekCache.get(cacheKey);
  if (cached && typeof cached === "object" && "response" in cached) {
    console.log(`[Mediathek] Returning cached movie query response for ${cacheKey}`);
    return (cached as { response: string }).response;
  }

  // Search Mediathek by query (without year)
  const apiCacheKey = `mediathekapi_movie_query_${CONTENT_SEARCH_CACHE_VERSION}_${cleanedQuery}_${sourceContext}`;
  let results: ApiResultItem[] | null;
  const cachedApi = mediathekCache.get(apiCacheKey);

  if (cachedApi) {
    console.log(`[Mediathek] Using cached API response for movie query: "${cleanedQuery}"`);
    results = (cachedApi as { results: ApiResultItem[] }).results;
  } else {
    console.log(`[Mediathek] Searching MediathekView API for movie query: "${cleanedQuery}"`);
    results = await queryContent([{ fields: QUERY_FIELDS, query: cleanedQuery }], 500);
    if (results === null) {
      throw new Error("Search provider unavailable");
    }
    console.log(
      `[Mediathek] API returned ${results.length} results for movie query "${cleanedQuery}"`
    );
    mediathekCache.set(apiCacheKey, { results });
  }

  if (results.length === 0) {
    console.log(`[Mediathek] No API response for movie query`);
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Filter trailers and apply the configured minimum duration. Each URL variant
  // is checked for HLS below so direct alternatives remain available.
  const filteredResults = results.filter((item) => {
    if (SKIP_KEYWORDS.some((kw) => item.title.includes(kw))) return false;
    if (minDuration > 0 && item.duration < minDuration) return false;
    return true;
  });

  console.log(
    `[Mediathek] Results after movie filtering (min ${minDuration}s): ${filteredResults.length}`
  );

  if (filteredResults.length === 0) {
    console.log(`[Mediathek] No movie results after filtering`);
    const response = serializeRss(getEmptyRssResult(offset));
    mediathekCache.set(cacheKey, { response });
    return response;
  }

  // Generate RSS items directly for the filtered results (as movies)
  const newznabItems: NewznabItem[] = [];

  for (const item of filteredResults) {
    // Format the release title
    const baseTitle = formatTitle(item.topic || item.title);
    const year = new Date(item.filmlisteTimestamp * 1000).getFullYear();

    // Calculate size
    const size = item.size > 0 ? item.size : item.duration * 500000;

    // Create item for each available quality
    const qualities: Array<{
      url: string;
      qualityName: string;
      category: string;
      sizeMultiplier: number;
    }> = [];

    const has1080p = isRenditionAllowed(item.url_video_hd, hlsEnabled);
    const has720p = isRenditionAllowed(item.url_video, hlsEnabled);
    const has480p = isRenditionAllowed(item.url_video_low, hlsEnabled);

    if (has1080p && (quality === "all" || quality === "best" || quality === "1080p")) {
      qualities.push({
        url: item.url_video_hd,
        qualityName: "1080p",
        category: "2040",
        sizeMultiplier: 1.6,
      });
    }
    if (has720p && (quality === "all" || quality === "720p" || (quality === "best" && !has1080p))) {
      qualities.push({
        url: item.url_video,
        qualityName: "720p",
        category: "2040",
        sizeMultiplier: 1.0,
      });
    }
    if (
      has480p &&
      (quality === "all" || quality === "480p" || (quality === "best" && !has1080p && !has720p))
    ) {
      qualities.push({
        url: item.url_video_low,
        qualityName: "480p",
        category: "2030",
        sizeMultiplier: 0.5,
      });
    }

    for (const q of qualities) {
      const releaseTitle = applyLanguageEdition(
        `${baseTitle}.${year}.${q.qualityName}.WEB.h264-MEDiATHEK`,
        item
      );
      const adjustedSize = Math.floor(size * q.sizeMultiplier);

      const fakeDownloadUrl = createFakeNzbDownloadUrl({ title: releaseTitle, url: q.url });

      newznabItems.push({
        title: releaseTitle,
        guid: {
          isPermaLink: true,
          value: buildReleaseGuid(
            item,
            q.qualityName,
            q.url,
            `movie-text:${tmdbMovie?.tmdbId ?? "unmatched"}:${cleanedQuery}:${year}`
          ),
        },
        link: q.url,
        comments: item.url_website || "",
        pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
        category: q.category === "2030" ? "Movies > SD" : "Movies > HD",
        description: item.description || "",
        enclosure: {
          url: fakeDownloadUrl,
          length: adjustedSize,
          type: "application/x-nzb",
        },
        attributes: [
          { name: "category", value: "2000" },
          { name: "category", value: q.category },
          ...(tmdbMovie?.tmdbId ? [{ name: "tmdbid", value: tmdbMovie.tmdbId.toString() }] : []),
          ...(tmdbMovie?.imdbId ? [{ name: "imdbid", value: tmdbMovie.imdbId }] : []),
        ],
      });
    }
  }

  console.log(
    `[Mediathek] Generated ${newznabItems.length} Newznab items for movie query (quality: ${quality})`
  );

  const response = convertItemsToRss(dedupeNewznabItems(newznabItems), limit, offset);
  mediathekCache.set(cacheKey, { response });
  return response;
}
