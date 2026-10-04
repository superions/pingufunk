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
import { generateGenericRssItems } from "./newznab";
import * as movieMatcher from "./movie-matcher";
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
    if (url.pathname.endsWith("/movie"))
      return Response.json(url.searchParams.has("tmdbId") ? [movie] : inventory);
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
    expect(body).toContain("Beispielfilm.1998.UNKNOWN.h264");
    expect(body).toContain('name="category" value="2000"');
    expect(body).toContain('name="tmdbid" value="42"');
    expect(body).toContain('name="imdbid" value="tt0000042"');
    expect(body).not.toMatch(/GERMAN|Foreign.Film|Indexer.Test/);
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

it.each([
  [4860, "Beispielfilm (1997)", true],
  [5940, "Beispielfilm (1999)", true],
  [4859, "Beispielfilm", false],
  [5941, "Beispielfilm", false],
  [5400, "Beispielfilm (1996)", false],
  [5400, "Beispielfilm (2000)", false],
])(
  "applies inclusive runtime/year proof identically to targeted and RSS releases: %s/%s",
  async (duration, title, verified) => {
    rows = [{ ...source, duration, title }];
    for (const query of ["t=movie", "t=movie&tmdbid=42", "t=movie&tmdbid=42&year=1999"]) {
      const response = await GET(new NextRequest(`http://localhost/api/newznab?${query}`));
      expect(response.status).toBe(200);
      const body = await response.text();
      expect(body.includes('name="tmdbid" value="42"')).toBe(verified);
      expect(body.includes("Beispielfilm.1998.UNKNOWN.h264")).toBe(verified);
      expect(body).not.toContain("GERMAN");
    }
  }
);

it("does not enrich same-title same-runtime remakes by library ordering", async () => {
  inventory = [movie, { ...movie, tmdbId: 43, imdbId: "tt0000043", year: 2025 }];
  rows = [source];
  const response = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  const body = await response.text();
  expect(body).toContain("Filmreihe.Beispielfilm");
  expect(body).not.toMatch(/name="(?:tmdbid|imdbid)"/);
});

it("does not rescan all source videos for every nonmatching film in a large RSS library", async () => {
  inventory = [
    ...Array.from({ length: 1000 }, (_, index) => ({
      ...movie,
      tmdbId: 1000 + index,
      title: `Other Film ${index}`,
      originalTitle: `Other Film ${index}`,
    })),
    movie,
  ];
  const matcher = vi.spyOn(movieMatcher, "matchMovieItems");
  try {
    const response = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Beispielfilm.1998.UNKNOWN.h264");
    expect(matcher).toHaveBeenCalledTimes(1);
    expect(matcher.mock.calls[0][0]).toEqual([source]);
  } finally {
    matcher.mockRestore();
  }
});

it("uses identical source GUIDs and URLs for ID search, direct RSS, forwarding and NZB consumption", async () => {
  const rssResponse = await GET(new NextRequest("http://localhost/api/newznab?t=movie"));
  const forwarded = await alias(new NextRequest("http://localhost/api/newznab/api?t=movie"));
  const rss = await rssResponse.text();
  expect(await forwarded.text()).toBe(rss);
  const targeted = await GET(new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42"));
  const parsed = await parseStringPromise(rss);
  const release = parsed.rss.channel[0].item[0];
  // Pinned Arr Newznab parsers prefer the NZB enclosure. Metadata enrichment
  // follows the strict title/year/runtime matcher, not merely the request ID.
  expect(release.enclosure[0].$.type).toBe("application/x-nzb");
  expect(Number(release.enclosure[0].$.length)).toBeGreaterThan(0);
  expect(new URL(release.enclosure[0].$.url).protocol).toMatch(/^https?:$/);
  expect(release.guid[0].$.isPermaLink).toBe("false");
  const attributes = release["newznab:attr"].map(
    (attribute: { $: { name: string } }) => attribute.$.name
  );
  expect(attributes).toEqual(expect.arrayContaining(["tmdbid", "imdbid"]));
  expect(attributes).not.toContain("language");
  expect(release.guid[0]._).toBe(
    generateGenericRssItems(source, "720p", false, "movie")[0].guid.value
  );
  const searchRelease = (await parseStringPromise(await targeted.text())).rss.channel[0].item[0];
  expect(searchRelease.guid).toEqual(release.guid);
  const nzb = await downloadNzb(
    new NextRequest(new URL(release.enclosure[0].$.url, "http://localhost"))
  );
  const content = await nzb.text();
  const mediaExpectations = {
    version: 1,
    duration: { seconds: 5400, provenance: "source_catalogue" },
    audio: null,
    resolution: null,
  };
  expect(parseNzbContent(content)).toEqual({
    title: release.title[0],
    url: source.url_video,
    mediaExpectations,
  });
  const queue = await addfile(
    new NextRequest("http://localhost/api?mode=addfile&cat=movies", {
      method: "POST",
      body: content,
    })
  );
  expect(queue.status).toBe(200);
  expect(state.addToQueue).toHaveBeenCalledWith(
    source.url_video,
    release.title[0],
    "movies",
    mediaExpectations
  );
});

it("exposes identical caps through the direct route and alias without caller/mode heuristics", async () => {
  const direct = await GET(new NextRequest("http://localhost/api/newznab?t=caps"));
  const forwarded = await alias(
    new NextRequest("http://localhost/api/newznab/api?t=caps", {
      headers: { "user-agent": "Prowlarr", "x-forwarded-for": "192.0.2.1" },
    })
  );
  const caps = await direct.text();
  expect(direct.status).toBe(200);
  expect(forwarded.status).toBe(200);
  expect(await forwarded.text()).toBe(caps);
  const parsed = await parseStringPromise(caps);
  const search = parsed.caps.searching[0];
  expect(search["movie-search"][0].$.supportedParams.split(",")).toEqual(
    expect.arrayContaining(["q", "imdbid", "tmdbid"])
  );
  expect(search["tv-search"][0].$.supportedParams.split(",")).toEqual(
    expect.arrayContaining(["q", "tvdbid", "season", "ep"])
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("keeps absolute download hosts out of shared RSS caches and ignores forwarding-header spoofing", async () => {
  const first = await GET(new NextRequest("https://direct.example.invalid/api/newznab?t=movie"));
  const second = await GET(
    new NextRequest("https://other.example.invalid/api/newznab?t=movie", {
      headers: { "x-forwarded-host": "spoof.example.invalid", "x-forwarded-proto": "http" },
    })
  );
  const item = async (response: Response) =>
    (await parseStringPromise(await response.text())).rss.channel[0].item[0];
  const a = await item(first);
  const b = await item(second);
  expect(new URL(a.enclosure[0].$.url).host).toBe("direct.example.invalid");
  expect(new URL(b.enclosure[0].$.url).host).toBe("other.example.invalid");
  expect(a.guid).toEqual(b.guid);
});

it("uses an explicit public URL including its deployment prefix without altering source identity", async () => {
  vi.stubEnv("PINGUFUNK_PUBLIC_URL", "https://public.example.invalid/pingufunk/");
  const response = await GET(
    new NextRequest("http://internal.example.invalid/api/newznab?t=movie")
  );
  const release = (await parseStringPromise(await response.text())).rss.channel[0].item[0];
  expect(new URL(release.enclosure[0].$.url).pathname).toBe(
    "/pingufunk/api/newznab/fake_nzb_download"
  );
  const nzb = await downloadNzb(new NextRequest(release.enclosure[0].$.url));
  expect(parseNzbContent(await nzb.text())).toEqual({
    title: release.title[0],
    url: source.url_video,
    mediaExpectations: {
      version: 1,
      duration: { seconds: 5400, provenance: "source_catalogue" },
      audio: null,
      resolution: null,
    },
  });
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
