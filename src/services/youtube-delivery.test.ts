import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TvdbData } from "@/types";
import type { YoutubeRegistry, YoutubeIndexRow } from "@/lib/youtube-catalogue";
const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  index: null as unknown,
  resolve: vi.fn(),
  base: vi.fn(),
  show: null as TvdbData | null,
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
