import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchingStrategy } from "@/types";
import type { ApiResultItem, Ruleset, TmdbMovieData, TvdbData, TvSearchContext } from "@/types";

const mediathekMocks = vi.hoisted(() => ({
  getShowInfoByTvdbId: vi.fn(),
  cacheEntries: new Map<string, { response?: string; results?: ApiResultItem[] }>(),
  rulesets: {
    ensureRulesetsLoaded: vi.fn().mockResolvedValue(undefined),
    getRulesetsForTopic: vi.fn().mockReturnValue([]),
    getRulesetsForTopicAndTvdbId: vi.fn().mockReturnValue([]),
    getAllTopics: vi.fn().mockReturnValue([]),
    getOrGenerateRulesetForShow: vi.fn().mockResolvedValue(null),
  },
}));

// Keep the unit hermetic: no DB, no network, no ruleset store.
vi.mock("@/lib/settings", () => ({
  // null -> defaults kick in: quality "all", minDuration 300s, fuzzy/0.7
  getSetting: vi.fn().mockResolvedValue(null),
  getMinDurationSeconds: vi.fn().mockResolvedValue(300),
}));
vi.mock("@/lib/cache", () => ({
  mediathekCache: {
    get: vi.fn((key: string) => mediathekMocks.cacheEntries.get(key)),
    set: vi.fn((key: string, value: { response?: string; results?: ApiResultItem[] }) =>
      mediathekMocks.cacheEntries.set(key, value)
    ),
  },
}));
vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry: vi.fn() }));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: mediathekMocks.getShowInfoByTvdbId }));
// No rulesets by default -> every API result becomes an "unmatched" item.
vi.mock("./rulesets", () => mediathekMocks.rulesets);
vi.mock("./tmdb", () => ({
  searchMovieByTitle: vi.fn().mockResolvedValue(null),
}));

import {
  fetchMovieSearchByQuery,
  fetchMovieSearchResults,
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
} from "./mediathek";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { mediathekCache } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { getShowInfoByTvdbId } from "./shows";
import {
  getAllTopics,
  getOrGenerateRulesetForShow,
  getRulesetsForTopic,
  getRulesetsForTopicAndTvdbId,
} from "./rulesets";

const mockedFetch = vi.mocked(fetchWithRetry);
const mockedGetMinDuration = vi.mocked(getMinDurationSeconds);
const mockedCacheSet = vi.mocked(mediathekCache.set);
const mockedGetSetting = vi.mocked(getSetting);
const mockedGetShowInfo = vi.mocked(getShowInfoByTvdbId);
const mockedRulesetsForTopic = vi.mocked(getRulesetsForTopic);
const mockedRulesetsForTopicAndTvdbId = vi.mocked(getRulesetsForTopicAndTvdbId);
const mockedAllTopics = vi.mocked(getAllTopics);
const mockedGenerateRuleset = vi.mocked(getOrGenerateRulesetForShow);

function makeItem(overrides: Partial<ApiResultItem> = {}): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Irgendeine Sendung",
    title: "Irgendeine Sendung (S01/E03)",
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration: 3600,
    size: 1_000_000_000,
    url_website: "https://example.com/show",
    url_video: "https://example.com/show_720.mp4",
    url_video_low: "https://example.com/show_480.mp4",
    url_video_hd: "https://example.com/show_1080.mp4",
    ...overrides,
  };
}

function makeTvSearchContext(overrides: Partial<TvSearchContext> = {}): TvSearchContext {
  return {
    query: null,
    tvdbId: null,
    season: null,
    episode: null,
    ...overrides,
  };
}

function mockApi(results: ApiResultItem[]): void {
  mockedFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ result: { results } }),
  } as Response);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch.mockReset();
  mediathekMocks.cacheEntries.clear();
  mockedGetMinDuration.mockResolvedValue(300);
  mockedGetSetting.mockResolvedValue(null);
  mockApi([]);
  mockedGetShowInfo.mockResolvedValue(null);
  mockedRulesetsForTopic.mockReturnValue([]);
  mockedRulesetsForTopicAndTvdbId.mockReturnValue([]);
  mockedAllTopics.mockReturnValue([]);
  mockedGenerateRuleset.mockResolvedValue(null);
});

describe("fetchSearchResultsByString – generic result gating", () => {
  it("emits NO generic results for a season-only query (no q)", async () => {
    // Regression for tvsearch&season=01 without q: without the gate this
    // returned generic items for every unrelated show whose title contains "S01".
    mockApi([
      makeItem({ topic: "Show A", title: "Show A (S01/E01)" }),
      makeItem({ topic: "Show B", title: "Show B (S01/E02)" }),
    ]);

    const xml = await fetchSearchResultsByString(makeTvSearchContext({ season: "1" }), 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });

  it("DOES emit generic results for an actual text query (q set)", async () => {
    mockApi([makeItem({ topic: "Markus Lanz", title: "Markus Lanz (S2026/E70)" })]);

    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Markus Lanz" }),
      100,
      0
    );

    expect(xml).not.toContain('total="0"');
    expect(xml).toContain("<item>");
  });

  it("treats a whitespace-only q like an empty query (no generic results)", async () => {
    mockApi([makeItem({ topic: "Show C", title: "Show C (S01/E04)" })]);

    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "   ", season: "1" }),
      100,
      0
    );

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });
});

describe("P00 historical behavior and P01 rendition regressions", () => {
  it("fixes A4: finds a Staffel 2 title without requiring literal S02", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    const staffelZwei = makeItem({
      topic: "Example",
      title: "Example - Staffel 2 (2/6)",
    });
    mockedFetch.mockImplementation(async (_input, init) => {
      const { queries } = JSON.parse(String(init?.body));
      const matched = [staffelZwei].filter((item) =>
        queries.every(({ fields, query }: { fields: string[]; query: string }) =>
          fields.some((field) =>
            String(item[field as keyof ApiResultItem] ?? "")
              .toLowerCase()
              .includes(query.toLowerCase())
          )
        )
      );
      return { ok: true, json: async () => ({ result: { results: matched } }) } as Response;
    });

    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Example", season: "2" }),
      100,
      0
    );

    const requestBody = JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
    expect(requestBody.queries).toEqual([{ fields: ["topic", "title"], query: "Example" }]);
    expect(xml).toContain('total="1"');
    expect(xml).toContain("Example.S02E02");
    expect(xml).not.toContain("S01E02");
  });

  it("keeps the matched series identity when a foreign title contains the search query", async () => {
    const foreignShow: TvdbData = {
      id: 34567,
      name: "Foreign Series",
      germanName: null,
      aliases: [],
      episodes: [
        {
          name: "Episode 3",
          aired: new Date("2024-01-08T12:00:00Z"),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber: 3,
        },
      ],
    };
    const ruleset: Ruleset = {
      id: 7,
      mediaId: 7,
      topic: "Foreign Topic",
      priority: 1,
      filters: "[]",
      titleRegexRules: "[]",
      seasonRegex: "S(\\d+)",
      episodeRegex: "E(\\d+)",
      matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
      media: {
        media_id: 7,
        media_name: "Foreign Series",
        media_type: "tv",
        media_tvdbId: foreignShow.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockedGetShowInfo.mockResolvedValue(foreignShow);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockApi([
      makeItem({
        topic: "Foreign Topic",
        title: "Requested Show guest slot S02/E03",
        url_video: "https://example.org/foreign-episode-3.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
    ]);

    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Requested Show", season: "2", episode: "3" }),
      100,
      0
    );

    expect(xml).toContain("Foreign.Series.S02E03");
    expect(xml).not.toContain("Requested.Show.S02E03");
  });

  it("characterizes A5: a long unrelated text result is still published neutrally as a movie", async () => {
    mockedGetMinDuration.mockResolvedValue(300);
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    const unrelatedFeatureLengthItem = makeItem({
      topic: "Magazine Feature",
      title: "A report unrelated to the requested film",
      duration: 3600,
      filmlisteTimestamp: Date.parse("2024-05-01T12:00:00Z") / 1000,
    });
    mockApi([unrelatedFeatureLengthItem]);

    const xml = await fetchMovieSearchByQuery("Example Film 1998", 100, 0);

    expect(xml).toContain('total="1"');
    expect(xml).toContain("Magazine.Feature.2024.720p");
    expect(xml).not.toMatch(/Magazine\.Feature\.2024\.GERMAN(?:\.|<)/);
    expect(xml).not.toContain("Example.Film.1998");
  });

  it("preserves progressive HD when the standard rendition is HLS and HLS is disabled", async () => {
    const mixedRenditions = makeItem({
      topic: "Example",
      title: "Example episode",
      url_video: "https://example.org/standard.m3u8",
      url_video_hd: "https://example.org/progressive-hd.mp4",
      url_video_low: "",
    });
    mockApi([mixedRenditions]);

    const xml = await fetchSearchResultsByString(makeTvSearchContext({ query: "Example" }), 100, 0);

    expect(xml).toContain('total="1"');
    expect(xml).toContain("progressive-hd.mp4");
    expect(xml).not.toContain("standard.m3u8");
  });

  it("does not re-emit a disallowed HLS HD rendition beside a progressive standard rendition", async () => {
    mockApi([
      makeItem({
        topic: "Example",
        title: "Example episode",
        url_video: "https://example.org/progressive-standard.mp4",
        url_video_hd: "https://example.org/disallowed-hd.m3u8",
        url_video_low: "",
      }),
    ]);

    const xml = await fetchSearchResultsByString(makeTvSearchContext({ query: "Example" }), 100, 0);

    expect(xml).toContain('total="1"');
    expect(xml).toContain("progressive-standard.mp4");
    expect(xml).not.toContain("disallowed-hd.m3u8");
  });

  it("changes rendition output with HLS setting without reusing a stale response cache", async () => {
    mockApi([
      makeItem({
        topic: "Example",
        title: "Example episode",
        url_video: "https://example.org/standard.m3u8",
        url_video_hd: "https://example.org/progressive-hd.mp4",
        url_video_low: "",
      }),
    ]);

    const context = makeTvSearchContext({ query: "Example" });
    const disabledXml = await fetchSearchResultsByString(context, 100, 0);
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.enableHLS" ? "true" : null
    );
    const enabledXml = await fetchSearchResultsByString(context, 100, 0);

    expect(disabledXml).toContain("progressive-hd.mp4");
    expect(disabledXml).not.toContain("standard.m3u8");
    expect(enabledXml).toContain("progressive-hd.mp4");
    expect(enabledXml).toContain("standard.m3u8");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("characterizes A7: a TVDB-ID search returns the requested episode only", async () => {
    const tvdbData: TvdbData = {
      id: 12345,
      name: "Example Show",
      germanName: "Beispielserie",
      aliases: [],
      episodes: [
        {
          name: "First episode",
          aired: new Date("2024-01-01T00:00:00Z"),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber: 1,
        },
        {
          name: "Second episode",
          aired: new Date("2024-01-08T00:00:00Z"),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber: 2,
        },
      ],
    };
    const ruleset: Ruleset = {
      id: 1,
      mediaId: 1,
      topic: "Example Show",
      priority: 1,
      filters: "[]",
      titleRegexRules: "[]",
      seasonRegex: "S(\\d+)",
      episodeRegex: "E(\\d+)",
      matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
      media: {
        media_id: 1,
        media_name: "Example Show",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "best" : null
    );
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedAllTopics.mockReturnValue(["Example Show"]);
    mockedRulesetsForTopicAndTvdbId.mockImplementation((topic, tvdbId) =>
      topic === "Example Show" && tvdbId === tvdbData.id ? [ruleset] : []
    );
    mockApi([
      makeItem({ topic: "Example Show", title: "Example Show S02/E01" }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E02",
        url_video: "https://example.org/episode-2.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
    ]);

    const xml = await fetchSearchResultsById(
      tvdbData,
      makeTvSearchContext({ tvdbId: tvdbData.id, season: "2", episode: "2" }),
      100,
      0
    );

    expect(xml).toContain('total="1"');
    expect(xml).toContain("S02E02");
    expect(xml).toContain("episode-2.mp4");
    expect(xml).not.toContain("S02E01");
    expect(xml).not.toContain("Episode-1");
  });

  it("searches alternative season coordinates, deduplicates candidates, and paginates after filtering", async () => {
    const tvdbData: TvdbData = {
      id: 23456,
      name: "Example Show",
      germanName: null,
      aliases: [],
      episodes: [
        {
          name: "Example Show S02/E02 Staffel 2 (2/6)",
          aired: new Date("2024-01-08T00:00:00Z"),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber: 2,
        },
      ],
    };
    const source = makeItem({
      topic: "Example Show",
      title: "Example Show S02/E02 Staffel 2 (2/6)",
      url_video: "https://example.org/episode-2.mp4",
      url_video_low: "",
      url_video_hd: "",
    });
    const ruleset: Ruleset = {
      id: 3,
      mediaId: 3,
      topic: "Example Show",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "^(.*)$" }]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: MatchingStrategy.ItemTitleIncludes,
      media: {
        media_id: 3,
        media_name: "Example Show",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockedFetch.mockImplementation(async (_input, init) => {
      const { queries } = JSON.parse(String(init?.body));
      const query = queries[0].query as string;
      const matches = source.title.toLowerCase().includes(query.toLowerCase()) ? [source] : [];
      return { ok: true, json: async () => ({ result: { results: matches } }) } as Response;
    });

    const context = makeTvSearchContext({ season: "2", episode: "2" });
    const firstPage = await fetchSearchResultsByString(context, 1, 0);
    const secondPage = await fetchSearchResultsByString(context, 1, 1);
    const candidateQueries = mockedFetch.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)).queries[0] as { query: string }).query
    );

    expect(candidateQueries).toContain("S02");
    expect(candidateQueries).toContain("Staffel 2");
    expect(firstPage).toContain('offset="0" total="1"');
    expect(firstPage).toContain("Example.Show.S02E02");
    expect(firstPage).toContain("episode-2.mp4");
    expect(secondPage).toContain('offset="1" total="1"');
    expect(secondPage).not.toContain("<item>");
  });

  it("returns the same exact ID and text episode while retaining an explicit multi-episode release", async () => {
    const tvdbData: TvdbData = {
      id: 12345,
      name: "Example Show",
      germanName: "Beispielserie",
      aliases: [],
      episodes: [12, 13, 130]
        .map((episodeNumber) => ({
          name: `Episode ${episodeNumber}`,
          aired: new Date(
            `2024-01-${String(episodeNumber === 12 ? 1 : 8).padStart(2, "0")}T00:00:00Z`
          ),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber,
        }))
        .concat({
          name: "Episode 13, other season",
          aired: new Date("2024-01-15T00:00:00Z"),
          runtime: 45,
          seasonNumber: 3,
          episodeNumber: 13,
        }),
    };
    const ruleset: Ruleset = {
      id: 1,
      mediaId: 1,
      topic: "Example Show",
      priority: 1,
      filters: "[]",
      titleRegexRules: "[]",
      seasonRegex: "S(\\d+)",
      episodeRegex: "E(\\d+)",
      matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
      media: {
        media_id: 1,
        media_name: "Example Show",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    const context = makeTvSearchContext({
      query: "Example Show",
      tvdbId: tvdbData.id,
      season: "2",
      episode: "13",
    });
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedAllTopics.mockReturnValue(["Example Show"]);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockedRulesetsForTopicAndTvdbId.mockImplementation((topic, tvdbId) =>
      topic === "Example Show" && tvdbId === tvdbData.id ? [ruleset] : []
    );
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E12",
        url_video: "https://example.org/episode-12.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E13",
        url_video: "https://example.org/episode-13.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E130",
        url_video: "https://example.org/episode-130.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S03/E13",
        url_video: "https://example.org/season-3-episode-13.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E12E13",
        url_video: "https://example.org/episode-12-13.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
    ]);

    const idXml = await fetchSearchResultsById(tvdbData, context, 100, 0);
    const textXml = await fetchSearchResultsByString(context, 100, 0);

    for (const xml of [idXml, textXml]) {
      expect(xml).toContain('total="2"');
      expect(xml).toContain("episode-13.mp4");
      expect(xml).toContain("episode-12-13.mp4");
      expect(xml).not.toContain("episode-12.mp4");
      expect(xml).not.toContain("episode-130.mp4");
      expect(xml).not.toContain("season-3-episode-13.mp4");
    }
  });

  it("applies coordinates to generic text fallback and keeps ID-scoped fallback closed", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E12",
        url_video: "https://example.org/episode-12.mp4",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E13",
        url_video: "https://example.org/episode-13.mp4",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E130",
        url_video: "https://example.org/episode-130.mp4",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S03/E13",
        url_video: "https://example.org/season-3-episode-13.mp4",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E12E13",
        url_video: "https://example.org/episode-12-13.mp4",
      }),
    ]);
    const textContext = makeTvSearchContext({
      query: "Example Show",
      season: "2",
      episode: "13",
    });

    const textXml = await fetchSearchResultsByString(textContext, 100, 0);
    const idFallbackXml = await fetchSearchResultsByString(
      { ...textContext, tvdbId: 12345 },
      100,
      0
    );

    expect(textXml).toContain('total="2"');
    expect(textXml).toContain("episode-13.mp4");
    expect(textXml).toContain("episode-12-13.mp4");
    expect(textXml).not.toContain("episode-12.mp4");
    expect(textXml).not.toContain("episode-130.mp4");
    expect(textXml).not.toContain("season-3-episode-13.mp4");
    expect(idFallbackXml).toContain('total="0"');
  });

  it("does not reuse cached text results across episode coordinates", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E13",
        url_video: "https://example.org/episode-13.mp4",
      }),
    ]);
    const baseContext = makeTvSearchContext({ query: "Example Show", season: "2" });

    const episode13 = await fetchSearchResultsByString({ ...baseContext, episode: "13" }, 100, 0);
    const episode12 = await fetchSearchResultsByString({ ...baseContext, episode: "12" }, 100, 0);

    expect(episode13).toContain('total="1"');
    expect(episode13).toContain("episode-13.mp4");
    expect(episode12).toContain('total="0"');
    expect(episode12).not.toContain("episode-13.mp4");
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("filters daily text and ID searches by the exact aired date", async () => {
    const tvdbData: TvdbData = {
      id: 54321,
      name: "Daily News",
      germanName: null,
      aliases: [],
      episodes: ["2026-09-27", "2026-09-28"].map((date) => ({
        name: `Daily News ${date}`,
        aired: new Date(`${date}T00:00:00Z`),
        runtime: 10,
        seasonNumber: 2026,
        episodeNumber: Number(date.slice(-2)),
      })),
    };
    const ruleset: Ruleset = {
      id: 2,
      mediaId: 2,
      topic: "Daily News",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([
        { type: "regex", field: "title", pattern: "^(Daily News .*?)$" },
      ]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: MatchingStrategy.ItemTitleExact,
      media: {
        media_id: 2,
        media_name: "Daily News",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    const context = makeTvSearchContext({
      query: "Daily News",
      tvdbId: tvdbData.id,
      season: "2026",
      episode: "09/28",
    });
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockedRulesetsForTopicAndTvdbId.mockReturnValue([ruleset]);
    mockedAllTopics.mockReturnValue(["Daily News"]);
    mockApi(
      ["2026-09-27", "2026-09-28"].map((date) =>
        makeItem({
          topic: "Daily News",
          title: `Daily News ${date}`,
          filmlisteTimestamp: Date.parse(`${date}T12:00:00Z`) / 1000,
          url_video: `https://example.org/${date}.mp4`,
          url_video_low: "",
          url_video_hd: "",
        })
      )
    );

    const idXml = await fetchSearchResultsById(tvdbData, context, 100, 0);
    const textXml = await fetchSearchResultsByString(context, 100, 0);

    for (const xml of [idXml, textXml]) {
      expect(xml).toContain('total="2"');
      expect(xml).toContain("2026-09-28.mp4");
      expect(xml).not.toContain("2026-09-27.mp4");
    }
  });

  it("searches daily date candidates without a text query and filters neighbors before paging", async () => {
    const tvdbData: TvdbData = {
      id: 65432,
      name: "Daily News",
      germanName: null,
      aliases: [],
      episodes: ["2026-03-20", "2026-03-21"].map((date) => ({
        name: `News on ${date}`,
        aired: new Date(`${date}T12:00:00Z`),
        runtime: 10,
        seasonNumber: 2026,
        episodeNumber: Number(date.slice(-2)),
      })),
    };
    const ruleset: Ruleset = {
      id: 4,
      mediaId: 4,
      topic: "Daily News",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([
        { type: "regex", field: "title", pattern: "Daily News (.+)$" },
      ]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: MatchingStrategy.ItemTitleEqualsAirdate,
      media: {
        media_id: 4,
        media_name: "Daily News",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockApi(
      ["2026-03-20", "2026-03-21"].map((date) =>
        makeItem({
          topic: "Daily News",
          title: `Daily News ${date.slice(-2)}. März 2026`,
          filmlisteTimestamp: Date.parse(`${date}T12:00:00Z`) / 1000,
          url_video: `https://example.org/${date}.mp4`,
          url_video_low: "",
          url_video_hd: "",
        })
      )
    );

    const context = makeTvSearchContext({ season: "2026", episode: "03/21" });
    const firstPage = await fetchSearchResultsByString(context, 1, 0);
    const secondPage = await fetchSearchResultsByString(context, 1, 1);
    const candidateQueries = mockedFetch.mock.calls.map(
      ([, init]) => (JSON.parse(String(init?.body)).queries[0] as { query: string }).query
    );

    expect(candidateQueries).toContain("21. März 2026");
    expect(firstPage).toContain('offset="0" total="2"');
    expect(firstPage).toContain("2026-03-21.mp4");
    expect(firstPage).not.toContain("2026-03-20.mp4");
    expect(secondPage).toContain('offset="1" total="2"');
    expect(secondPage).not.toContain("2026-03-20.mp4");
  });

  it("rejects impossible source dates instead of rolling them into an aired episode", async () => {
    const tvdbData: TvdbData = {
      id: 65433,
      name: "Daily News",
      germanName: null,
      aliases: [],
      episodes: [
        {
          name: "News on 2026-03-02",
          aired: new Date("2026-03-02T12:00:00Z"),
          runtime: 10,
          seasonNumber: 2026,
          episodeNumber: 2,
        },
      ],
    };
    const ruleset: Ruleset = {
      id: 6,
      mediaId: 6,
      topic: "Daily News",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([
        { type: "regex", field: "title", pattern: "Daily News (.+)$" },
      ]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: MatchingStrategy.ItemTitleEqualsAirdate,
      media: {
        media_id: 6,
        media_name: "Daily News",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockApi([
      makeItem({
        topic: "Daily News",
        title: "Daily News 30. Februar 2026",
        url_video: "https://example.org/impossible-date.mp4",
      }),
    ]);

    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Daily News", season: "2026", episode: "03/02" }),
      100,
      0
    );

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("impossible-date.mp4");
  });

  it("deduplicates identical RSS releases before applying page offsets", async () => {
    const tvdbData: TvdbData = {
      id: 76543,
      name: "Example Show",
      germanName: null,
      aliases: [],
      episodes: [
        {
          name: "Episode 2",
          aired: new Date("2024-01-08T12:00:00Z"),
          runtime: 45,
          seasonNumber: 2,
          episodeNumber: 2,
        },
      ],
    };
    const ruleset: Ruleset = {
      id: 5,
      mediaId: 5,
      topic: "Example Show",
      priority: 1,
      filters: "[]",
      titleRegexRules: "[]",
      seasonRegex: "S(\\d+)",
      episodeRegex: "E(\\d+)",
      matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
      media: {
        media_id: 5,
        media_name: "Example Show",
        media_type: "tv",
        media_tvdbId: tvdbData.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    };
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "1080p" : null
    );
    mockedGetShowInfo.mockResolvedValue(tvdbData);
    mockedRulesetsForTopic.mockReturnValue([ruleset]);
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E02",
        url_video: "https://example.org/standard-a.mp4",
        url_video_hd: "https://example.org/shared-hd.mp4",
        url_video_low: "",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02/E02",
        url_video: "https://example.org/standard-b.mp4",
        url_video_hd: "https://example.org/shared-hd.mp4",
        url_video_low: "",
      }),
    ]);

    const firstPage = await fetchSearchResultsForRssSync(1, 0);
    const secondPage = await fetchSearchResultsForRssSync(1, 1);

    expect(firstPage).toContain('offset="0" total="1"');
    expect(firstPage).toContain("shared-hd.mp4");
    expect(secondPage).toContain('offset="1" total="1"');
    expect(secondPage).not.toContain("<item>");
  });

  it("paginates the full generic result set and reuses successful provider data", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockApi([
      makeItem({
        topic: "Example A",
        title: "Example A",
        url_video: "https://example.org/a.mp4",
        url_video_hd: "",
        url_video_low: "",
      }),
      makeItem({
        topic: "Example B",
        title: "Example B",
        url_video: "https://example.org/b.mp4",
        url_video_hd: "",
        url_video_low: "",
      }),
      makeItem({
        topic: "Example C",
        title: "Example C",
        url_video: "https://example.org/c.mp4",
        url_video_hd: "",
        url_video_low: "",
      }),
    ]);

    const context = makeTvSearchContext({ query: "Example" });
    const secondPage = await fetchSearchResultsByString(context, 1, 1);
    const samePageFromCache = await fetchSearchResultsByString(context, 1, 1);
    const thirdPage = await fetchSearchResultsByString(context, 1, 2);

    expect(secondPage).toContain('offset="1"');
    expect(secondPage).toContain('total="3"');
    expect(secondPage).toContain("Example.B");
    expect(secondPage).not.toContain("Example.A");
    expect(samePageFromCache).toBe(secondPage);
    expect(thirdPage).toContain('offset="2"');
    expect(thirdPage).toContain("Example.C");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining('q_v2_["Example",null,null,null]_1_1_720p_300'),
      expect.objectContaining({ response: secondPage })
    );
  });

  it("does not cache a failed provider response as a successful empty search", async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error("synthetic provider failure"))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ result: { results: [makeItem()] } }),
      } as Response);

    const context = makeTvSearchContext({ query: "Example" });
    const failedResponse = await fetchSearchResultsByString(context, 100, 0);
    expect(mockedCacheSet).not.toHaveBeenCalled();
    const retriedResponse = await fetchSearchResultsByString(context, 100, 0);

    expect(failedResponse).toContain('total="0"');
    expect(retriedResponse).toContain('total="3"');
    expect(mockedFetch).toHaveBeenCalledTimes(2);
    expect(mockedCacheSet).toHaveBeenCalledTimes(2);
  });
});

describe("fetchMovieSearchByQuery – configured minimum duration", () => {
  it("includes movies at the configured boundary and rejects shorter results", async () => {
    mockedGetMinDuration.mockResolvedValue(2700);
    mockApi([
      makeItem({ topic: "Too Short", title: "Documentary", duration: 2699 }),
      makeItem({ topic: "At Boundary", title: "Documentary", duration: 2700 }),
    ]);

    const xml = await fetchMovieSearchByQuery("Documentary", 100, 0);

    expect(xml).toContain("At.Boundary");
    expect(xml).not.toContain("Too.Short");
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("movie_query_Documentary__100_0_all_2700"),
      expect.any(Object)
    );
  });
});

describe("fetchMovieSearchResults – configured minimum duration", () => {
  it("applies the configured boundary to TMDB and IMDB-backed searches", async () => {
    mockedGetMinDuration.mockResolvedValue(2700);
    mockApi([
      makeItem({ topic: "Documentary", title: "Documentary", duration: 2699 }),
      makeItem({
        topic: "Documentary",
        title: "Documentary",
        duration: 2700,
        url_video: "https://example.com/boundary_720.mp4",
      }),
    ]);
    const movie: TmdbMovieData = {
      tmdbId: 28,
      imdbId: "tt0000028",
      title: "Documentary",
      germanTitle: "Documentary",
      runtime: 45,
      releaseDate: "2026-07-12",
    };

    const xml = await fetchMovieSearchResults(movie, 100, 0);

    expect(xml).toContain("boundary_720.mp4");
    expect(xml).not.toContain("show_720.mp4");
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("movie_28_100_0_all_2700"),
      expect.any(Object)
    );
  });
});

it.each(["standard", "high"])("keeps direct movie variants when %s is HLS", async (streaming) => {
  const movie: TmdbMovieData = {
    tmdbId: 123,
    imdbId: null,
    title: "Mixed Movie",
    germanTitle: "Mixed Movie",
    runtime: 60,
    releaseDate: "2026-01-01",
  };
  mockApi([
    makeItem({
      topic: "Mixed Movie",
      title: "Mixed Movie",
      url_video:
        streaming === "standard" ? "https://example.org/720.m3u8" : "https://example.org/720.mp4",
      url_video_hd:
        streaming === "high" ? "https://example.org/1080.m3u8" : "https://example.org/1080.mp4",
      url_video_low: "https://example.org/480.mp4",
    }),
  ]);
  const xml = await fetchMovieSearchResults(movie, 100, 0);
  expect(xml).toContain("480p");
  expect(xml).toContain(streaming === "standard" ? "1080p" : "720p");
  expect(xml).not.toContain(streaming === "standard" ? "720p" : "1080p");
  expect(xml).toContain(streaming === "standard" ? "1080.mp4" : "720.mp4");
  expect(xml).toContain("480.mp4");
  expect(xml).not.toContain(streaming === "standard" ? "720.m3u8" : "1080.m3u8");
});

it.each(["standard", "high"])(
  "keeps direct movie text-search variants when %s is HLS",
  async (streaming) => {
    mockApi([
      makeItem({
        topic: "Mixed Movie",
        title: "Mixed Movie",
        url_video:
          streaming === "standard" ? "https://example.org/720.m3u8" : "https://example.org/720.mp4",
        url_video_hd:
          streaming === "high" ? "https://example.org/1080.m3u8" : "https://example.org/1080.mp4",
        url_video_low: "https://example.org/480.mp4",
      }),
    ]);
    const xml = await fetchMovieSearchByQuery("Mixed Movie", 100, 0);
    expect(xml).toContain("480p");
    expect(xml).toContain(streaming === "standard" ? "1080p" : "720p");
    expect(xml).not.toContain(streaming === "standard" ? "720p" : "1080p");
    expect(xml).toContain(streaming === "standard" ? "1080.mp4" : "720.mp4");
    expect(xml).toContain("480.mp4");
    expect(xml).not.toContain(streaming === "standard" ? "720.m3u8" : "1080.m3u8");
  }
);

it("preserves HLS movie text-search renditions when HLS is enabled", async () => {
  mockedGetSetting.mockImplementation(async (key) =>
    key === "download.enableHLS" ? "true" : null
  );
  mockApi([
    makeItem({
      topic: "Mixed Movie",
      title: "Mixed Movie",
      url_video: "https://example.org/720.m3u8",
      url_video_hd: "https://example.org/1080.m3u8",
      url_video_low: "https://example.org/480.mp4",
    }),
  ]);

  const xml = await fetchMovieSearchByQuery("Mixed Movie", 100, 0);

  expect(xml).toContain('total="3"');
  expect(xml).toContain("720.m3u8");
  expect(xml).toContain("1080.m3u8");
  expect(xml).toContain("480.mp4");
});

it("uses a direct low-quality variant for best when higher qualities are HLS", async () => {
  vi.mocked(getSetting).mockImplementation(async (key) =>
    key === "download.quality" ? "best" : null
  );
  try {
    mockApi([
      makeItem({
        url_video: "https://example.org/720.m3u8",
        url_video_hd: "https://example.org/1080.m3u8",
      }),
    ]);
    const xml = await fetchMovieSearchByQuery("Movie", 100, 0);
    expect(xml).toContain("480p");
    expect(xml).not.toContain("720p");
    expect(xml).not.toContain("1080p");
  } finally {
    vi.mocked(getSetting).mockResolvedValue(null);
  }
});
