import { expect, it, vi } from "vitest";
import { DEFAULT_LANGUAGE_POLICY } from "@/lib/language-policy";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";
import { sourceMediaFacts } from "./source-media-facts";
import { tvSearchDelivery, getTvSearchDeliveryItems } from "./tv-search-delivery";
import { mergeSonarrShow } from "./sonarr-provider";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { enrichTvMatches } from "./source-audio";
import { generateRssItems } from "./newznab";

const state = vi.hoisted(() => ({
  value: null as string | null,
  epoch: 0,
  enabled: true,
  scope: "a".repeat(64),
  episodes: [] as Array<{
    sonarrId: number;
    seriesId: number;
    seasonNumber: number;
    episodeNumber: number;
    title: string;
    aired: Date;
    expectedRuntimeSeconds: number;
    monitored: boolean;
    hasFile: boolean;
  }>,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: async () => (state.value === null ? null : { value: state.value }),
      upsert: async ({ update }: { update: { value: string } }) => {
        state.value = update.value;
      },
    },
  },
}));
vi.mock("@/lib/cache", () => ({ cacheContextEpoch: () => state.epoch }));
vi.mock("@/lib/settings", () => ({
  getMinDurationSeconds: async () => 0,
  getSetting: async (key: string) => (key === "matching.sonarr.tolerancePercent" ? "15" : null),
}));
vi.mock("./rulesets", () => ({ getRulesetContext: () => "synthetic-rules" }));
vi.mock("./tv-search-terms", () => ({ verifiedRuleTopics: () => [] }));
vi.mock("./content-search", () => ({
  getConfiguredLanguagePolicy: async () => DEFAULT_LANGUAGE_POLICY,
}));
vi.mock("./sonarr-provider", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sonarr-provider")>();
  return {
    ...actual,
    openSonarrSession: async () =>
      state.enabled
        ? {
            cacheIdentity: `${state.scope}-${state.epoch}`,
            deliveryIdentity: state.scope,
            inventory: async () => [
              { sonarrId: 1, tvdbId: 123, title: "Synthetic Series", monitored: true },
            ],
            episodes: async () => ({
              series: { sonarrId: 1, tvdbId: 123, title: "Synthetic Series", monitored: true },
              episodes: state.episodes,
            }),
          }
        : null,
  };
});

it("delivers old cold discoveries only with fresh complete proof/current monitoring, preserving GUIDs and readiness dates", async () => {
  vi.useFakeTimers();
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const response = mp4RangeResponse(syntheticMp4(), init);
    response.headers.set("etag", '"synthetic"');
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  try {
    state.episodes = Array.from({ length: 45 }, (_, i) => ({
      sonarrId: i + 1,
      seriesId: 1,
      seasonNumber: 1,
      episodeNumber: i + 1,
      title: `Synthetic Episode ${i + 1}`,
      aired: new Date("2019-01-01T20:00:00Z"),
      expectedRuntimeSeconds: 600,
      monitored: true,
      hasFile: false,
    }));
    const show = mergeSonarrShow(null, {
      series: { sonarrId: 1, tvdbId: 123, title: "Synthetic Series", monitored: true },
      episodes: state.episodes,
    })!;
    const candidates = state.episodes.map((e) => ({
      channel: "ZDF",
      topic: "Synthetic Series",
      title: `Localized Source (S01E${String(e.episodeNumber).padStart(2, "0")})`,
      duration: 600,
      size: 0,
      description: "Owned synthetic source",
      filmlisteTimestamp: 1546387200,
      url_website: `https://example.invalid/${e.episodeNumber}`,
      url_video: "",
      url_video_low: "",
      url_video_hd: `https://rodlzdf-a.akamaihd.net/synthetic/episode-${e.episodeNumber}.mp4`,
    }));
    const matches = matchSonarrEpisodes(
      show,
      candidates,
      0,
      15,
      DEFAULT_LANGUAGE_POLICY,
      false,
      true
    );
    expect(matches).toHaveLength(45);
    await tvSearchDelivery.register(state.scope, show, matches);
    const feed = () =>
      getTvSearchDeliveryItems(async () => null, new HttpRequestBudget(), "best", false);
    expect(await feed()).toEqual([]); // This successful cold request is not an ACK.
    await vi.advanceTimersByTimeAsync(100_000);
    await sourceMediaFacts.idle();
    await tvSearchDelivery.idle();
    const ready = await feed();
    expect(ready).toHaveLength(45);
    expect(
      ready.every((item) => item.title.includes(".GERMAN.") && item.title.includes("1080p"))
    ).toBe(true);
    expect(
      ready.every((item) => Date.parse(item.pubDate) > Date.parse("2019-01-01T00:00:00Z"))
    ).toBe(true);
    const normal = (
      await enrichTvMatches(
        matches,
        new HttpRequestBudget(32),
        DEFAULT_LANGUAGE_POLICY,
        "best",
        false
      )
    ).flatMap((info) => generateRssItems(info, "best", false));
    expect(new Set(ready.map((item) => item.guid.value))).toEqual(
      new Set(normal.map((item) => item.guid.value))
    );
    expect(await feed()).toEqual(ready);
    state.episodes[0].hasFile = true;
    state.episodes[1].monitored = false;
    state.episodes[2].expectedRuntimeSeconds = 900; // Runtime conflict must not be silently waived.
    state.epoch++;
    expect(await feed()).toHaveLength(42);
    expect((await tvSearchDelivery.current(state.scope)).some((e) => e.episode < 3)).toBe(false);
    state.scope = "b".repeat(64);
    state.epoch++;
    expect(await feed()).toEqual([]); // New credentials/instance cannot consume old discovery.
    state.scope = "a".repeat(64);
    state.enabled = false;
    state.epoch++;
    expect(await feed()).toEqual([]);
    state.enabled = true;
    state.epoch++;
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
    expect(await feed()).toEqual([]);
  } finally {
    tvSearchDelivery.dispose();
    sourceMediaFacts.clear();
    await sourceMediaFacts.idle();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
