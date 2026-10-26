import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import catalogue from "../../data/shows.json";
import type { ApiResultItem, Ruleset, TvdbData } from "@/types";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  rules: [] as Ruleset[],
  tvdb: vi.fn<() => Promise<TvdbData | null>>(),
  tmdb: vi.fn<() => Promise<TvdbData | null>>(),
  forbiddenWrite: vi.fn(() => {
    throw new Error("Catalogue checks must not write or enqueue");
  }),
}));
vi.mock("./tvdb", async (original) => ({
  ...(await original<typeof import("./tvdb")>()),
  getShowInfoByTvdbId: state.tvdb,
}));
vi.mock("./tmdb", async (original) => ({
  ...(await original<typeof import("./tmdb")>()),
  getShowInfoByTvdbId: state.tmdb,
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        state.settings.has(where.key) ? { value: state.settings.get(where.key) } : null
      ),
      findMany: vi.fn(async () => [...state.settings].map(([key, value]) => ({ key, value }))),
      upsert: state.forbiddenWrite,
    },
    download: new Proxy({}, { get: () => state.forbiddenWrite }),
  },
}));
vi.mock("./rulesets", () => ({
  getRulesetContext: () => "synthetic-catalogue-rules",
  ensureRulesetsLoaded: async () => {},
  getAllTopics: () => state.rules.map((rule) => rule.topic),
  getRulesetsForTopic: (topic: string) => state.rules.filter((rule) => rule.topic === topic),
  getRulesetsForTopicAndTvdbId: (topic: string, tvdbId: number) =>
    state.rules.filter((rule) => rule.topic === topic && rule.media.media_tvdbId === tvdbId),
  getOrGenerateRulesetForShow: async () => null,
}));

import { GET } from "@/app/api/newznab/route";
import { GET as search } from "@/app/api/search/route";
import { clearMetadataCaches, mediathekCache } from "@/lib/cache";
import { clearSettingsCache } from "@/lib/settings";
import { getShowInfoByTvdbId } from "./shows";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { mergeSonarrShow } from "./sonarr-provider";
import { sourceMediaFacts } from "./source-media-facts";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const series = catalogue.find((show) => show.tvdbId === 258535)!;
const episodes = [
  { name: "Entgleist", seasonNumber: 7, episodeNumber: 4, aired: "2018-03-16", runtime: 45 },
  { name: "Lebensretterin", seasonNumber: 7, episodeNumber: 6, aired: "2018-03-23", runtime: 45 },
];
// Only public catalogue metadata is real. Instance IDs, credentials, media and
// responses are synthetic; all HTTP terminates in this mock, never in Sonarr.
const sonarrEpisodes = episodes.map((episode, index) => ({
  id: 101 + index,
  seriesId: 12,
  seasonNumber: episode.seasonNumber,
  episodeNumber: episode.episodeNumber,
  title: "TBA",
  airDateUtc: `${episode.aired}T20:15:00Z`,
  runtime: 45,
  hasFile: true,
  monitored: true,
}));
const sources: ApiResultItem[] = episodes.map((episode, index) => ({
  topic: "Letzte Spur Berlin",
  channel: "ZDF",
  title: episode.name,
  description: "Synthetic catalogue source, not a library response",
  filmlisteTimestamp: 1_700_000_000,
  duration: 2622 - index,
  size: 123456,
  url_video: `https://example.invalid/catalogue-${index}.mp4`,
  url_video_low: "",
  url_video_hd: "",
  url_website: `https://example.invalid/programme-${index}`,
}));
let fallback = false;
let extraSources: ApiResultItem[] = [];
let fetchMock: ReturnType<typeof vi.fn>;
let catalogueClock = Date.now();

beforeEach(() => {
  // The real catalogue owner refreshes hourly; each case must exercise its
  // loader instead of inheriting the previous case's module-local catalogue.
  catalogueClock += 3_600_001;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(catalogueClock);
  clearMetadataCaches();
  mediathekCache.clear();
  clearSettingsCache();
  state.settings.clear();
  state.settings.set("integration.sonarr.enabled", "true");
  state.settings.set("integration.sonarr.url", "https://example.invalid/sonarr");
  state.settings.set("download.quality", "720p");
  state.forbiddenWrite.mockClear();
  state.rules = [];
  state.tvdb.mockReset().mockResolvedValue(null);
  state.tmdb.mockReset().mockResolvedValue(null);
  fallback = false;
  extraSources = [];
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-catalogue-key");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  // This is an isolated read-only check, not a production maintenance change.
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "raw.githubusercontent.com")
      return fallback ? new Response(null, { status: 404 }) : Response.json(catalogue);
    if (url.hostname === "example.invalid" && url.pathname.endsWith("/system/status"))
      return Response.json({ version: "4.0.20.3014" });
    if (url.hostname === "example.invalid" && url.pathname.endsWith("/series"))
      return Response.json([{ id: 12, tvdbId: 258535, title: series.name, monitored: true }]);
    if (url.hostname === "example.invalid" && url.pathname.endsWith("/episode"))
      return Response.json(sonarrEpisodes);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({ result: { results: [...sources, ...extraSources] }, err: null });
    throw new Error(`Unexpected synthetic catalogue request: ${init?.method ?? "GET"}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});

it.each([
  ["tvdb", false],
  ["tvdb", true],
  ["tmdb", false],
  ["tmdb", true],
] as const)(
  "preserves %s episodes outside the partial catalogue without Sonarr, local fallback=%s",
  async (provider, localFallback) => {
    fallback = localFallback;
    state.settings.set("integration.sonarr.enabled", "false");
    state.settings.set(`api.${provider}.key`, provider === "tmdb" ? "eyJsynthetic" : "synthetic");
    const additional = {
      name: "Synthetic additional episode",
      seasonNumber: 7,
      episodeNumber: 8,
      aired: new Date("2018-04-06"),
      runtime: 45,
    };
    const metadata: TvdbData = {
      id: 258535,
      name: series.name,
      germanName: series.germanName,
      aliases: [],
      episodes: [{ ...additional, name: "Synthetic provider title", episodeNumber: 4 }, additional],
    };
    const original = structuredClone(metadata);
    state[provider].mockResolvedValue(metadata);
    state.rules = [
      {
        id: 1,
        mediaId: 1,
        topic: series.name,
        priority: 1,
        filters: "[]",
        titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "^(.+)$" }]),
        episodeRegex: null,
        seasonRegex: null,
        matchingStrategy: "ItemTitleExact" as Ruleset["matchingStrategy"],
        media: {
          media_id: 1,
          media_name: series.name,
          media_type: "tv",
          media_tvdbId: 258535,
          media_tmdbId: null,
          media_imdbId: null,
        },
      },
    ];
    extraSources = [{ ...sources[0], title: additional.name, duration: 2700 }];
    const show = await getShowInfoByTvdbId(258535);
    expect(show?.episodes).toHaveLength(3);
    expect(show?.episodes.find((episode) => episode.episodeNumber === 4)?.name).toBe("Entgleist");
    expect(show?.episodes.find((episode) => episode.episodeNumber === 8)).toEqual(additional);
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=258535&season=7&ep=8")
    );
    expect(response.status).toBe(200);
    const channel = (await parseStringPromise(await response.text())).rss.channel[0];
    expect(channel.item).toHaveLength(1);
    expect(channel.item[0].title[0]).toContain("S07E08");
    expect(channel.item[0].title[0]).toContain("Synthetic.additional.episode");
    expect(metadata).toEqual(original);
    expect(state.forbiddenWrite).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([input]) => new URL(input).pathname.startsWith("/sonarr/"))
    ).toBe(false);
  }
);

it("keeps independent catalogue episodes usable if configured providers fail", async () => {
  state.settings.set("integration.sonarr.enabled", "false");
  state.settings.set("api.tvdb.key", "synthetic");
  state.settings.set("api.tmdb.key", "eyJsynthetic");
  state.tvdb.mockRejectedValue(new Error("Synthetic provider outage"));
  state.tmdb.mockRejectedValue(new Error("Synthetic provider outage"));
  const show = await getShowInfoByTvdbId(258535, new HttpRequestBudget(32));
  expect(show?.episodes).toEqual(
    episodes.map(({ aired, ...episode }) => ({ ...episode, aired: new Date(aired) }))
  );
  expect(state.tvdb).toHaveBeenCalled();
  expect(state.tmdb).toHaveBeenCalled();
  expect(state.forbiddenWrite).not.toHaveBeenCalled();
});

afterEach(async () => {
  sourceMediaFacts.clear();
  await sourceMediaFacts.idle();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  clearSettingsCache();
  clearMetadataCaches();
  mediathekCache.clear();
});

it("contains exactly the two evidenced coordinates with minute-based reference durations", () => {
  expect(catalogue.filter((show) => show.tvdbId === 258535)).toHaveLength(1);
  expect(series).toMatchObject({ name: "Letzte Spur Berlin", germanName: "Letzte Spur Berlin" });
  expect(series.episodes).toEqual(episodes);
});

it.each([false, true])(
  "loads the actual catalogue into exact/season Newznab and GUI review with local fallback=%s",
  async (localFallback) => {
    fallback = localFallback;
    const show = await getShowInfoByTvdbId(258535, new HttpRequestBudget(32));
    expect(
      fetchMock.mock.calls.filter(
        ([input]) => new URL(input).hostname === "raw.githubusercontent.com"
      )
    ).toHaveLength(1);
    expect(show?.episodes).toEqual(
      episodes.map(({ aired, ...episode }) => ({ ...episode, aired: new Date(aired) }))
    );
    expect(sonarrEpisodes.map((episode) => episode.title)).toEqual(["TBA", "TBA"]);
    for (const episode of episodes) {
      const response = await GET(
        new NextRequest(
          `http://localhost/api/newznab?t=tvsearch&tvdbid=258535&season=7&ep=${episode.episodeNumber}`
        )
      );
      expect(response.status).toBe(200);
      const channel = (await parseStringPromise(await response.text())).rss.channel[0];
      const items = channel.item.filter((item: { title: string[] }) =>
        item.title[0].includes(`S07E0${episode.episodeNumber}`)
      );
      expect(items).toHaveLength(1);
      expect(channel.item).toHaveLength(1);
      expect(items[0].title[0]).toContain(episode.name);
      expect(items[0]["newznab:attr"]).toEqual(
        expect.arrayContaining([
          { $: { name: "tvdbid", value: "258535" } },
          { $: { name: "season", value: "07" } },
        ])
      );
      expect(items[0].title[0]).not.toContain("TBA");
    }
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=258535&season=7")
    );
    const channel = (await parseStringPromise(await response.text())).rss.channel[0];
    expect(channel.item).toHaveLength(2);
    expect(channel["newznab:response"][0].$).toEqual({ offset: "0", total: "2" });
    const review = await search(
      new NextRequest("http://localhost/api/search?q=Letzte%20Spur%20Berlin&type=series")
    );
    expect(review.status).toBe(200);
    expect((await review.json()).results).toEqual(
      episodes.map((episode, index) =>
        expect.objectContaining({
          title: episode.name,
          tvReview: expect.objectContaining({
            selector: expect.objectContaining({
              tvdbId: 258535,
              season: 7,
              episode: episode.episodeNumber,
            }),
            metadataSeconds: 2700,
            sourceSeconds: sources[index].duration,
            runtimeConflict: false,
          }),
        })
      )
    );
    expect(sonarrEpisodes.map((episode) => episode.title)).toEqual(["TBA", "TBA"]);
    expect(state.forbiddenWrite).not.toHaveBeenCalled();
    const arrRequests = fetchMock.mock.calls.filter(([input]) =>
      new URL(input).pathname.startsWith("/sonarr/")
    );
    expect(arrRequests.length).toBeGreaterThan(0);
    expect(arrRequests.every(([, init]) => !init?.method || init.method === "GET")).toBe(true);
  }
);

it("fails causally without the catalogue titles, without guessing from equal runtimes", async () => {
  const show = (await getShowInfoByTvdbId(258535))!;
  expect(matchSonarrEpisodes(show, sources, 300, 10)).toHaveLength(2);
  const missing = structuredClone(show);
  missing.episodes = missing.episodes.map((episode) => ({ ...episode, name: "TBA" }));
  expect(matchSonarrEpisodes(missing, sources, 300, 10)).toEqual([]);
});

it("keeps foreign topics, foreign source seasons and wrong durations rejected", async () => {
  const show = (await getShowInfoByTvdbId(258535))!;
  for (const changes of [
    { topic: "Foreign synthetic series" },
    { title: "Entgleist (S08/E04)" },
    { duration: 5400 },
  ])
    expect(matchSonarrEpisodes(show, [{ ...sources[0], ...changes }], 300, 10)).toEqual([]);
});

it("preserves Sonarr supplements and rejects a concrete metadata contradiction", async () => {
  const base = (await getShowInfoByTvdbId(258535))!;
  const extra = {
    sonarrId: 103,
    seriesId: 12,
    seasonNumber: 7,
    episodeNumber: 8,
    title: "Synthetic additional episode",
    aired: null,
    expectedRuntimeSeconds: 2700,
    monitored: true,
    hasFile: false,
  };
  const merged = mergeSonarrShow(base, {
    series: { sonarrId: 12, tvdbId: 258535, title: series.name, monitored: true },
    episodes: [
      extra,
      { ...extra, episodeNumber: 4, title: "Contradictory synthetic title" },
      { ...extra, sonarrId: 105, episodeNumber: 6, title: "TBA" },
    ],
  })!;
  expect(merged.episodes).toHaveLength(3);
  expect(merged.episodes[0].name).toBe("Entgleist");
  expect(merged.sonarrBlockedCoordinates).toContain("7:4");
  expect(
    matchSonarrEpisodes(merged, sources, 300, 10).map((match) => match.episode.episodeNumber)
  ).toEqual([6]);
});

it("retains a newly bundled 97-episode identity before the default remote catalogue catches up", async () => {
  state.settings.set("integration.sonarr.enabled", "false");
  fetchMock.mockResolvedValueOnce(
    Response.json(catalogue.filter((show) => show.tvdbId !== 133771))
  );
  const show = await getShowInfoByTvdbId(133771);
  expect(show?.id).toBe(133771);
  expect(show?.episodes).toHaveLength(97);
  expect(fetchMock.mock.calls[0][0]).toContain("/superions/pingufunk/");
  expect(state.forbiddenWrite).not.toHaveBeenCalled();
});
it("fills only unknown curated facts from the same concrete provider episode identity", async () => {
  state.settings.set("integration.sonarr.enabled", "false");
  state.settings.set("api.tvdb.key", "synthetic");
  const reference = catalogue.find((show) => show.tvdbId === 133771)!;
  state.tvdb.mockResolvedValue({
    id: 133771,
    name: reference.name,
    germanName: reference.germanName,
    aliases: [],
    episodes: [
      { ...reference.episodes[0], aired: new Date("1969-01-03"), runtime: 60 },
      {
        ...reference.episodes[1],
        name: "Wrong synthetic order",
        aired: new Date("1969-01-10"),
        runtime: 20,
      },
    ],
  });
  const show = await getShowInfoByTvdbId(133771);
  expect(show?.episodes).toHaveLength(97);
  expect(show?.episodes[0].runtime).toBe(60);
  expect(show?.episodes[1].name).toBe(reference.episodes[1].name);
  expect(show?.episodes[1].runtime).toBeNull();
});
it("honors an explicit remote pin and still uses an independent configured provider with Sonarr off", async () => {
  vi.stubEnv("SHOWS_URL", "https://example.invalid/pinned-catalogue.json");
  vi.resetModules();
  state.settings.set("integration.sonarr.enabled", "false");
  fetchMock.mockResolvedValueOnce(Response.json([]));
  const owner = await import("./shows");
  expect(await owner.getShowInfoByTvdbId(133771)).toBeNull();
  expect(fetchMock.mock.calls[0][0]).toBe("https://example.invalid/pinned-catalogue.json");
  state.settings.set("api.tvdb.key", "synthetic");
  const { clearSettingsCache } = await import("@/lib/settings");
  clearSettingsCache();
  state.tvdb.mockResolvedValue({
    id: 133771,
    name: "Der Kommissar",
    germanName: "Der Kommissar",
    aliases: [],
    episodes: [
      {
        name: "Synthetic provider episode",
        seasonNumber: 1,
        episodeNumber: 1,
        aired: null,
        runtime: 60,
      },
    ],
  });
  expect((await owner.getShowInfoByTvdbId(133771))?.episodes).toHaveLength(1);
  expect(state.forbiddenWrite).not.toHaveBeenCalled();
});
