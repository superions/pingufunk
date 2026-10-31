import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TvdbData, TmdbMovieData } from "@/types";
import type { YoutubeRegistry, YoutubeIndexRow } from "@/lib/youtube-catalogue";
const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  index: null as unknown,
  resolve: vi.fn(),
  base: vi.fn(),
  show: null as TvdbData | null,
  movie: null as TmdbMovieData | null,
}));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => state.settings.get(key) ?? null,
  getMinDurationSeconds: async () => 0,
}));
vi.mock("./youtube-catalogue", () => ({
  readYoutubeCatalogueIndex: async () => state.index,
  assertYoutubeCatalogueRevision: async (revision: string) => {
    if ((state.index as { revision: string }).revision !== revision) throw Error("changed");
  },
}));
vi.mock("./shows", () => ({
  getShowInfoByTvdbId: async () => state.show,
  getBaseShowInfoByTvdbId: async () => state.show,
}));
vi.mock("./radarr-provider", () => ({ getRadarrMovie: async () => state.movie }));
vi.mock("./tmdb", () => ({ getMovieInfoByTmdbId: async () => state.movie }));
vi.mock("@/providers/youtube/resolve", () => ({ resolveYoutubeMedia: state.resolve }));
vi.mock("@/lib/mediathek-client", () => ({
  MEDIATHEK_VIEW_MAX_PAGE_SIZE: 1000,
  queryMediathekView: state.base,
}));
vi.mock("@/providers/srf", () => ({
  srfProvider: { isEnabled: async () => false, search: async () => [] },
}));
vi.mock("@/lib/db", () => ({ prisma: { config: {} } }));
import { queryContentWindow, queryContent, searchCacheContext } from "./content-search";
import { sourceMediaFacts } from "./source-media-facts";
import { TvSearchDeliveryJournal } from "./tv-search-delivery";
import { matchBoundSourceEpisode } from "./source-programme";
import { generateRssItems } from "./newznab";
import { generateFakeNzb, parseNzbContent } from "./nzb-release";
import { validateReleaseSource } from "./source-enqueue";
import { downloadSource } from "@/server/source-download";
import { createUiNzbDownloads } from "./ui-nzb";
import { youtubeMappingKey } from "@/lib/youtube-catalogue";
import { matchMovieItems } from "./movie-matcher";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { mergeSonarrShow } from "./sonarr-provider";
import { parseSonarrEpisodes } from "./sonarr-metadata";
import {
  assembleMovieReleases,
  assembleRecentMovieReleases,
  assembleGenericMovieReleases,
} from "./mediathek-release";
import { generateMatchedMovieRssItems } from "./newznab";
const channel = "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlist = "PLsynthetic123456",
  video = "abcdefghijk";
const selection = {
  videoFormat: "137",
  audioFormat: "140-1",
  audioTrack: "140-1",
  language: "de",
  width: 1920,
  height: 1080,
  duration: 600,
};
let journal: TvSearchDeliveryJournal | undefined;
const query = [{ fields: ["topic", "title"], query: "Synthetic series" }];
beforeEach(() => {
  state.movie = null;
  vi.useFakeTimers();
  state.settings.clear();
  state.settings.set("provider.youtube.enabled", "true");
  state.settings.set("provider.srf.enabled", "false");
  state.base.mockReset();
  state.base.mockResolvedValue([]);
  state.resolve.mockReset();
  state.resolve.mockResolvedValue({
    selection,
    videoUrl: "https://private-cdn.invalid/video",
    audioUrl: "https://private-cdn.invalid/audio",
    size: 0,
  });
  state.show = {
    id: 42,
    name: "Synthetic series",
    germanName: null,
    aliases: [],
    episodes: [
      {
        seasonNumber: 1,
        episodeNumber: 13,
        name: "Episode: concrete title",
        runtime: 10,
        aired: new Date("2001-01-01"),
      },
    ],
    sonarrMonitoredCoordinates: ["1:13"],
  };
  const registry: YoutubeRegistry = {
    version: 1,
    channels: [{ id: channel, name: "Synthetic channel", enabled: true }],
    programMappings: [
      {
        kind: "series",
        channelId: channel,
        sourceId: playlist,
        targetId: 42,
        name: "Synthetic series",
        enabled: true,
        sourceNumbering: "publisher",
        targetOrder: "aired",
      },
    ],
  };
  const row: YoutubeIndexRow = {
    mappingKey: youtubeMappingKey(registry.programMappings[0]),
    videoId: video,
    channelId: channel,
    availability: "listed",
    firstSeenAt: 1,
    content: {
      channel: "Synthetic channel",
      topic: "Synthetic series",
      title: "Synthetic series, Staffel 2, Folge 1: Episode: concrete title",
      description: "Synthetic",
      filmlisteTimestamp: 1,
      contentDates: { catalogueUpdatedAt: 1 },
      duration: 600,
      size: 0,
      url_website: `https://www.youtube.com/watch?v=${video}`,
      url_video: "",
      url_video_hd: "",
      url_video_low: "",
    },
  };
  state.index = {
    revision: "a".repeat(64),
    registry,
    enabled: true,
    current: true,
    indexed: true,
    at: 1,
    rows: [row],
  };
});
afterEach(async () => {
  journal?.dispose();
  journal = undefined;
  sourceMediaFacts.clear();
  await sourceMediaFacts.idle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("carries one cold canonical discovery through the shared worker hints and durable journal to stable RSS/UI NZBs, without fake Mediathek URLs", async () => {
  const cold = await queryContentWindow(query, 100, {
    arteSeries: state.show!,
    deferLanguageSelection: true,
  });
  expect(cold.coverage).toMatchObject({ complete: true, baseComplete: true });
  expect(cold.items).toHaveLength(1);
  expect(state.resolve).not.toHaveBeenCalled();
  const item = cold.items[0];
  expect([item.url_video, item.url_video_hd, item.url_video_low]).toEqual(["", "", ""]);
  expect(item.sourceRef?.programme).toEqual({
    kind: "series",
    targetId: 42,
    season: 1,
    episode: 13,
  });
  const match = matchBoundSourceEpisode(item, state.show!, 0, 10)!;
  expect(match.episode.seasonNumber).toBe(1);
  expect(match.episode.episodeNumber).toBe(13);
  expect(matchBoundSourceEpisode(item, { ...state.show!, id: 43 }, 0, 10)).toBeNull();
  expect(
    matchBoundSourceEpisode(item, { ...state.show!, sonarrBlockedCoordinates: ["1:13"] }, 0, 10)
  ).toBeNull();
  expect(
    matchBoundSourceEpisode(
      item,
      { ...state.show!, episodes: [...state.show!.episodes, ...state.show!.episodes] },
      0,
      10
    )
  ).toBeNull();
  let persisted: string | null = null;
  journal = new TvSearchDeliveryJournal(
    {
      read: async () => persisted,
      write: async (value) => {
        persisted = value;
      },
    },
    sourceMediaFacts
  );
  await journal.register("b".repeat(64), state.show!, [match]);
  expect(generateRssItems(match, "all")).toEqual([]);
  await vi.advanceTimersByTimeAsync(30);
  await sourceMediaFacts.idle();
  await journal.idle();
  expect(state.resolve).toHaveBeenCalledTimes(1);
  expect((await journal.current("b".repeat(64)))[0].readyAt).not.toBeNull();
  const warm = await queryContentWindow(query, 100, {
    arteSeries: state.show!,
    deferLanguageSelection: true,
  });
  const bound = matchBoundSourceEpisode(warm.items[0], state.show!, 0, 10)!;
  const releases = generateRssItems(bound, "all");
  expect(releases).toHaveLength(1);
  expect(releases[0].guid.value).toMatch(/^pingufunk:youtube:abcdefghijk:/);
  expect(releases[0].title).toContain(".S01E13.");
  expect(releases[0].title).toContain(".1080p.");
  const nzb = parseNzbContent(
    Object.values(createUiNzbDownloads(warm.items[0], false, bound.episode))[0]!
  )!;
  expect(nzb.url).toBe(`https://www.youtube.com/watch?v=${video}`);
  expect(nzb.mediaExpectations).toMatchObject({
    version: 5,
    sourceRef: { selection, programme: { season: 1, episode: 13 } },
  });
  expect(JSON.stringify(nzb)).not.toContain("private-cdn");
  expect(parseNzbContent(generateFakeNzb(nzb))).toEqual(nzb);
  await expect(validateReleaseSource(nzb.url, nzb.mediaExpectations)).resolves.toBeUndefined();
  const frozen = downloadSource(nzb.url, nzb.mediaExpectations!);
  (state.index as { enabled: boolean }).enabled = false;
  await expect(validateReleaseSource(nzb.url, nzb.mediaExpectations)).rejects.toThrow();
  expect(downloadSource(nzb.url, nzb.mediaExpectations!)).toEqual(frozen);
  expect(() => downloadSource("https://evil.invalid", nzb.mediaExpectations!)).toThrow();
  expect(state.resolve).toHaveBeenCalledTimes(1);
});
it.each([
  ["Grauroter Morgen", "Grau-roter Morgen"],
  ["Noch 10 Minuten zu leben", "Noch zehn Minuten zu leben"],
  ["Mord nach der Uhr", "Ein Mord nach der Uhr"],
])(
  "carries a minor metadata title variant through source binding, RSS and NZB: %s / %s",
  async (canonical, instance) => {
    state.show!.episodes[0].name = canonical;
    state.show = mergeSonarrShow(state.show, {
      series: { sonarrId: 12, tvdbId: 42, title: "Synthetic series", monitored: true },
      episodes: parseSonarrEpisodes(
        [
          {
            id: 45,
            seriesId: 12,
            seasonNumber: 1,
            episodeNumber: 13,
            title: instance,
            airDate: "2001-01-01",
            airDateUtc: "2001-01-01T20:00:00Z",
            runtime: 10,
            monitored: true,
            hasFile: false,
          },
        ],
        12
      ),
    });
    expect(state.show!.sonarrBlockedCoordinates).toEqual([]);
    (state.index as { rows: YoutubeIndexRow[] }).rows[0].content!.title =
      `Synthetic series, Staffel 2, Folge 1: ${canonical}`;
    const options = { arteSeries: state.show!, deferLanguageSelection: true };
    await queryContentWindow(query, 100, options);
    await vi.advanceTimersByTimeAsync(30);
    await sourceMediaFacts.idle();
    const warm = await queryContentWindow(query, 100, options);
    expect(warm.items).toHaveLength(1);
    const bound = matchBoundSourceEpisode(warm.items[0], state.show!, 0, 10)!;
    expect(bound).not.toBeNull();
    const releases = generateRssItems(bound, "all");
    expect(releases).toHaveLength(1);
    expect(releases[0].title).toContain(".S01E13.");
    expect(releases[0].title).toContain(".GERMAN.");
    const nzb = parseNzbContent(
      Object.values(createUiNzbDownloads(warm.items[0], false, bound.episode))[0]!
    )!;
    expect(nzb.mediaExpectations).toMatchObject({
      version: 5,
      sourceRef: { programme: { kind: "series", targetId: 42, season: 1, episode: 13 }, selection },
    });
    await expect(validateReleaseSource(nzb.url, nzb.mediaExpectations)).resolves.toBeUndefined();
    expect(downloadSource(nzb.url, nzb.mediaExpectations!)).toMatchObject({
      family: "youtube",
      programme: { targetId: 42, season: 1, episode: 13 },
    });
  }
);

it("keeps successful required base results including a true empty window during optional YouTube failure, but never treats YouTube-only failure as an empty success", async () => {
  (state.index as { current: boolean }).current = false;
  const context = await searchCacheContext();
  const mixed = await queryContentWindow(query, 100);
  expect(mixed.coverage).toMatchObject({ complete: false, baseComplete: true });
  expect(mixed.items).toEqual([]);
  expect(await searchCacheContext()).not.toBe(context);
  expect(await queryContent(query, 100)).toEqual([]);
  const only = await queryContentWindow(query, 100, {}, "youtube");
  expect(only.coverage).toMatchObject({ complete: false, baseComplete: false });
  state.settings.set("provider.mediathekview.enabled", "false");
  expect(await queryContent(query, 100)).toBeNull();
  state.base.mockResolvedValue(null);
  state.settings.set("provider.mediathekview.enabled", "true");
  (state.index as { current: boolean }).current = true;
  expect(await queryContent(query, 100)).toBeNull();
});
it("performs no source read for disabled YouTube and prevents title/count/position from inventing a binding", async () => {
  state.settings.set("provider.youtube.enabled", "false");
  const result = await queryContentWindow(query, 100, {}, "youtube");
  expect(result.coverage.sources[0].state).toBe("disabled");
  expect(state.resolve).not.toHaveBeenCalled();
  state.settings.set("provider.youtube.enabled", "true");
  (state.index as { rows: YoutubeIndexRow[] }).rows[0].content!.title =
    "Synthetic series, Staffel 2, Folge 1: Unknown";
  expect(
    (
      await queryContentWindow(query, 100, {
        arteSeries: state.show!,
        deferLanguageSelection: true,
      })
    ).items
  ).toEqual([]);
  expect(state.resolve).not.toHaveBeenCalled();
});

it("carries an explicitly mapped film through the same search, strict movie matcher, RSS and enqueue boundary while rejecting another film ID or year", async () => {
  state.movie = {
    tmdbId: 101,
    imdbId: "tt1234567",
    title: "Synthetic film",
    germanTitle: "Synthetic film",
    runtime: 10,
    productionYear: 2001,
    releaseDate: null,
  };
  const index = state.index as { registry: YoutubeRegistry; rows: YoutubeIndexRow[] };
  const mapping = {
    kind: "movie" as const,
    channelId: channel,
    sourceId: video,
    targetId: 101,
    name: "Synthetic film",
    enabled: true,
  };
  index.registry.programMappings = [mapping];
  const row = index.rows[0];
  row.mappingKey = youtubeMappingKey(mapping);
  row.content!.topic = "Synthetic film";
  row.content!.title = "Synthetic film (2001)";
  const query = [{ fields: ["topic", "title"], query: "Synthetic film" }];
  await queryContentWindow(query, 100, { mediaType: "movie" }, "youtube");
  await vi.advanceTimersByTimeAsync(30);
  await sourceMediaFacts.idle();
  const warm = await queryContentWindow(query, 100, { mediaType: "movie" }, "youtube");
  expect(warm.items).toHaveLength(1);
  expect(warm.items[0].sourceRef?.programme).toEqual({ kind: "movie", targetId: 101 });
  expect(warm.items[0].sourceRef).not.toHaveProperty("playlistId");
  const [match] = await matchMovieItems(warm.items, state.movie, 0, false);
  expect(match.identityVerified).toBe(true);
  expect(await matchMovieItems(warm.items, { ...state.movie, tmdbId: 102 }, 0, false)).toEqual([]);
  const releases = generateMatchedMovieRssItems(match, state.movie, "all", false);
  expect(releases).toHaveLength(1);
  expect(releases[0].title).toContain("Synthetic.film.2001");
  expect(releases[0].guid.value).toMatch(/^pingufunk:youtube:/);
  const nzb = parseNzbContent(Object.values(createUiNzbDownloads(warm.items[0], false))[0]!)!;
  expect(nzb.mediaExpectations).toMatchObject({
    version: 5,
    mediaKind: "movie",
    durations: { metadata: null },
  });
  await expect(validateReleaseSource(nzb.url, nzb.mediaExpectations)).resolves.toBeUndefined();
  const baseItem = {
    ...warm.items[0],
    sourceRef: undefined,
    sourceRenditions: undefined,
    sourceAudioEvidence: undefined,
    url_video: "https://fixture.akamaized.net/independent.mp4",
    title: "Independent synthetic film",
    audioLanguage: "de",
  };
  state.resolve.mockRejectedValue(Error("Extractor unavailable"));
  const calls = state.resolve.mock.calls.length;
  const generic = await assembleGenericMovieReleases(
    [warm.items[0], baseItem],
    new HttpRequestBudget(),
    "best",
    false
  );
  expect(generic).toHaveLength(2);
  expect(
    await assembleMovieReleases([match], state.movie!, new HttpRequestBudget(), "best", false)
  ).toHaveLength(1);
  expect(
    await assembleRecentMovieReleases(
      [{ match, movie: state.movie! }],
      new HttpRequestBudget(),
      "best",
      false
    )
  ).toHaveLength(1);
  expect(state.resolve).toHaveBeenCalledTimes(calls);
  sourceMediaFacts.clear();
  expect(
    await assembleGenericMovieReleases(
      [warm.items[0], baseItem],
      new HttpRequestBudget(),
      "best",
      false
    )
  ).toHaveLength(1);
  expect(state.resolve).toHaveBeenCalledTimes(calls);
  row.content!.title = "Synthetic film (2002)";
  expect((await queryContentWindow(query, 100, { mediaType: "movie" }, "youtube")).items).toEqual(
    []
  );
  await expect(validateReleaseSource(nzb.url, nzb.mediaExpectations)).rejects.toThrow();
});

it("keeps declared 720p selectable beside 1080p from one detail call and binds every RSS/UI NZB to its own exact format", async () => {
  const lower = { ...selection, videoFormat: "136", width: 1280, height: 720 };
  state.resolve.mockResolvedValue({
    selection,
    selections: [selection, lower],
    videoUrl: "private",
    audioUrl: "private",
    size: 0,
  });
  await queryContentWindow(query, 100, { arteSeries: state.show!, deferLanguageSelection: true });
  await vi.advanceTimersByTimeAsync(30);
  await sourceMediaFacts.idle();
  const [item] = (
    await queryContentWindow(query, 100, { arteSeries: state.show!, deferLanguageSelection: true })
  ).items;
  const match = matchBoundSourceEpisode(item, state.show!, 0, 10)!;
  expect(generateRssItems(match, "all", false)).toHaveLength(2);
  const release = generateRssItems(match, "720p", false);
  expect(release).toHaveLength(1);
  expect(release[0].title).toContain(".720p.");
  expect(generateRssItems(match, "480p", false)).toEqual([]);
  const downloads = createUiNzbDownloads(item, false, match.episode);
  const hd = parseNzbContent(downloads["1080p"]!)!,
    sd = parseNzbContent(downloads["720p"]!)!;
  expect(hd.mediaExpectations).toMatchObject({
    version: 5,
    resolution: { width: 1920, height: 1080 },
    sourceRef: { selection: { videoFormat: "137" } },
  });
  expect(sd.mediaExpectations).toMatchObject({
    version: 5,
    resolution: { width: 1280, height: 720 },
    sourceRef: { selection: { videoFormat: "136" } },
    sourceAudio: { selection: { videoFormat: "136" } },
  });
  await expect(validateReleaseSource(sd.url, sd.mediaExpectations)).resolves.toBeUndefined();
  const rssUrl = new URL(release[0].enclosure.url, "http://localhost");
  expect(
    JSON.parse(Buffer.from(rssUrl.searchParams.get("encodedExpectations")!, "base64").toString())
  ).toEqual(sd.mediaExpectations);
  expect(downloadSource(sd.url, sd.mediaExpectations!)).toMatchObject({
    selection: { videoFormat: "136", height: 720 },
  });
  expect(state.resolve).toHaveBeenCalledTimes(1);
});

it("journals five measured resolutions with both yearly release forms within the typed entry bound, without adding discovery entries or extractor calls", async () => {
  state.show!.episodes[0].seasonNumber = 2024;
  state.show!.episodes[0].aired = new Date("2024-01-01");
  state.show!.sonarrMonitoredCoordinates = ["2024:13"];
  const selections = [2160, 1080, 720, 576, 480].map((height) => ({
    ...selection,
    height,
    width: height === 2160 ? 3840 : height === 1080 ? 1920 : height === 720 ? 1280 : 854,
    videoFormat: "video-" + height,
  }));
  state.resolve.mockResolvedValue({
    selection: selections[0],
    selections,
    videoUrl: "private",
    audioUrl: "private",
    size: 0,
  });
  await queryContentWindow(query, 100, { arteSeries: state.show!, deferLanguageSelection: true });
  await vi.advanceTimersByTimeAsync(30);
  await sourceMediaFacts.idle();
  const [item] = (
    await queryContentWindow(query, 100, { arteSeries: state.show!, deferLanguageSelection: true })
  ).items;
  const match = matchBoundSourceEpisode(item, state.show!, 0, 10)!;
  const releases = generateRssItems(match, "all", false);
  expect(releases).toHaveLength(10);
  const allUi = createUiNzbDownloads(item, false, match.episode);
  expect(Object.keys(allUi)).toEqual(["2160p", "1080p", "720p", "576p", "480p"]);
  expect(
    Object.values(allUi).map(
      (body) => parseNzbContent(body!)!.mediaExpectations!.resolution?.height
    )
  ).toEqual([2160, 1080, 720, 576, 480]);
  let persisted: string | null = null;
  journal = new TvSearchDeliveryJournal(
    {
      read: async () => persisted,
      write: async (value) => {
        persisted = value;
      },
    },
    sourceMediaFacts
  );
  const scope = "b".repeat(64);
  await journal.register(scope, state.show!, [match]);
  const entries = await journal.current(scope);
  expect(entries).toHaveLength(1);
  const announcements = releases.map((row) => ({ entryId: entries[0].id, guid: row.guid.value }));
  expect((await journal.announce(scope, announcements)).size).toBe(10);
  expect((await journal.announce(scope, announcements)).size).toBe(10);
  await expect(
    journal.announce(scope, [{ entryId: entries[0].id, guid: "another-format" }])
  ).rejects.toThrow();
  expect(state.resolve).toHaveBeenCalledTimes(1);
});

it("finds indexed episode titles and applies channel/description predicates to each bound item before pagination", async () => {
  const index = state.index as { rows: YoutubeIndexRow[] };
  index.rows[0].content!.description = "Distinctive synthetic description";
  const predicates = [
    { fields: ["title"], query: "Episode: concrete title" },
    { fields: ["channel"], query: "Synthetic channel" },
    { fields: ["description"], query: "distinctive" },
  ];
  const cold = await queryContentWindow(predicates, 1, { mediaType: "series" }, "youtube");
  expect(cold.items).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(30);
  await sourceMediaFacts.idle();
  const warm = await queryContentWindow(predicates, 1, { mediaType: "series" }, "youtube");
  expect(warm.items).toHaveLength(1);
  expect(warm.items[0].sourceRef?.programme).toMatchObject({
    targetId: 42,
    season: 1,
    episode: 13,
  });
  const wrong = await queryContentWindow(
    [...predicates, { fields: ["description"], query: "absent" }],
    1,
    {},
    "youtube"
  );
  expect(wrong.items).toEqual([]);
  expect((await queryContentWindow(predicates, 1, { offset: 1 }, "youtube")).items).toEqual([]);
  expect(state.resolve).toHaveBeenCalledTimes(1);
});
