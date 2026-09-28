import { describe, it, expect, vi, beforeEach } from "vitest";
import { MatchingStrategy } from "@/types";
import type { ApiResultItem, Ruleset, TmdbMovieData, TvdbData } from "@/types";

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

    const xml = await fetchSearchResultsByString(null, "01", 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });

  it("DOES emit generic results for an actual text query (q set)", async () => {
    mockApi([makeItem({ topic: "Markus Lanz", title: "Markus Lanz (S2026/E70)" })]);

    const xml = await fetchSearchResultsByString("Markus Lanz", null, 100, 0);

    expect(xml).not.toContain('total="0"');
    expect(xml).toContain("<item>");
  });

  it("treats a whitespace-only q like an empty query (no generic results)", async () => {
    mockApi([makeItem({ topic: "Show C", title: "Show C (S01/E04)" })]);

    const xml = await fetchSearchResultsByString("   ", "01", 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });
});

describe("P00 historical search characterizations", () => {
  it("characterizes A4: literal S02 querying misses a title written as Staffel 2", async () => {
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

    const xml = await fetchSearchResultsByString("Example", "02", 100, 0);

    const requestBody = JSON.parse(String(mockedFetch.mock.calls[0][1]?.body));
    expect(requestBody.queries).toEqual([
      { fields: ["topic", "title"], query: "Example" },
      { fields: ["title"], query: "S02" },
    ]);
    // The source title matches Example but not the additional literal S02 clause.
    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("<item>");
  });

  it("characterizes A5: a long unrelated text result is published as a movie", async () => {
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
    expect(xml).toContain("Magazine.Feature.2024.GERMAN");
    expect(xml).not.toContain("Example.Film.1998");
  });

  it("characterizes A6: an HLS standard URL discards an available progressive HD URL", async () => {
    const mixedRenditions = makeItem({
      topic: "Example",
      title: "Example episode",
      url_video: "https://example.org/standard.m3u8",
      url_video_hd: "https://example.org/progressive-hd.mp4",
      url_video_low: "",
    });
    mockApi([mixedRenditions]);

    const xml = await fetchSearchResultsByString("Example", null, 100, 0);

    expect(xml).toContain('total="0"');
    expect(xml).not.toContain("progressive-hd.mp4");
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

    const xml = await fetchSearchResultsById(tvdbData, "02", "2", 100, 0);

    expect(xml).toContain('total="1"');
    expect(xml).toContain("S02E02");
    expect(xml).toContain("episode-2.mp4");
    expect(xml).not.toContain("S02E01");
    expect(xml).not.toContain("Episode-1");
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

    const secondPage = await fetchSearchResultsByString("Example", null, 1, 1);
    const samePageFromCache = await fetchSearchResultsByString("Example", null, 1, 1);
    const thirdPage = await fetchSearchResultsByString("Example", null, 1, 2);

    expect(secondPage).toContain('offset="1"');
    expect(secondPage).toContain('total="3"');
    expect(secondPage).toContain("Example.B");
    expect(secondPage).not.toContain("Example.A");
    expect(samePageFromCache).toBe(secondPage);
    expect(thirdPage).toContain('offset="2"');
    expect(thirdPage).toContain("Example.C");
    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedCacheSet).toHaveBeenCalledWith(
      expect.stringContaining("q_Example_null_1_1_720p_300"),
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

    const failedResponse = await fetchSearchResultsByString("Example", null, 100, 0);
    expect(mockedCacheSet).not.toHaveBeenCalled();
    const retriedResponse = await fetchSearchResultsByString("Example", null, 100, 0);

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
  }
);

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
