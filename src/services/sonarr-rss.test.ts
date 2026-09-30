import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ApiResultItem, TvdbData } from "@/types";
import type { MediathekQueryOptions } from "@/lib/mediathek-client";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const state = vi.hoisted(() => ({
  epoch: 0,
  settings: new Map<string, string>(),
  pending: new Map<string, Promise<unknown>>(),
  query: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => state.settings.get(key) ?? null),
  getMinDurationSeconds: async () => 300,
}));
vi.mock("@/lib/cache", () => ({
  cacheContextEpoch: () => state.epoch,
  metadataCacheKey: (source: string, identity: unknown, context: unknown) =>
    JSON.stringify([state.epoch, source, identity, context]),
  coalesceMetadata: (key: string, load: () => Promise<unknown>) => {
    if (state.pending.has(key)) return state.pending.get(key);
    const pending = load().finally(() => state.pending.delete(key));
    state.pending.set(key, pending);
    return pending;
  },
}));
vi.mock("./content-search", () => ({
  getConfiguredLanguagePolicy: async () =>
    (await import("@/lib/language-policy")).DEFAULT_LANGUAGE_POLICY,
  searchCacheContext: async () => "synthetic-context",
  queryContent: state.query,
}));
import { getSonarrRssMatches } from "./sonarr-rss";

const now = Date.parse("2026-09-30T12:00:00Z");
const inventory = Array.from({ length: 7 }, (_, index) => ({
  id: index + 1,
  tvdbId: index + 101,
  title: `Synthetic ${index + 1}`,
  monitored: index < 6,
}));
const episodes = new Map<number, object[]>();
let fetchMock: ReturnType<typeof vi.fn>;
const base = vi.fn(async (): Promise<TvdbData | null> => null);

beforeEach(() => {
  state.epoch++;
  state.settings.clear();
  state.settings.set("integration.sonarr.enabled", "true");
  state.settings.set("integration.sonarr.url", "https://example.invalid/sonarr");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-rss-key");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  episodes.clear();
  for (const series of inventory)
    episodes.set(series.id, [
      {
        id: series.id * 100,
        seriesId: series.id,
        seasonNumber: 1,
        episodeNumber: 1,
        title: "Missing episode",
        airDateUtc: "2026-09-29T12:00:00Z",
        runtime: 2,
      },
    ]);
  fetchMock = vi.fn(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/system/status")) return Response.json({ version: "4.0.1" });
    if (url.pathname.endsWith("/series")) return Response.json(inventory);
    return Response.json(episodes.get(Number(url.searchParams.get("seriesId"))));
  });
  vi.stubGlobal("fetch", fetchMock);
  state.query.mockReset();
  state.query.mockImplementation(
    async (queries: { query: string }[], _size: number, options: MediathekQueryOptions) => {
      options.requestBudget!.takeAttempt();
      return [
        {
          channel: "ARD",
          topic: queries[0].query,
          title: "Missing episode",
          description: "",
          filmlisteTimestamp: now / 1000,
          duration: 120,
          size: 1234,
          url_video: "https://example.invalid/media.mp4",
          url_video_hd: "",
          url_video_low: "",
          url_website: "https://example.invalid/episode",
        } satisfies ApiResultItem,
      ];
    }
  );
  base.mockReset();
  base.mockResolvedValue(null);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("default-off performs no inventory or content requests", async () => {
  state.settings.set("integration.sonarr.enabled", "false");
  expect(await getSonarrRssMatches(base)).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
  expect(state.query).not.toHaveBeenCalled();
});

it("bounds cold snapshots to the shared ten attempts and rotates monitored series only", async () => {
  const first = await getSonarrRssMatches(base);
  expect(first.map((match) => match.tvdbId)).toEqual([101, 102, 103, 104]);
  expect(fetchMock.mock.calls.length + state.query.mock.calls.length).toBe(10);
  const budget = state.query.mock.calls[0][2].requestBudget;
  expect(budget.remainingAttempts).toBe(0);
  expect(
    state.query.mock.calls.every(
      (call) => call[2].requestBudget === budget && call[2].progressiveOnly
    )
  ).toBe(true);
  expect(await getSonarrRssMatches(base)).toEqual(first);
  expect(state.query).toHaveBeenCalledTimes(4);
  vi.setSystemTime(now + 60_000);
  const second = await getSonarrRssMatches(base);
  expect(second.map((match) => match.tvdbId)).toEqual([105, 106, 101, 102, 103]);
  expect(second.some((match) => match.tvdbId === 107)).toBe(false);
});

it("uses the foreground RSS budget and reserves five attempts for its source window", async () => {
  const budget = new HttpRequestBudget();
  const matches = await getSonarrRssMatches(base, budget);
  expect(matches.map((match) => match.tvdbId)).toEqual([101]);
  expect(state.query).toHaveBeenCalledTimes(1);
  expect(state.query.mock.calls[0][2].requestBudget).toBe(budget);
  expect(budget.remainingAttempts).toBe(6);
  // The same caller can still perform its primary five-page Recent retrieval.
  for (let page = 0; page < 5; page++) budget.takeAttempt();
  expect(budget.remainingAttempts).toBe(1);
});

it("uses inclusive UTC boundaries and excludes future/missing/invalid dates", async () => {
  const times = [
    "2026-09-16T12:00:00Z",
    "2026-09-30T12:00:00Z",
    "2026-09-16T11:59:59Z",
    "2026-09-30T12:00:01Z",
    null,
    "invalid",
  ];
  episodes.set(
    1,
    times.map((time, index) => ({
      id: 100 + index,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: index + 1,
      title: `Boundary ${index + 1}`,
      airDateUtc: time,
      runtime: 2,
    }))
  );
  state.query.mockImplementation(
    async (_queries: unknown, _size: number, options: MediathekQueryOptions) => {
      options.requestBudget!.takeAttempt();
      return times.map((_time, index) => ({
        channel: "ARD",
        topic: "Synthetic 1",
        title: `Boundary ${index + 1}`,
        description: "",
        filmlisteTimestamp: now / 1000,
        duration: 120,
        size: 123,
        url_video: "https://example.invalid/media.mp4",
        url_video_hd: "",
        url_video_low: "",
        url_website: "https://example.invalid/episode",
      }));
    }
  );
  const matches = await getSonarrRssMatches(base);
  expect(matches.map((match) => match.episode.episodeNumber)).toEqual([1, 2]);
});

it("does not publish a partial snapshot or advance the cursor after a later source failure", async () => {
  const original = state.query.getMockImplementation()!;
  state.query.mockImplementationOnce(original).mockResolvedValueOnce(null);
  await expect(getSonarrRssMatches(base)).rejects.toThrow("Optional episode metadata unavailable");
  state.query.mockImplementation(original);
  const retry = await getSonarrRssMatches(base);
  expect(retry[0].tvdbId).toBe(101);
  expect(retry.some((match) => match.tvdbId === 106)).toBe(false);
});

it("coalesces concurrent snapshots and discards a late invalidated source response", async () => {
  let release!: (value: ApiResultItem[]) => void;
  state.query.mockImplementationOnce(
    () =>
      new Promise<ApiResultItem[]>((resolve) => {
        release = resolve;
      })
  );
  const first = getSonarrRssMatches(base);
  const second = getSonarrRssMatches(base);
  await vi.waitFor(() => expect(state.query).toHaveBeenCalledTimes(1));
  state.epoch++;
  release([]);
  await expect(first).rejects.toThrow("Optional episode metadata unavailable");
  await expect(second).rejects.toThrow("Optional episode metadata unavailable");
  expect((await getSonarrRssMatches(base))[0].tvdbId).toBe(101);
});

it("caps selected episodes at fifty rather than searching an entire library", async () => {
  episodes.set(
    1,
    Array.from({ length: 80 }, (_, index) => ({
      id: 1000 + index,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: index + 1,
      title: `Boundary ${index + 1}`,
      airDateUtc: "2026-09-29T12:00:00Z",
      runtime: 2,
    }))
  );
  state.query.mockImplementation(
    async (_queries: unknown, _size: number, options: MediathekQueryOptions) => {
      options.requestBudget!.takeAttempt();
      return Array.from({ length: 80 }, (_, index) => ({
        channel: "ARD",
        topic: "Synthetic 1",
        title: `Boundary ${index + 1}`,
        description: "",
        filmlisteTimestamp: now / 1000,
        duration: 120,
        size: 123,
        url_video: `https://example.invalid/media-${index}.mp4`,
        url_video_hd: "",
        url_video_low: "",
        url_website: "https://example.invalid/episode",
      }));
    }
  );
  const matches = await getSonarrRssMatches(base);
  expect(matches).toHaveLength(50);
  expect(Math.max(...matches.map((match) => match.episode.episodeNumber))).toBe(50);
  expect(state.query).toHaveBeenCalledTimes(1);
});
