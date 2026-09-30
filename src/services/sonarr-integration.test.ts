import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import type { ApiResultItem, Ruleset } from "@/types";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  addToQueue: vi.fn(),
  rulesets: [] as Ruleset[],
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        state.settings.has(where.key) ? { value: state.settings.get(where.key) } : null
      ),
      findMany: vi.fn(async () => []),
    },
  },
}));
vi.mock("./rulesets", () => ({
  getRulesetContext: () => "synthetic-rules",
  ensureRulesetsLoaded: async () => {},
  getAllTopics: () => state.rulesets.map((ruleset) => ruleset.topic),
  getRulesetsForTopic: (topic: string) =>
    state.rulesets.filter((ruleset) => ruleset.topic === topic),
  getRulesetsForTopicAndTvdbId: (topic: string, tvdbId: number) =>
    state.rulesets.filter(
      (ruleset) => ruleset.topic === topic && ruleset.media.media_tvdbId === tvdbId
    ),
  getOrGenerateRulesetForShow: async () => null,
}));
vi.mock("./download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./download")>()),
  addToQueue: state.addToQueue,
}));
import { GET } from "@/app/api/newznab/route";
import { GET as downloadNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { POST as addfile } from "@/app/api/route";
import { parseNzbContent } from "./download";
import { clearMetadataCaches, mediathekCache } from "@/lib/cache";
import { clearSettingsCache } from "@/lib/settings";

let fetchMock: ReturnType<typeof vi.fn<(value: string) => Promise<Response>>>;
const source: ApiResultItem = {
  channel: "ARD",
  topic: "Synthetic series",
  title: "Missing episode",
  description: "Synthetic short episode",
  filmlisteTimestamp: Date.now() / 1000,
  duration: 120,
  size: 123456,
  url_video: "https://example.invalid/media.mp4?token=synthetic-expiring",
  url_video_low: "",
  url_video_hd: "",
  url_website: "https://example.invalid/episode",
};

beforeEach(() => {
  clearMetadataCaches();
  mediathekCache.clear();
  clearSettingsCache();
  state.settings.clear();
  state.rulesets = [];
  state.settings.set("integration.sonarr.enabled", "true");
  state.settings.set("integration.sonarr.url", "https://example.invalid/sonarr");
  state.settings.set("download.quality", "720p");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-integration-key");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  state.addToQueue.mockReset();
  state.addToQueue.mockResolvedValue({ id: "synthetic-job" });
  fetchMock = vi.fn(async (value: string) => {
    const url = new URL(value);
    if (url.hostname === "raw.githubusercontent.com")
      return Response.json([
        {
          tvdbId: 123,
          name: "Synthetic series",
          germanName: "Synthetic series",
          aliases: [],
          episodes: [
            {
              name: "Existing episode",
              seasonNumber: 1,
              episodeNumber: 1,
              aired: "2026-01-01T12:00:00Z",
              runtime: 40,
            },
          ],
        },
      ]);
    if (url.pathname.endsWith("/system/status")) return Response.json({ version: "4.0.16.2944" });
    if (url.pathname.endsWith("/series"))
      return Response.json([{ id: 12, tvdbId: 123, title: "Synthetic series", monitored: true }]);
    if (url.pathname.endsWith("/episode"))
      return Response.json([
        {
          id: 45,
          seriesId: 12,
          seasonNumber: 2,
          episodeNumber: 3,
          title: "Missing episode",
          airDateUtc: new Date(Date.now() - 3600_000).toISOString(),
          runtime: 2,
        },
      ]);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({
        result: {
          results: [
            source,
            {
              ...source,
              topic: "Foreign series",
              url_video: "https://example.invalid/foreign.mp4",
            },
            {
              ...source,
              title: "Missing episode Trailer",
              url_video: "https://example.invalid/trailer.mp4",
            },
          ],
        },
        err: null,
      });
    throw new Error("Unexpected synthetic request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearSettingsCache();
  clearMetadataCaches();
  mediathekCache.clear();
});

it("supplements a local missing episode and round-trips exact, season and RSS through NZB to the queue API", async () => {
  for (const query of [
    "t=tvsearch&tvdbid=123&season=2&ep=3",
    "t=tvsearch&tvdbid=123&season=2",
    "t=tvsearch&cat=5000",
  ]) {
    const response = await GET(
      new NextRequest(`http://localhost/api/newznab?${query}&limit=1&offset=0`)
    );
    expect(response.status).toBe(200);
    const parsed = await parseStringPromise(await response.text());
    const channel = parsed.rss.channel[0];
    expect(channel["newznab:response"][0].$).toEqual({ offset: "0", total: "1" });
    const release = channel.item[0];
    expect(release.title[0]).toContain("S02E03");
    expect(release.title[0]).not.toContain("GERMAN");
    expect(release.link[0]).toBe(source.url_video);
    const enclosure = release.enclosure[0].$.url;
    const nzbResponse = await downloadNzb(new NextRequest(new URL(enclosure, "http://localhost")));
    expect(nzbResponse.status).toBe(200);
    const nzb = await nzbResponse.text();
    expect(parseNzbContent(nzb)).toEqual({ title: release.title[0], url: source.url_video });
    expect(
      (
        await addfile(
          new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
            method: "POST",
            body: nzb,
          })
        )
      ).status
    ).toBe(200);
    expect(state.addToQueue).toHaveBeenLastCalledWith(source.url_video, release.title[0], "sonarr");
  }
  const episodeCalls = fetchMock.mock.calls.filter(([url]) =>
    String(url).includes("api/v3/episode")
  );
  expect(episodeCalls).toHaveLength(1);
  const beforePage = fetchMock.mock.calls.length;
  const page = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&cat=5000&limit=1&offset=1")
  );
  const parsed = await parseStringPromise(await page.text());
  expect(parsed.rss.channel[0]["newznab:response"][0].$).toEqual({ offset: "1", total: "1" });
  expect(parsed.rss.channel[0].item).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(beforePage);
});

it("does not republish a verified Sonarr episode as an unknown candidate or requested neighbor", async () => {
  state.settings.set("matching.minDuration", "0");
  const own = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=2&ep=3")
  );
  expect(await own.text()).toContain('total="1"');
  const neighbor = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=1&ep=1")
  );
  expect(await neighbor.text()).toContain('total="0"');
});

it("does not turn an unavailable missing episode into a cached empty HTTP success", async () => {
  fetchMock.mockImplementation(async (value: string) => {
    if (new URL(value).pathname.endsWith("/system/status"))
      return new Response("private upstream payload", { status: 401 });
    return Response.json([
      {
        tvdbId: 123,
        name: "Synthetic series",
        germanName: "Synthetic series",
        aliases: [],
        episodes: [
          {
            name: "Existing episode",
            seasonNumber: 1,
            episodeNumber: 1,
            aired: "2026-01-01T12:00:00Z",
            runtime: 40,
          },
        ],
      },
    ]);
  });
  const response = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=2&ep=3")
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private upstream payload");
});

it("retains independently verified exact and RSS base hits during a Sonarr outage", async () => {
  state.rulesets = [
    {
      id: 1,
      mediaId: 1,
      topic: "Synthetic series",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "^(.*)$" }]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: "ItemTitleExact" as Ruleset["matchingStrategy"],
      media: {
        media_id: 1,
        media_name: "Synthetic series",
        media_type: "tv",
        media_tvdbId: 123,
        media_tmdbId: null,
        media_imdbId: null,
      },
    },
  ];
  const independent = { ...source, title: "Existing episode", duration: 2400 };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/system/status")) return new Response(null, { status: 401 });
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({ result: { results: [independent] }, err: null });
    return original(value);
  });
  for (const query of ["t=tvsearch&tvdbid=123&season=1&ep=1", "t=tvsearch&cat=5000"]) {
    const response = await GET(new NextRequest(`http://localhost/api/newznab?${query}`));
    expect(response.status).toBe(200);
    const rss = await response.text();
    expect(rss).toContain("S01E01");
    expect(rss).not.toContain("S02E03");
  }
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v3/episode"))
  ).toHaveLength(0);
});
