import { createHash } from "node:crypto";
import { isPlaceholderEpisodeTitle } from "@/lib/episode-title";
import { Builder } from "xml2js";
import { selectRenditions, type QualityPreference } from "./rendition-quality";
export type { QualityPreference } from "./rendition-quality";
import type {
  NewznabRss,
  NewznabItem,
  NewznabAttribute,
  MatchedEpisodeInfo,
  TvdbEpisode,
  EpisodeType,
  TmdbMovieData,
  ApiResultItem,
} from "@/types";
import type { MovieMatchResult } from "./movie-matcher";
import {
  classifyLanguageEdition,
  getLanguageSourceIdentity,
  stableUrlIdentity,
} from "./language-editions";
import { createFakeNzbDownloadUrl } from "./nzb-release";
import { releaseMediaExpectations } from "./release-media-expectations";
import { hasMediaRuntimeConflict } from "@/lib/media-expectations";

export { generateFakeNzb } from "./nzb-release";

const XML_BUILDER = new Builder({
  xmldec: { version: "1.0", encoding: "UTF-8" },
  renderOpts: { pretty: true },
});

const MOVIE_CATEGORY_IDS = new Set([
  "2000",
  "2010",
  "2020",
  "2030",
  "2040",
  "2045",
  "2050",
  "2060",
]);
const TV_CATEGORY_IDS = new Set(["5000", "5030", "5040"]);
const ADVERTISED_CATEGORY_IDS = new Set([...MOVIE_CATEGORY_IDS, ...TV_CATEGORY_IDS]);

export function generateAttributes(
  season: string | null,
  categoryValues: string[],
  tvdbId?: number
): NewznabAttribute[] {
  const attributes: NewznabAttribute[] = [];

  for (const categoryValue of categoryValues) {
    attributes.push({ name: "category", value: categoryValue });
  }

  if (season) {
    attributes.push({ name: "season", value: season });
  }

  if (tvdbId) {
    attributes.push({ name: "tvdbid", value: tvdbId.toString() });
  }

  return attributes;
}

export function getEmptyRssResult(offset: number = 0): NewznabRss {
  return {
    channel: {
      title: "RundfunkArr",
      description: "RundfunkArr API results",
      response: {
        offset,
        total: 0,
      },
      items: [],
    },
  };
}

export function serializeRss(rss: NewznabRss): string {
  const xmlObj = {
    rss: {
      $: {
        version: "2.0",
        "xmlns:newznab": "http://www.newznab.com/DTD/2010/feeds/attributes/",
      },
      channel: {
        title: rss.channel.title,
        description: rss.channel.description,
        "newznab:response": {
          $: {
            offset: rss.channel.response.offset,
            total: rss.channel.response.total,
          },
        },
        item: rss.channel.items.map((item) => ({
          title: item.title,
          guid: {
            $: { isPermaLink: item.guid.isPermaLink },
            _: item.guid.value,
          },
          link: item.link,
          comments: item.comments,
          pubDate: item.pubDate,
          category: item.category,
          description: item.description,
          enclosure: {
            $: {
              url: item.enclosure.url,
              length: item.enclosure.length,
              type: item.enclosure.type,
            },
          },
          "newznab:attr": item.attributes.map((attr) => ({
            $: { name: attr.name, value: attr.value },
          })),
        })),
      },
    },
  };

  return XML_BUILDER.buildObject(xmlObj);
}

export function convertItemsToRss(items: NewznabItem[], limit: number, offset: number): string {
  if (!items || items.length === 0) {
    return serializeRss(getEmptyRssResult(offset));
  }

  const paginatedItems = items.slice(offset, offset + limit);

  const rss: NewznabRss = {
    channel: {
      title: "RundfunkArr",
      description: "RundfunkArr API results",
      response: {
        offset: offset,
        total: items.length,
      },
      items: paginatedItems,
    },
  };

  return serializeRss(rss);
}

export function parseNewznabCategoryIds(categoryParam: string | null): string[] {
  if (!categoryParam) {
    return [];
  }

  return [
    ...new Set(
      categoryParam
        .split(",")
        .map((category) => category.trim())
        .filter((category) => /^\d+$/.test(category))
    ),
  ];
}

export function isMovieCategoryRequest(categoryIds: string[]): boolean {
  return categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId));
}

export function getValidationRss(requestedCategoryIds: string[], now: Date = new Date()): string {
  const categoryIds = requestedCategoryIds.filter((categoryId) =>
    ADVERTISED_CATEGORY_IDS.has(categoryId)
  );
  const hasMovieCategory = categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId));
  const hasTvCategory = categoryIds.some((categoryId) => TV_CATEGORY_IDS.has(categoryId));

  if (hasMovieCategory && !categoryIds.includes("2000")) {
    categoryIds.push("2000");
  }
  if (hasTvCategory && !categoryIds.includes("5000")) {
    categoryIds.push("5000");
  }
  if (categoryIds.length === 0) {
    categoryIds.push("2000", "5000");
  }

  const movieOnly =
    categoryIds.some((categoryId) => MOVIE_CATEGORY_IDS.has(categoryId)) &&
    !categoryIds.some((categoryId) => TV_CATEGORY_IDS.has(categoryId));
  const title = movieOnly
    ? "RundfunkArr.Validation.2024.1080p.WEB.h264-TEST"
    : "RundfunkArr.Validation.S01E01.1080p.WEB.h264-TEST";

  const validationItem: NewznabItem = {
    title,
    guid: {
      isPermaLink: false,
      value: `rundfunkarr-validation-${movieOnly ? "movie" : "tv"}`,
    },
    link: "https://example.invalid/rundfunkarr-validation",
    comments: "https://example.invalid/rundfunkarr-validation",
    pubDate: now.toUTCString(),
    category: movieOnly ? "Movies > HD" : "TV > HD",
    description: "Synthetic result used to validate RundfunkArr category support.",
    enclosure: {
      url: "https://example.invalid/rundfunkarr-validation.nzb",
      length: 1_000_000,
      type: "application/x-nzb",
    },
    attributes: [
      ...categoryIds.map((categoryId) => ({ name: "category", value: categoryId })),
      { name: "size", value: "1000000" },
    ],
  };

  return convertItemsToRss([validationItem], 1, 0);
}

// Title formatting utilities
function formatTitle(title: string): string {
  // Replace German Umlaute and special characters
  let formatted = title
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue");

  // Replace & with and
  formatted = formatted.replace(/&/g, "and");

  // Remove unwanted symbols
  formatted = formatted.replace(/[/:;,""''@#?$%^*+=!|<>,()]/g, "");

  // Replace whitespace with dots
  formatted = formatted.replace(/\s+/g, ".").replace(/\.\./g, ".");

  return formatted;
}

function getPaddedSeason(episode: TvdbEpisode): string {
  return episode.seasonNumber.toString().padStart(2, "0");
}

function getPaddedEpisode(episode: TvdbEpisode): string {
  return episode.episodeNumber.toString().padStart(2, "0");
}

/** Source names may contain scene-like resolution claims; only the rendition owner adds one. */
function withoutSourceResolution(value: string): string {
  return value
    .replace(/_/g, ".")
    .replace(
      /\b(?:360|480|540|576|720|960|1080|1440|2160)[pi]\b|\b\d{3,5}x\d{3,5}\b|\b(?:FHD|UHD|4K)\b/gi,
      ""
    )
    .replace(/\.{2,}/g, ".");
}

/** Arr assumes SD for WEB without a resolution; unknown must not publish that hint. */
function renditionSuffix(quality: string): string {
  return `${quality}${quality === "UNKNOWN" ? "" : ".WEB"}.h264-MEDiATHEK`;
}

/** Add edition claims only after source evidence was classified, before RSS/NZB titles share it. */
export function applyLanguageEdition(title: string, item: ApiResultItem): string {
  // Replace source markers with the normalized label set instead of carrying claims
  // through title cleanup where they could be duplicated or contradict the evidence.
  const withoutSourceClaims = title
    .replace(/(^|[.\s_-])GERMAN(?=$|[.\s_-])/g, "$1")
    .replace(/\b(?:originalversion|originalfassung|originalton|ov|omu|omdu)\b/gi, "")
    .replace(/\b(?:deutsche[nrs]?|german)\s+untertitel\b|\buntertitel\s+(?:auf\s+)?deutsch\b/gi, "")
    .replace(
      /\b(?:audiodeskription|hörfassung|hoerfassung|gebärdensprache|klare\s+sprache)\b/gi,
      ""
    )
    .replace(/\.{2,}/g, ".")
    .replace(/(^[.\s]+|[.\s]+$)/g, "");
  const tokens = classifyLanguageEdition(item).titleTokens;
  if (tokens.length === 0) return withoutSourceClaims;

  const editionSuffix = `.${tokens.join(".")}`;
  const withEdition = withoutSourceClaims.replace(
    /\.(?=(?:480p|576p|720p|1080p|2160p|UNKNOWN)\.)/i,
    `${editionSuffix}.`
  );
  return withEdition.replace(/\.{2,}/g, ".");
}

/** Keep GUID identity stable while separating quality, actual edition, and source rendition. */
export function buildReleaseGuid(
  item: ApiResultItem,
  quality: string,
  renditionUrl: string,
  releaseIdentity: string
): string {
  const edition = classifyLanguageEdition(item);
  const identity = JSON.stringify([
    getLanguageSourceIdentity(item),
    item.releaseVariantKey ?? edition.variantKey,
    quality,
    stableUrlIdentity(renditionUrl),
    releaseIdentity,
  ]);
  const fingerprint = createHash("sha256").update(identity).digest("hex").slice(0, 20);
  const permalink = stableUrlIdentity(item.url_website || item.url_video);
  return `${permalink}#${quality}-${fingerprint}`;
}

function generateTitle(
  info: MatchedEpisodeInfo,
  quality: string,
  episodeType: EpisodeType
): string {
  const episode = info.episode;
  // Render the actual source title for placeholders; never mutate stored metadata.
  const episodeTitle = isPlaceholderEpisodeTitle(episode.name, episode.episodeNumber)
    ? parseEpisodeFromTitle(info.item.title).episodeName || episode.name
    : episode.name;

  if (episodeType === "daily") {
    const aired = episode.aired ? new Date(episode.aired) : new Date();
    const dateStr = aired.toISOString().split("T")[0]; // yyyy-MM-dd
    return applyLanguageEdition(
      `${withoutSourceResolution(info.showName)}.${dateStr}.${withoutSourceResolution(episodeTitle)}.${renditionSuffix(quality)}`,
      info.item
    ).replace(/ /g, ".");
  }

  return applyLanguageEdition(
    `${withoutSourceResolution(info.showName)}.S${getPaddedSeason(episode)}E${getPaddedEpisode(episode)}.${withoutSourceResolution(episodeTitle)}.${renditionSuffix(quality)}`,
    info.item
  ).replace(/ /g, ".");
}

function createRssItem(
  info: MatchedEpisodeInfo,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string,
  episodeType: EpisodeType,
  qualityIdentity: string
): NewznabItem {
  const adjustedSize = Math.floor(info.item.size * sizeMultiplier);
  const parsedTitle = generateTitle(info, quality, episodeType);
  const formattedTitle = formatTitle(parsedTitle);

  const expectations = releaseMediaExpectations(info.item, info.episode.runtime, url, "series");
  const fakeDownloadUrl = createFakeNzbDownloadUrl({
    title: formattedTitle,
    url,
    mediaExpectations: expectations,
  });
  const item = info.item;

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: false,
      value: buildReleaseGuid(
        item,
        qualityIdentity,
        url,
        `tvdb:${info.tvdbId}:S${info.episode.seasonNumber}E${info.episode.episodeNumber}:${episodeType}`
      ),
    },
    link: url,
    comments: item.url_website,
    // Preserve catalogue publication ordering, never reinterpret it as episode airdate.
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: hasMediaRuntimeConflict(expectations)
      ? `Laufzeitkonflikt: Quelle ${expectations.durations.source!.seconds} s, Episodenmetadaten ${expectations.durations.metadata!.seconds} s, Toleranz ±${expectations.durations.metadata!.tolerancePercent} %. Download gesperrt; Metadatenkonflikt zuerst klären.\n${item.description}`
      : item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes: generateAttributes(getPaddedSeason(info.episode), categoryValues, info.tvdbId),
  };
}

function createRssItems(
  info: MatchedEpisodeInfo,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string,
  qualityIdentity: string
): NewznabItem[] {
  const items: NewznabItem[] = [
    createRssItem(
      info,
      quality,
      sizeMultiplier,
      category,
      categoryValues,
      url,
      "standard" as EpisodeType,
      qualityIdentity
    ),
  ];

  // Also create daily type if season is a year
  if (info.episode.seasonNumber > 1950) {
    items.push(
      createRssItem(
        info,
        quality,
        sizeMultiplier,
        category,
        categoryValues,
        url,
        "daily" as EpisodeType,
        qualityIdentity
      )
    );
  }

  return items;
}

function qualityCategory(quality: string, movie: boolean, base: string[]) {
  const kind = movie ? "Movies" : "TV";
  if (quality === "UNKNOWN") return { category: kind, values: base };
  const hd = Number.parseInt(quality) >= 720;
  return {
    category: `${kind} > ${hd ? "HD" : "SD"}`,
    values: [...base, movie ? (hd ? "2040" : "2030") : hd ? "5040" : "5030"],
  };
}

export function generateRssItems(
  info: MatchedEpisodeInfo,
  qualityPreference: QualityPreference = "all",
  hlsEnabled: boolean = false
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const baseCategories = ["5000", "2000"];

  for (const rendition of selectRenditions(info.item, qualityPreference, hlsEnabled)) {
    const category = qualityCategory(rendition.quality, false, baseCategories);
    const movieCategory = qualityCategory(rendition.quality, true, []);
    items.push(
      ...createRssItems(
        info,
        rendition.quality,
        rendition.multiplier,
        category.category,
        [...category.values, ...movieCategory.values],
        rendition.url,
        rendition.identity
      )
    );
  }

  return items;
}

// ============== MOVIE RSS GENERATION ==============

function generateMovieAttributes(
  categoryValues: string[],
  tmdbId?: number,
  imdbId?: string | null
): NewznabAttribute[] {
  const attributes: NewznabAttribute[] = [];

  for (const categoryValue of categoryValues) {
    attributes.push({ name: "category", value: categoryValue });
  }

  if (tmdbId) {
    attributes.push({ name: "tmdbid", value: tmdbId.toString() });
  }

  if (imdbId) {
    attributes.push({ name: "imdbid", value: imdbId });
  }

  return attributes;
}

function generateMovieTitle(movieData: TmdbMovieData, quality: string): string {
  const year =
    movieData.productionYear ?? (movieData.releaseDate ? movieData.releaseDate.split("-")[0] : "");
  const title = withoutSourceResolution(movieData.germanTitle || movieData.title);
  const yearPart = year ? `.${year}` : "";

  return `${title}${yearPart}.${renditionSuffix(quality)}`.replace(/ /g, ".");
}

function createMovieRssItem(
  item: ApiResultItem,
  movieData: TmdbMovieData,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string,
  qualityIdentity: string
): NewznabItem {
  const adjustedSize = Math.floor(item.size * sizeMultiplier);
  const parsedTitle = applyLanguageEdition(generateMovieTitle(movieData, quality), item);
  const formattedTitle = formatTitle(parsedTitle);

  const fakeDownloadUrl = createFakeNzbDownloadUrl({
    title: formattedTitle,
    url,
    mediaExpectations: releaseMediaExpectations(item, null, url, "movie"),
  });

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: false,
      value: buildReleaseGuid(item, qualityIdentity, url, "candidate:movie"),
    },
    link: url,
    comments: item.url_website,
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes: generateMovieAttributes(categoryValues, movieData.tmdbId, movieData.imdbId),
  };
}

/**
 * Generate RSS items for a movie match
 */
export function generateMovieRssItems(
  matchResult: MovieMatchResult,
  movieData: TmdbMovieData,
  qualityPreference: QualityPreference = "all",
  hlsEnabled: boolean = false
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const item = matchResult.item;

  // Movie categories (2000 = Movies)
  const baseCategories = ["2000"];

  for (const rendition of selectRenditions(item, qualityPreference, hlsEnabled)) {
    const category = qualityCategory(rendition.quality, true, baseCategories);
    items.push(
      createMovieRssItem(
        item,
        movieData,
        rendition.quality,
        rendition.multiplier,
        category.category,
        category.values,
        rendition.url,
        rendition.identity
      )
    );
  }

  return items;
}

/** Only the strict matcher may enrich a source with metadata-backed identity. */
export function generateMatchedMovieRssItems(
  match: MovieMatchResult,
  movie: TmdbMovieData,
  quality: QualityPreference,
  hlsEnabled: boolean
): NewznabItem[] {
  return match.identityVerified === true
    ? generateMovieRssItems(match, movie, quality, hlsEnabled)
    : generateGenericRssItems(match.item, quality, hlsEnabled, "movie");
}

/**
 * Generate RSS items for API results that don't match any ruleset.
 * Uses topic + title as the release name so they still appear in search results.
 */
export function generateGenericRssItems(
  item: ApiResultItem,
  qualityPreference: QualityPreference = "all",
  hlsEnabled: boolean = false,
  candidateKind?: "movie" | "tv"
): NewznabItem[] {
  const items: NewznabItem[] = [];
  const movie = candidateKind === "movie";
  const baseCategories = [movie ? "2000" : "5000"];

  for (const rendition of selectRenditions(item, qualityPreference, hlsEnabled)) {
    const category = qualityCategory(rendition.quality, movie, baseCategories);
    items.push(
      createGenericRssItem(
        item,
        rendition.quality,
        rendition.multiplier,
        category.category,
        category.values,
        rendition.url,
        candidateKind,
        rendition.identity
      )
    );
  }

  return items;
}

/**
 * Parse source-backed episode coordinates from Mediathek titles. An episode-only
 * number or fraction does not establish a season, so callers must not turn an
 * unknown season into S01. Repeated E-numbers stay together for multi-episode titles.
 */
export function parseEpisodeFromTitle(title: string): {
  season: number | null;
  episodes: number[];
  episodeName: string;
} {
  let season: number | null = null;
  let episodes: number[] = [];
  let episodeName = title;

  // Keep the whole E12E13 sequence; truncating it changes the release identity.
  const sPattern = title.match(/\(?\bS(\d+)\/?E(\d+(?:E\d+)*)\)?/i);
  if (sPattern) {
    season = parseInt(sPattern[1], 10);
    episodes = sPattern[2].split(/E/i).map((value) => parseInt(value, 10));
    episodeName = title.replace(sPattern[0], "").trim();
  }

  // A named season plus its episode fraction/number is explicit season evidence.
  if (episodes.length === 0) {
    const seasonEpisodePattern = title.match(
      /\b(?:Staffel|Season|Saison|Temporada|Stagione)\s+(\d+)(?:\s*\((\d+)\s*\/\s*\d+\)|[\s,:-]+(?:Folge|Episode|E)\s*(\d+(?:E\d+)*))/i
    );
    if (seasonEpisodePattern) {
      season = parseInt(seasonEpisodePattern[1], 10);
      const episodeSequence = seasonEpisodePattern[2] ?? seasonEpisodePattern[3];
      episodes = episodeSequence.split(/E/i).map((value) => parseInt(value, 10));
      episodeName = title.replace(seasonEpisodePattern[0], "").trim();
    }
  }

  // Episode labels without a season remain episode-only coordinates.
  if (episodes.length === 0) {
    const folgePattern = title.match(
      /\b(?:Folge|Episode)\s+(\d+(?:E\d+)*)(?:\s*:\s*(.+?))?(?:\s*\(|$)/i
    );
    if (folgePattern) {
      episodes = folgePattern[1].split(/E/i).map((value) => parseInt(value, 10));
      if (folgePattern[2]) {
        episodeName = folgePattern[2].trim();
      } else {
        episodeName = title.replace(folgePattern[0], "").trim();
      }
    }
  }

  // A bare fraction can identify its first episode, but never its season.
  if (episodes.length === 0) {
    const fracPattern = title.match(/\((\d+)\/(\d+)\)/);
    if (fracPattern) {
      episodes = [parseInt(fracPattern[1], 10)];
      episodeName = title.replace(fracPattern[0], "").trim();
    }
  }

  // Clean up episode name: remove trailing "(Audiodeskription)", "(mit Untertitel)", etc.
  episodeName = episodeName
    .replace(/\(Audiodeskription\)/gi, "")
    .replace(/\(mit Untertitel\)/gi, "")
    .replace(/\(Originalversion\)/gi, "")
    .replace(/\s*\|\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Remove leading/trailing punctuation artifacts
  episodeName = episodeName.replace(/^[:\-–\s]+|[:\-–\s]+$/g, "").trim();

  return { season, episodes, episodeName };
}

function createGenericRssItem(
  item: ApiResultItem,
  quality: string,
  sizeMultiplier: number,
  category: string,
  categoryValues: string[],
  url: string,
  candidateKind: "movie" | "tv" | undefined,
  qualityIdentity: string
): NewznabItem {
  const adjustedSize = Math.floor(item.size * sizeMultiplier);

  const parsed = parseEpisodeFromTitle(item.title);
  const topic = withoutSourceResolution(item.topic);
  const title = withoutSourceResolution(item.title);
  let rawTitle: string;

  if (candidateKind) {
    // Search goals are not evidence. Keep source title/topic even when Arr
    // can only assign this candidate through its existing override dialog.
    rawTitle =
      item.topic === item.title
        ? `${title}.${renditionSuffix(quality)}`
        : `${topic}.${title}.${renditionSuffix(quality)}`;
  } else if (parsed.episodes.length > 0) {
    const seasonPart =
      parsed.season === null ? "" : `S${parsed.season.toString().padStart(2, "0")}`;
    const episodePart = parsed.episodes
      .map((episode) => `E${episode.toString().padStart(2, "0")}`)
      .join("");
    // Omit the episode-name segment when the pattern consumed the whole title;
    // otherwise the source coordinate is repeated in the generated release.
    rawTitle = parsed.episodeName
      ? `${topic}.${seasonPart}${episodePart}.${withoutSourceResolution(parsed.episodeName)}.${renditionSuffix(quality)}`
      : `${topic}.${seasonPart}${episodePart}.${renditionSuffix(quality)}`;
  } else {
    rawTitle = `${topic}.${title}.${renditionSuffix(quality)}`;
  }

  const formattedTitle = formatTitle(applyLanguageEdition(rawTitle, item));

  const fakeDownloadUrl = createFakeNzbDownloadUrl({
    title: formattedTitle,
    url,
    mediaExpectations: releaseMediaExpectations(item, null, url),
  });

  const attributes: NewznabAttribute[] = categoryValues.map((v) => ({
    name: "category",
    value: v,
  }));

  // Add season/episode attributes if parsed
  if (!candidateKind && parsed.episodes.length > 0) {
    if (parsed.season !== null) {
      attributes.push({
        name: "season",
        value: parsed.season.toString().padStart(2, "0"),
      });
    }
    // Newznab's episode attribute is numeric; the release title retains every E-number.
    attributes.push({
      name: "episode",
      value: parsed.episodes[0].toString().padStart(2, "0"),
    });
  }

  return {
    title: formattedTitle,
    guid: {
      isPermaLink: false,
      value: buildReleaseGuid(
        item,
        qualityIdentity,
        url,
        candidateKind
          ? `candidate:${candidateKind}`
          : `generic:${parsed.season ?? ""}:${parsed.episodes.join("-")}`
      ),
    },
    link: url,
    comments: item.url_website,
    pubDate: new Date(item.filmlisteTimestamp * 1000).toUTCString(),
    category: category,
    description: item.description,
    enclosure: {
      url: fakeDownloadUrl,
      length: adjustedSize,
      type: "application/x-nzb",
    },
    attributes,
  };
}

// Capabilities XML
export function getCapabilitiesXml(): string {
  const caps = {
    caps: {
      server: {
        $: {
          version: "1.0",
          title: "RundfunkArr",
          strapline: "German Public TV Indexer",
          email: "",
          url: "",
        },
      },
      limits: {
        $: {
          max: "100",
          default: "100",
        },
      },
      registration: {
        $: {
          available: "no",
          open: "no",
        },
      },
      searching: {
        search: { $: { available: "yes", supportedParams: "q" } },
        "tv-search": { $: { available: "yes", supportedParams: "q,tvdbid,season,ep" } },
        "movie-search": { $: { available: "yes", supportedParams: "q,tmdbid,imdbid,year" } },
      },
      categories: {
        category: [
          {
            $: { id: "5000", name: "TV" },
            subcat: [{ $: { id: "5030", name: "TV/SD" } }, { $: { id: "5040", name: "TV/HD" } }],
          },
          {
            $: { id: "2000", name: "Movies" },
            subcat: [
              { $: { id: "2030", name: "Movies/SD" } },
              { $: { id: "2040", name: "Movies/HD" } },
            ],
          },
        ],
      },
    },
  };

  return XML_BUILDER.buildObject(caps);
}
