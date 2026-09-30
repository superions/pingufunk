import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import type { ApiResultItem } from "@/types";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  addToQueue: vi.fn(),
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
  getAllTopics: () => [],
  getRulesetsForTopic: () => [],
  getRulesetsForTopicAndTvdbId: () => [],
  getOrGenerateRulesetForShow: async () => null,
}));
vi.mock("./download", async (original) => ({
  ...(await original<typeof import("./download")>()),
  addToQueue: state.addToQueue,
}));
import { GET } from "@/app/api/newznab/route";
import { GET as alias } from "@/app/api/newznab/api/route";
import { GET as downloadNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { POST as addfile } from "@/app/api/route";
import { parseNzbContent } from "./download";
import { clearMetadataCaches, mediathekCache } from "@/lib/cache";
import { clearSettingsCache } from "@/lib/settings";

const movie = {
  tmdbId: 42,
  imdbId: "tt0000042",
  title: "Beispielfilm",
  originalTitle: "Original Film",
  year: 1998,
  runtime: 90,
  monitored: true,
  alternateTitles: [],
};
const source: ApiResultItem = {
  channel: "Synthetic Channel",
  topic: "Filmreihe",
  title: "Beispielfilm",
  description: "Synthetic source without film IDs or language proof",
  filmlisteTimestamp: 1_700_000_000,
  duration: 5400,
  size: 1_000_000_000,
  url_video: "https://example.invalid/film.mp4?token=synthetic",
  url_video_hd: "https://example.invalid/film-hd.mp4",
  url_video_low: "",
  url_website: "https://example.invalid/film",
};
let rows: ApiResultItem[];
let inventory: unknown[];
let sourceFails: boolean;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearMetadataCaches();
  mediathekCache.clear();
  clearSettingsCache();
  state.settings.clear();
  state.settings.set("integration.radarr.enabled", "true");
  state.settings.set("integration.radarr.url", "https://example.invalid/radarr");
  state.settings.set("download.quality", "720p");
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY", "synthetic-integration-key");
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY_FILE", undefined);
  state.addToQueue.mockReset();
  state.addToQueue.mockResolvedValue({ id: "synthetic-job" });
  inventory = [movie];
  rows = [
    source,
    { ...source, title: "Foreign Film", url_video: "https://example.invalid/foreign.mp4" },
  ];
  sourceFails = false;
  fetchMock = vi.fn(async (value: string, init?: RequestInit) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/system/status")) return Response.json({ version: "6.0.0" });
    if (url.pathname.endsWith("/movie")) return Response.json(inventory);
    if (url.pathname.endsWith("/movie/lookup/tmdb")) return Response.json(movie);
    if (url.hostname === "mediathekviewweb.de") {
      const offset = JSON.parse(String(init?.body)).offset;
      if (sourceFails && offset > 0) return new Response(null, { status: 503 });
      return Response.json({ result: { results: rows }, err: null });
    }
    throw new Error("Unexpected synthetic request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["movie", "search&cat=2000"])(
  "publishes real monitored source candidates for RSS: %s",
  async (type) => {
    const response = await GET(new NextRequest("http://localhost/api/newznab?t=" + type));
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toContain('total="1"');
    expect(body).toContain("Filmreihe.Beispielfilm");
    expect(body).toContain('name="category" value="2000"');
    expect(body).not.toMatch(/name="(?:tmdbid|imdbid)"|GERMAN|Foreign.Film|Indexer.Test/);
    expect(body).not.toContain(".1998.");
    expect(
      fetchMock.mock.calls
        .filter(([url]) => String(url).includes("/radarr/"))
        .every(([, init]) => init.method === "GET")
    ).toBe(true);
  }
);

it("returns empty RSS without a configured film context, with no secret or network use", async () => {
  state.settings.set("integration.radarr.enabled", "false");
  const response = await GET(new NextRequest("http://localhost/api/newznab?t=movie&offset=7"));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('offset="7" total="0"');
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not announce unmonitored movies", async () => {
  inventory = [{ ...movie, monitored: false }];
  const response = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  expect(await response.text()).toContain('total="0"');
  expect(fetchMock.mock.calls.some(([url]) => String(url).includes("mediathekviewweb"))).toBe(
    false
  );
});

it("uses identical source GUIDs and URLs for ID search, direct RSS, forwarding and NZB consumption", async () => {
  const rssResponse = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  const forwarded = await alias(new NextRequest("http://localhost/api/newznab/api?t=movie"));
  const rss = await rssResponse.text();
  expect(await forwarded.text()).toBe(rss);
  const targeted = await GET(new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42"));
  const parsed = await parseStringPromise(rss);
  const release = parsed.rss.channel[0].item[0];
  const searchRelease = (await parseStringPromise(await targeted.text())).rss.channel[0].item[0];
  expect(searchRelease.guid).toEqual(release.guid);
  const nzb = await downloadNzb(
    new NextRequest(new URL(release.enclosure[0].$.url, "http://localhost"))
  );
  const content = await nzb.text();
  expect(parseNzbContent(content)).toEqual({ title: release.title[0], url: source.url_video });
  const queue = await addfile(
    new NextRequest("http://localhost/api?mode=addfile&cat=movies", {
      method: "POST",
      body: content,
    })
  );
  expect(queue.status).toBe(200);
  expect(state.addToQueue).toHaveBeenCalledWith(source.url_video, release.title[0], "movies");
});

it("selects renditions before total and pagination", async () => {
  state.settings.set("download.quality", "all");
  const first = await GET(new NextRequest("http://localhost/api/newznab?t=movie&limit=1&offset=0"));
  const second = await GET(
    new NextRequest("http://localhost/api/newznab?t=movie&limit=1&offset=1")
  );
  expect(await first.text()).toContain('offset="0" total="2"');
  expect(await second.text()).toContain('offset="1" total="2"');
});

it("rejects an incomplete Recent source window without caching its first page", async () => {
  rows = Array.from({ length: 1000 }, () => source);
  sourceFails = true;
  const failed = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  expect(failed.status).toBe(503);
  rows = [];
  sourceFails = false;
  const recovered = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  expect(recovered.status).toBe(200);
  expect(await recovered.text()).toContain('total="0"');
});
