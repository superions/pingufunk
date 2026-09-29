import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/search/route";
import { GET as getFakeNzb } from "@/app/api/newznab/fake_nzb_download/route";
import type { ApiResultItem, TvSearchContext } from "@/types";
import { queryContent } from "./content-search";
import { generateGenericRssItems } from "./newznab";
import { parseNzbContent } from "./download";
import {
  fetchSearchResultsByString,
  fetchSearchResultsForRssSync,
  fetchMovieSearchByQuery,
} from "./mediathek";
import { mediathekCache } from "@/lib/cache";
import { searchVideos, getLatestVideos } from "./srgssr-api";
import { queryMediathekView } from "@/lib/mediathek-client";

const { settings } = vi.hoisted(() => ({ settings: new Map<string, string>() }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => settings.get(key) ?? null),
  getMinDurationSeconds: vi.fn(async () => 300),
}));
vi.mock("@/services/category", () => ({ getCategoriesForTopics: vi.fn(async () => new Map()) }));
vi.mock("@/lib/mediathek-client", () => ({
  MEDIATHEK_VIEW_MAX_PAGE_SIZE: 1000,
  queryMediathekView: vi.fn(async () => []),
}));
vi.mock("./srgssr-api", () => ({ searchVideos: vi.fn(), getLatestVideos: vi.fn() }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(),
  getAllTopics: () => [],
  getRulesetsForTopic: () => [],
}));
vi.mock("./tmdb", () => ({ searchMovieByTitle: vi.fn(async () => null) }));

const video = {
  id: "11111111-1111-4111-8111-111111111111",
  urn: "urn:srf:video:11111111-1111-4111-8111-111111111111",
  title: "Rundschau",
  mediaType: "VIDEO" as const,
  vendor: "SRF" as const,
  duration: 1800000,
  type: "EPISODE" as const,
  playableAbroad: true,
  date: "2026-09-16T12:00:00Z",
};

const srfSearchContext: TvSearchContext = {
  query: "Rundschau",
  tvdbId: null,
  season: null,
  episode: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  settings.clear();
  settings.set("api.srgssr.consumerKey", "fixture");
  settings.set("api.srgssr.consumerSecret", "fixture");
  settings.set("download.enableHLS", "true");
  mediathekCache.clear();
  vi.mocked(searchVideos).mockResolvedValue([video]);
  vi.mocked(getLatestVideos).mockResolvedValue([video]);
  vi.mocked(queryMediathekView).mockResolvedValue([]);
});

describe("configured providers in normal search flows", () => {
  it("returns SRF in the ordinary UI request without an extra query parameter", async () => {
    const response = await GET(new NextRequest("http://localhost/api/search?q=Rundschau"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].url_video).toBe(
      "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111#rundfunkarr-height=720"
    );
  });

  it("keeps actual SRF search metadata neutral through RSS and the fake-NZB consumer", async () => {
    const results = await queryContent([{ fields: ["topic"], query: "Rundschau" }], 1);

    expect(results).not.toBeNull();
    const [result] = results!;
    expect(result).toBeDefined();
    expect(result).not.toHaveProperty("audioLanguage");
    const [rssItem] = generateGenericRssItems(result!, "720p", true);
    expect(rssItem.title).not.toContain("GERMAN");

    const downloadUrl = new URL(rssItem.enclosure.url, "http://localhost");
    const response = await getFakeNzb(new NextRequest(downloadUrl));
    expect(response.status).toBe(200);
    expect(parseNzbContent(await response.text())).toEqual({
      title: rssItem.title,
      url: result.url_video,
    });
  });

  it("includes SRF in Sonarr text searches and Radarr movie searches", async () => {
    expect(await fetchSearchResultsByString(srfSearchContext, 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(await fetchMovieSearchByQuery("Rundschau", 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
  });

  it("queries recent SRF episodes for RSS sync", async () => {
    await fetchSearchResultsForRssSync(50, 0);
    expect(getLatestVideos).toHaveBeenCalledWith("SRF", 100);
  });

  it("does not query SRF when HLS is disabled", async () => {
    settings.set("download.enableHLS", "false");
    expect(await queryContent([], 50)).toEqual([]);
    expect(getLatestVideos).not.toHaveBeenCalled();
  });

  it("keeps failed SRF searches out of the cache and recovers on the next request", async () => {
    vi.mocked(searchVideos).mockRejectedValueOnce(new Error("unavailable"));
    await expect(fetchSearchResultsByString(srfSearchContext, 50, 0)).rejects.toThrow(
      "Search provider unavailable"
    );
    expect(await fetchSearchResultsByString(srfSearchContext, 50, 0)).toContain(
      "11111111-1111-4111-8111-111111111111"
    );
    expect(searchVideos).toHaveBeenCalledTimes(2);
  });

  it("honors the ORF opt-in and HLS setting", async () => {
    settings.set("provider.srf.enabled", "false");
    vi.mocked(queryMediathekView).mockResolvedValue([
      {
        channel: "ORF",
        topic: "ZIB",
        title: "ZIB",
        description: "",
        duration: 1800,
        size: 0,
        filmlisteTimestamp: 1,
        url_video: "https://example.org/zib.m3u8",
        url_video_hd: "",
        url_video_low: "",
        url_website: "",
      },
    ]);
    expect(await queryContent([], 50)).toEqual([]);
    settings.set("provider.orf.enabled", "true");
    expect(await queryContent([], 50)).toHaveLength(1);
    settings.set("download.enableHLS", "false");
    expect(await queryContent([], 50)).toEqual([]);
  });
});

it("restricts ORF-only upstream searches before applying the requested limit", async () => {
  settings.set("provider.mediathekview.enabled", "false");
  settings.set("provider.orf.enabled", "true");
  settings.set("provider.srf.enabled", "false");
  const queries = [{ fields: ["topic"], query: "News" }];
  await queryContent(queries, 5);
  expect(queryMediathekView).toHaveBeenCalledWith(
    [...queries, { fields: ["channel"], query: "ORF" }],
    1000,
    { offset: 0, deadlineAt: expect.any(Number) }
  );
  expect(queries).toHaveLength(1);
});

it("finds and selects a later German edition across the bounded source pages", async () => {
  settings.set("provider.srf.enabled", "false");
  const french = {
    channel: "ARTE.FR",
    topic: "Example",
    title: "Example programme",
    description: "Synthetic French variant",
    filmlisteTimestamp: 100,
    duration: 1800,
    size: 500_000_000,
    id: "fr-source-id",
    url_website: "https://www.arte.tv/fr/videos/123456-001-A/example-fr/",
    url_video: "https://example.org/shared.mp4",
    url_video_low: "",
    url_video_hd: "",
  };
  const german = {
    ...french,
    channel: "ARTE.DE",
    title: "Example programme Deutsch",
    audioLanguage: "de",
    id: "de-source-id",
    url_website: "https://www.arte.tv/de/videos/123456-001-A/example-de/",
  };
  const candidates = [
    ...Array.from({ length: 1200 }, (_, index) => ({
      ...french,
      id: `fr-source-${index}`,
      filmlisteTimestamp: 2000 - index,
    })),
    german,
  ];
  vi.mocked(queryMediathekView).mockImplementation(async (_queries, size, options) => {
    const offset = options?.offset ?? 0;
    return candidates.slice(offset, offset + size);
  });

  const results = await queryContent([], 1);

  expect(vi.mocked(queryMediathekView).mock.calls.map(([, , options]) => options?.offset)).toEqual([
    0, 1000,
  ]);
  expect(
    new Set(vi.mocked(queryMediathekView).mock.calls.map(([, , options]) => options?.deadlineAt))
      .size
  ).toBe(1);
  expect(results).toEqual([german]);
});

it("stops at the documented local candidate ceiling instead of paging without bound", async () => {
  settings.set("provider.srf.enabled", "false");
  const candidate = {
    channel: "ARD",
    topic: "Example",
    title: "Example programme",
    description: "Synthetic bounded provider page",
    filmlisteTimestamp: 100,
    duration: 1800,
    size: 500_000_000,
    url_website: "https://example.org/example/episode-1",
    url_video: "https://cdn.example.org/episode-1.mp4",
    url_video_low: "",
    url_video_hd: "",
  };
  vi.mocked(queryMediathekView).mockImplementation(async (_queries, size) =>
    Array.from({ length: size }, () => candidate)
  );

  await queryContent([], 1);

  expect(vi.mocked(queryMediathekView).mock.calls.map(([, , options]) => options?.offset)).toEqual([
    0, 1000, 2000, 3000, 4000,
  ]);
});

it("coalesces identical in-flight searches but does not retain the result", async () => {
  settings.set("provider.srf.enabled", "false");
  let release!: (items: ApiResultItem[]) => void;
  vi.mocked(queryMediathekView).mockImplementationOnce(
    () =>
      new Promise<ApiResultItem[]>((resolve) => {
        release = resolve;
      })
  );
  const queries = [{ fields: ["topic"], query: "Example" }];
  const first = queryContent(queries, 10);
  const second = queryContent(queries, 10);
  await vi.waitFor(() => expect(queryMediathekView).toHaveBeenCalledTimes(1));
  release([]);
  expect(await Promise.all([first, second])).toEqual([[], []]);

  vi.mocked(queryMediathekView).mockResolvedValue([]);
  await queryContent(queries, 10);
  expect(queryMediathekView).toHaveBeenCalledTimes(2);
});

it("does not cache or return partial candidates when a later source page fails", async () => {
  settings.set("provider.srf.enabled", "false");
  const candidate = {
    channel: "ARD",
    topic: "Example",
    title: "Example programme",
    description: "Synthetic failed provider page",
    filmlisteTimestamp: 100,
    duration: 1800,
    size: 500_000_000,
    url_website: "https://example.org/example/episode-1",
    url_video: "https://cdn.example.org/episode-1.mp4",
    url_video_low: "",
    url_video_hd: "",
  };
  vi.mocked(queryMediathekView).mockImplementation(async (_queries, size, options) =>
    options?.offset === 0 ? Array.from({ length: size }, () => candidate) : null
  );

  expect(await queryContent([], 1)).toBeNull();
});
