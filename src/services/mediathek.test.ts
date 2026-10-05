import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchingStrategy } from "@/types";
import type { ApiResultItem, Ruleset, TmdbMovieData, TvdbData, TvSearchContext } from "@/types";

const mediathekMocks = vi.hoisted(() => ({
  getShowInfoByTvdbId: vi.fn(),
  getRadarrMonitoredMovies: vi.fn().mockResolvedValue([]),
  cacheEntries: new Map<string, { response?: string; results?: ApiResultItem[] }>(),
  rulesets: {
    getRulesetContext: vi.fn(() => "synthetic-rules"),
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
  cacheContextEpoch: () => 0,
  mediathekCache: {
    get: vi.fn((key: string) => mediathekMocks.cacheEntries.get(key)),
    set: vi.fn((key: string, value: { response?: string; results?: ApiResultItem[] }) =>
      mediathekMocks.cacheEntries.set(key, value)
    ),
  },
}));
vi.mock("@/lib/fetch-retry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fetch-retry")>()),
  fetchWithRetry: vi.fn(),
}));
vi.mock("./shows", () => ({
  getShowInfoByTvdbId: mediathekMocks.getShowInfoByTvdbId,
  getBaseShowInfoByTvdbId: mediathekMocks.getShowInfoByTvdbId,
  getBaseShowForSonarrRss: vi.fn(async () => null),
}));
// No rulesets by default -> every API result becomes an "unmatched" item.
vi.mock("./rulesets", () => mediathekMocks.rulesets);
vi.mock("./tmdb", () => ({
  searchMovieByTitle: vi.fn().mockResolvedValue(null),
}));
vi.mock("./radarr-provider", () => ({
  getRadarrMonitoredMovies: mediathekMocks.getRadarrMonitoredMovies,
}));

import {
  fetchMovieSearchByQuery,
  fetchMovieSearchResults,
  fetchMovieSearchForRssSync,
  fetchSearchResultsById,
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
} from "./mediathek";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { HttpRequestBudget } from "@/lib/fetch-retry";
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
  mockedFetch.mockImplementation(async () => Response.json({ result: { results } }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedFetch.mockReset();
  mediathekMocks.getRadarrMonitoredMovies.mockResolvedValue([]);
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

describe("Sonarr supplemental search consumer", () => {
  const supplemental: TvdbData = {
    id: 123,
    name: "Synthetic series",
    germanName: null,
    aliases: [],
    episodes: [
      {
        name: "Missing episode",
        seasonNumber: 2,
        episodeNumber: 3,
        aired: new Date("2026-09-29T12:00:00Z"),
        runtime: 2,
        metadataSource: "sonarr",
      },
    ],
  };
  it("refreshes TV source retrieval when bound rule topics change", async () => {
    mockApi([
      makeItem({ topic: supplemental.name, title: "Missing episode (S02/E03)", duration: 120 }),
    ]);
    mediathekMocks.rulesets.getRulesetContext.mockReturnValue("before-topic-change");
    const context = makeTvSearchContext({ tvdbId: supplemental.id, season: "2" });
    await fetchSearchResultsById(supplemental, context, 100, 0);
    const initialCalls = mockedFetch.mock.calls.length;
    expect(initialCalls).toBeGreaterThan(0);
    await fetchSearchResultsById(supplemental, context, 100, 0);
    expect(mockedFetch).toHaveBeenCalledTimes(initialCalls);
    mediathekMocks.rulesets.getRulesetContext.mockReturnValue("after-topic-change");
    await fetchSearchResultsById(supplemental, context, 100, 0);
    expect(mockedFetch.mock.calls.length).toBeGreaterThan(initialCalls);
  });

  it("finds an exact supplemental episode via its real title on the same caller budget", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockedFetch.mockImplementation(async (_input, init, options) => {
      options?.requestBudget?.takeAttempt();
      const query = JSON.parse(String(init?.body)).queries[0].query;
      return Response.json({
        result: {
          results:
            query === "Missing episode"
              ? [
                  makeItem({
                    topic: "Synthetic series",
                    title: "Missing episode",
                    duration: 120,
                    url_video_low: "",
                    url_video_hd: "",
                  }),
                ]
              : [],
        },
      });
    });
    const budget = new HttpRequestBudget(2);
    const xml = await fetchSearchResultsById(
      supplemental,
      makeTvSearchContext({ tvdbId: 123, season: "2", episode: "3" }),
      100,
      0,
      budget
    );
    expect(xml).toContain("S02E03");
    expect(xml).toContain('total="1"');
    expect(budget.remainingAttempts).toBe(0);
    expect(
      mockedFetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).queries[0].query)
    ).toEqual(["Synthetic series", "Missing episode"]);
  });

  it("uses the same final short-episode filter for exact and season searches before pagination", async () => {
    mockApi([
      makeItem({ topic: "Synthetic series", title: "Missing episode", duration: 120 }),
      makeItem({
        topic: "Synthetic series",
        title: "Missing episode Trailer",
        duration: 120,
        url_video: "https://example.invalid/trailer.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
      makeItem({
        topic: "Foreign series",
        title: "Missing episode",
        duration: 120,
        url_video: "https://example.invalid/foreign.mp4",
        url_video_low: "",
        url_video_hd: "",
      }),
    ]);
    const exact = await fetchSearchResultsById(
      supplemental,
      makeTvSearchContext({ tvdbId: 123, season: "2", episode: "3" }),
      100,
      0
    );
    const season = await fetchSearchResultsById(
      supplemental,
      makeTvSearchContext({ tvdbId: 123, season: "2" }),
      100,
      0
    );
    expect(exact).toContain("S02E03");
    expect(season).toContain("S02E03");
    expect(exact).not.toContain("Trailer");
    expect(exact).not.toContain("Foreign.series");
    expect(exact).toContain('total="3"'); // Three progressive quality releases, one verified episode.
    expect(exact).not.toContain("GERMAN");
    const page = await fetchSearchResultsById(
      supplemental,
      makeTvSearchContext({ tvdbId: 123, season: "2" }),
      1,
      1
    );
    expect(page).toContain('total="3"');
    expect(page.match(/<item>/g)).toHaveLength(1);
    expect(mockedGenerateRuleset).not.toHaveBeenCalled();
  });

  it("reports an unavailable missing episode instead of caching successful empty RSS", async () => {
    await expect(
      fetchSearchResultsById(
        { ...supplemental, episodes: [], sonarrUnavailable: true },
        makeTvSearchContext({ tvdbId: 123, season: "2", episode: "3" }),
        100,
        0
      )
    ).rejects.toThrow("Optional episode metadata unavailable");
    expect(mockedCacheSet).not.toHaveBeenCalled();
  });
});

describe("shared catalogue rules preserve identity and independent candidates", () => {
  const show: TvdbData = {
    id: 299964,
    name: "Occupied - Die Besatzung",
    germanName: null,
    aliases: [{ language: "eng", name: "Occupied" }],
    episodes: [
      { name: "Episode one", seasonNumber: 2, episodeNumber: 1, aired: null, runtime: 45 },
    ],
  };
  const rule: Ruleset = {
    id: 109,
    mediaId: 68,
    topic: "Fernsehfilme und Serien - Serien",
    priority: 0,
    filters: "[]",
    titleRegexRules: "[]",
    episodeRegex: "E(\\d+)",
    seasonRegex: "S(\\d+)",
    matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
    media: {
      media_id: 68,
      media_name: show.name,
      media_type: "show",
      media_tvdbId: show.id,
      media_tmdbId: null,
      media_imdbId: null,
    },
  };
  beforeEach(() => {
    mockedGetShowInfo.mockResolvedValue(show);
    mockedRulesetsForTopic.mockReturnValue([rule]);
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
  });
  it("never assigns foreign series coordinates to Occupied and retains neutral text results", async () => {
    mockApi([makeItem({ topic: rule.topic, title: "Foreign series S02E01" })]);
    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Foreign series" }),
      100,
      0
    );
    expect(xml).toContain('total="1"');
    expect(xml).not.toContain('name="tvdbid"');
    expect(xml).not.toContain("Occupied");
  });
  it("accepts the verified series alias with the same source coordinates", async () => {
    mockApi([makeItem({ topic: rule.topic, title: "Occupied S02E01" })]);
    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({ query: "Occupied" }),
      100,
      0
    );
    expect(xml).toContain('name="tvdbid" value="299964"');
    expect(xml).toContain("S02E01");
  });
  it("does not reuse identity output after a rule-context change, while reusing source candidates", async () => {
    mockApi([makeItem({ topic: rule.topic, title: "Occupied S02E01" })]);
    mediathekMocks.rulesets.getRulesetContext.mockReturnValue("rules-before");
    const context = makeTvSearchContext({ query: "Occupied" });
    const before = await fetchSearchResultsByString(context, 100, 0);
    expect(before).toContain('name="tvdbid" value="299964"');
    mediathekMocks.rulesets.getRulesetContext.mockReturnValue("rules-after");
    mockedRulesetsForTopic.mockReturnValue([]);
    const after = await fetchSearchResultsByString(context, 100, 0);
    expect(after).not.toContain('name="tvdbid"');
    expect(after).toContain('total="1"');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
  it.each(["bad-json", '[{"attribute":"duration","type":"GreaterThan","value":"1000"}]', "[]"])(
    "keeps independent candidates when a rule fails: %s",
    async (filters) => {
      mockedRulesetsForTopic.mockReturnValue([{ ...rule, topic: "Own topic", filters }]);
      mockApi([makeItem({ topic: "Own topic", title: "Independent result without coordinates" })]);
      const xml = await fetchSearchResultsByString(
        makeTvSearchContext({ query: "Independent" }),
        100,
        0
      );
      expect(xml).toContain('total="1"');
      expect(xml).not.toContain('name="tvdbid"');
    }
  );
});

describe("fetchSearchResultsByString – generic result gating", () => {
  it("keeps an ID-scoped unknown-coordinate candidate neutral while excluding source neighbors", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "A missing title",
        url_video: "https://example.org/unknown.mp4",
      }),
      makeItem({
        topic: "Example Show",
        title: "Example Show S02E12",
        url_video: "https://example.org/neighbor.mp4",
      }),
    ]);
    const xml = await fetchSearchResultsByString(
      makeTvSearchContext({
        query: "Example Show",
        tvdbId: 12345,
        season: "2",
        episode: "13",
      }),
      100,
      0
    );
    expect(xml).toContain('total="1"');
    expect(xml).toContain("Example.Show.A.missing.title");
    expect(xml).toContain("unknown.mp4");
    expect(xml).not.toContain("neighbor.mp4");
    expect(xml).not.toMatch(/name="(?:tvdbid|season|episode)"|S02E13/);
  });

  it("keeps ID-search candidates tied to the verified series name, never the request's foreign title", async () => {
    mockedGetSetting.mockImplementation(async (key) =>
      key === "download.quality" ? "720p" : null
    );
    const show: TvdbData = {
      id: 12345,
      name: "Example Show",
      germanName: null,
      aliases: [],
      episodes: [
        { name: "Known episode", seasonNumber: 2, episodeNumber: 13, aired: null, runtime: 60 },
      ],
    };
    mockApi([
      makeItem({
        topic: "Example Show",
        title: "A missing title",
        url_video: "https://example.org/unknown.mp4",
      }),
      makeItem({
        topic: "Foreign Show",
        title: "A missing title",
        url_video: "https://example.org/foreign.mp4",
      }),
    ]);
    const xml = await fetchSearchResultsById(
      show,
      makeTvSearchContext({
        tvdbId: 12345,
        season: "2",
        episode: "13",
      }),
      100,
      0
    );
    expect(xml).toContain('total="1"');
    expect(xml).toContain("unknown.mp4");
    expect(xml).not.toContain("foreign.mp4");
    expect(xml).not.toMatch(/name="(?:tvdbid|season|episode)"|S02E13/);
  });
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
      return Response.json({ result: { results: matched } });
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

  it("fixes A5: preserves candidate title without inventing film year, language or identity", async () => {
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
    expect(xml).toContain("Magazine.Feature.A.report.unrelated.to.the.requested.film.UNKNOWN");
    expect(xml).not.toContain(".2024.");
    expect(xml).not.toContain(".GERMAN.");
    expect(xml).not.toMatch(/name="(?:tmdbid|imdbid)"/);
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
    expect(mockedFetch).toHaveBeenCalledTimes(2);
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
      return Response.json({ result: { results: matches } });
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
      expect.stringContaining('q_v13-tv-source-facts_["Example",null,null,null]_1_1_720p_300'),
      expect.objectContaining({ response: secondPage })
    );
  });

  it("does not cache a failed provider response as a successful empty search", async () => {
    mockedFetch
      .mockRejectedValueOnce(new Error("synthetic provider failure"))
      .mockResolvedValueOnce(Response.json({ result: { results: [makeItem()] } }));

    const context = makeTvSearchContext({ query: "Example" });
    await expect(fetchSearchResultsByString(context, 100, 0)).rejects.toThrow(
      "Search provider unavailable"
    );
    expect(mockedCacheSet).not.toHaveBeenCalled();
    const retriedResponse = await fetchSearchResultsByString(context, 100, 0);

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
      expect.stringContaining("movie_query_v13-tv-source-facts_Documentary__100_0_all_2700"),
      expect.any(Object)
    );
  });
});

describe("movie rendition source audio consumer", () => {
  const movie: TmdbMovieData = {
    tmdbId: 123,
    imdbId: null,
    title: "Synthetic Film",
    germanTitle: "Synthetic Film",
    runtime: 60,
    productionYear: 2024,
    releaseDate: "2024-01-01",
  };
  function source() {
    return makeItem({
      channel: "ARTE.DE",
      topic: "Kino",
      title: "Synthetic Film",
      url_website: "https://www.arte.tv/de/videos/123456-001-A/synthetic/",
      url_video: "https://fixture.akamaized.net/french.mp4",
      url_video_hd: "https://fixture.akamaized.net/german.mp4",
      url_video_low: "",
    });
  }
  it.each(["id", "text", "rss"])(
    "selects German before the one-result limit in the actual %s film owner",
    async (path) => {
      const raw = source();
      mediathekMocks.getRadarrMonitoredMovies.mockResolvedValue([movie]);
      mockedFetch.mockImplementation(async (input, _init, options) => {
        options?.requestBudget?.takeAttempt();
        return Response.json(
          String(input).includes("hbbtvv2")
            ? {
                videoStreams: [
                  { programId: "123456-001-A", url: raw.url_video, audioCode: "VOF-STA" },
                  { programId: "123456-001-A", url: raw.url_video_hd, audioCode: "VA" },
                ],
              }
            : { result: { results: [raw] } }
        );
      });
      const xml =
        path === "id"
          ? await fetchMovieSearchResults(movie, 1, 0)
          : path === "text"
            ? await fetchMovieSearchByQuery("Synthetic Film", 1, 0)
            : await fetchMovieSearchForRssSync(1, 0);
      expect(xml).toContain(".GERMAN.");
      expect(xml).toContain("german.mp4");
      expect(xml).not.toContain("french.mp4");
      expect(xml.match(/<item>/g)).toHaveLength(1);
      expect(xml).toContain('total="1"');
      expect(raw).not.toHaveProperty("audioLanguage");
    }
  );
  it("does not cache a partial successful feed after the source proof fails", async () => {
    mockedFetch.mockImplementation(async (input) =>
      String(input).includes("hbbtvv2")
        ? new Response(null, { status: 503 })
        : Response.json({ result: { results: [source()] } })
    );
    await expect(fetchMovieSearchResults(movie, 1, 0)).rejects.toThrow(
      "Source evidence unavailable"
    );
    expect(mockedCacheSet).not.toHaveBeenCalledWith(
      expect.stringMatching(/^movie_/),
      expect.anything()
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
      expect.stringMatching(/^movie_v13-tv-source-facts_[a-f0-9]{64}_100_0_all_2700/),
      expect.any(Object)
    );
  });
});

it("rejects an incomplete multi-title movie search without caching partial RSS", async () => {
  const movie: TmdbMovieData = {
    tmdbId: 29,
    imdbId: "tt0000029",
    title: "Original Title",
    germanTitle: "Deutscher Titel",
    runtime: 90,
    releaseDate: "2026-07-12",
  };
  mockedFetch
    .mockRejectedValueOnce(new Error("token=private"))
    .mockResolvedValueOnce(Response.json({ result: { results: [makeItem()] } }));

  await expect(fetchMovieSearchResults(movie, 100, 0)).rejects.toThrow(
    "Search provider unavailable"
  );
  expect(mockedCacheSet).not.toHaveBeenCalledWith(
    expect.stringMatching(/^movie_/),
    expect.anything()
  );
  const deadlines = mockedFetch.mock.calls.map(([, , options]) => options?.deadlineAt);
  expect(deadlines).toHaveLength(2);
  expect(new Set(deadlines).size).toBe(1);
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
