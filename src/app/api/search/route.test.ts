import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getMinDurationSeconds, getCategoriesForTopics, getSetting } = vi.hoisted(() => ({
  getMinDurationSeconds: vi.fn(),
  getCategoriesForTopics: vi.fn(),
  getSetting: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getMinDurationSeconds,
  getSetting,
  withSettingsSnapshot: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));
vi.mock("@/services/category", () => ({
  getCategoriesForTopics,
}));
vi.mock("@/services/tv-source-review", () => ({ searchTvSourceReviews: vi.fn(async () => null) }));

import { GET } from "./route";
import { srfProvider } from "@/providers/srf";
import { queryContent } from "@/services/content-search";
import { generateGenericRssItems } from "@/services/newznab";
import { GET as getFakeNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { parseNzbContent } from "@/services/download";
import { readDecisionReport } from "@/server/decision-diagnostics";
import { searchTvSourceReviews } from "@/services/tv-source-review";
vi.mock("@/lib/db", () => ({ prisma: {} }));

function apiItem(title: string, duration: number) {
  return {
    channel: "ARD",
    topic: "Documentary",
    title,
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration,
    size: 1_000_000,
    url_website: "https://example.com",
    url_video: `https://example.com/${encodeURIComponent(title)}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

it.each(["", "&providers=true", "&provider=mediathekview"])(
  "preserves optional catalogue content through the raw client and GUI without changing NZBs (%s)",
  async (form) => {
    // Both requests compare metadata at the same instant; NZBs include time.
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const raw = apiItem("Catalogue fields", 120);
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ result: { results: [raw] } }));
    const request = () => GET(new NextRequest(`http://localhost/api/search?q=Documentary${form}`));
    const baseline = (await (await request()).json()).results[0];
    fetch.mockResolvedValue(
      Response.json({
        result: {
          results: [
            {
              ...raw,
              url_subtitle: "https://example.invalid/subtitles.ttml?version=one",
              productionYear: 2020,
              originalVersion: true,
              sourceVideoDimensions: [{ width: 1920, height: 1080, url: raw.url_video }],
            },
          ],
        },
      })
    );
    const result = (await (await request()).json()).results[0];
    expect(result).toMatchObject({
      url_subtitle: "https://example.invalid/subtitles.ttml?version=one",
      contentDates: { catalogueUpdatedAt: raw.filmlisteTimestamp },
    });
    expect(result.id).toBe(baseline.id);
    expect(result.nzbDownloads).toEqual(baseline.nzbDownloads);
    expect(result.nzbFingerprints).toEqual(baseline.nzbFingerprints);
    expect(result).not.toHaveProperty("productionYear");
    expect(result).not.toHaveProperty("originalVersion");
    expect(result).not.toHaveProperty("sourceVideoDimensions");
  }
);

beforeEach(() => {
  vi.restoreAllMocks();
  getMinDurationSeconds.mockReset();
  getCategoriesForTopics.mockReset();
  getCategoriesForTopics.mockResolvedValue(new Map());
  getSetting.mockReset();
  getSetting.mockResolvedValue(null);
  vi.mocked(searchTvSourceReviews).mockReset().mockResolvedValue(null);
});

it("retains optional metadata in the bound TV review response without exposing internal proofs", async () => {
  const selector = {
    tvdbId: 123,
    season: 1,
    episode: 1,
    sourceId: "e".repeat(64),
    rendition: "sd" as const,
  };
  vi.mocked(searchTvSourceReviews).mockImplementation(async (_query, report) => {
    report?.({
      complete: true,
      candidateWindowLimited: false,
      sources: [{ providerId: "mediathekview", state: "complete", candidateCount: 1 }],
    });
    return [
      {
        info: {
          item: {
            ...apiItem("Episode", 120),
            url_subtitle: "https://example.invalid/subtitles.ttml",
            contentDates: { providerDay: "2024-02-29" },
            sourceAssetFingerprint: "internal-only",
          },
          episode: { name: "Episode", seasonNumber: 1, episodeNumber: 1, runtime: 2, aired: null },
          showName: "Example",
          matchedTitle: "Episode",
          tvdbId: 123,
        },
        review: {
          selector,
          title: "Example - Episode",
          sourceSeconds: 120,
          metadataSeconds: 200,
          tolerancePercent: 10,
          runtimeConflict: true,
          availableRenditions: ["sd"],
        },
      },
    ];
  });
  const response = await GET(new NextRequest("http://localhost/api/search?q=Example"));
  expect(response.status).toBe(200);
  const [result] = (await response.json()).results;
  expect(result).toMatchObject({
    id: selector.sourceId,
    url_subtitle: "https://example.invalid/subtitles.ttml",
    contentDates: { providerDay: "2024-02-29" },
    nzbDownloads: {},
    nzbFingerprints: {},
  });
  expect(result).not.toHaveProperty("sourceAssetFingerprint");
});

describe("movie search API minimum duration", () => {
  it("uses the configured minimum duration", async () => {
    getMinDurationSeconds.mockResolvedValue(2700);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          result: { results: [apiItem("Too short", 2699), apiItem("Boundary", 2700)] },
        })
      )
    );

    const response = await GET(
      new NextRequest("http://localhost/api/search?q=Documentary&type=movie")
    );
    const body = await response.json();

    expect(body.results.map((item: { title: string }) => item.title)).toEqual(["Boundary"]);
  });

  it("keeps short movie results when minimum duration is disabled", async () => {
    getMinDurationSeconds.mockResolvedValue(0);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: { results: [apiItem("Short", 120)] } }))
    );

    const response = await GET(
      new NextRequest("http://localhost/api/search?q=Documentary&type=movie")
    );
    const body = await response.json();

    expect(body.results).toHaveLength(1);
  });
});

it("reports an upstream failure without exposing its token", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("token=private", { status: 401 }));
  const response = await GET(new NextRequest("http://localhost/api/search?q=Documentary"));
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("private");
  const report = readDecisionReport(response.headers.get("X-Pingufunk-Diagnostic-Id")!);
  expect(report?.events).toContainEqual(
    expect.objectContaining({
      stage: "catalogue",
      reason: "source_failed",
      evidence: "unavailable",
    })
  );
  expect(report?.events.some((entry) => entry.reason === "catalogue_empty")).toBe(false);
  expect(JSON.stringify(report)).not.toContain("private");
});

it("distinguishes a confirmed bounded catalogue empty from a failed required later page", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(Response.json({ result: { results: [] } }));
  const empty = await GET(new NextRequest("http://localhost/api/search?q=SecretQuery"));
  const emptyReport = readDecisionReport(empty.headers.get("X-Pingufunk-Diagnostic-Id")!);
  expect((await empty.json()).diagnostics).toEqual(emptyReport);
  expect(emptyReport?.events).toContainEqual(
    expect.objectContaining({ reason: "catalogue_empty", evidence: "proven" })
  );
  vi.mocked(globalThis.fetch)
    .mockResolvedValueOnce(
      Response.json({
        result: { results: Array.from({ length: 1000 }, (_, i) => apiItem(`Synthetic ${i}`, 120)) },
      })
    )
    .mockResolvedValueOnce(new Response("private token", { status: 401 }));
  const failed = await GET(new NextRequest("http://localhost/api/search?q=SecretQuery"));
  expect(failed.status).toBe(502);
  expect((await failed.json()).results).toEqual([]);
  const report = readDecisionReport(failed.headers.get("X-Pingufunk-Diagnostic-Id")!);
  expect(report?.events).toContainEqual(
    expect.objectContaining({ reason: "followup_failed", evidence: "unavailable" })
  );
  expect(JSON.stringify(report)).not.toMatch(/SecretQuery|private|Synthetic/);
});

it("preserves explicit provider audio in server-authored UI releases", async () => {
  vi.spyOn(srfProvider, "isEnabled").mockResolvedValue(true);
  vi.spyOn(srfProvider, "search").mockResolvedValue([
    {
      id: "synthetic-provider",
      providerId: "srf",
      channel: "Synthetic",
      topic: "Example",
      title: "Episode",
      description: "",
      timestamp: 1700000000,
      duration: 120,
      size: 0,
      audioLanguage: "de",
      subtitleUrl: "https://example.invalid/subtitles.ttml",
      subtitleLanguage: "en",
      originalVersion: false,
      audioDescription: false,
      signLanguage: false,
      clearSpeech: true,
      productionYear: 2001,
      contentDates: { providerDay: "2024-02-29" },
      websiteUrl: "https://example.invalid/page",
      videoUrls: {
        standard: "https://example.invalid/sd.mp4",
        high: "https://example.invalid/hd.mp4",
      },
    },
  ]);
  const response = await GET(new NextRequest("http://localhost/api/search?q=Example&provider=srf"));
  expect(response.status).toBe(200);
  const result = (await response.json()).results[0];
  expect(result).toMatchObject({
    url_subtitle: "https://example.invalid/subtitles.ttml",
    audioLanguage: "de",
    subtitleLanguage: "en",
    originalVersion: false,
    audioDescription: false,
    signLanguage: false,
    clearSpeech: true,
    productionYear: 2001,
    contentDates: { providerDay: "2024-02-29" },
  });
  expect(parseNzbContent(result.nzbDownloads.hd)).toEqual({
    title: "Example - Episode",
    url: "https://example.invalid/hd.mp4",
    mediaExpectations: {
      version: 3,
      mediaKind: "unknown",
      durations: {
        source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
        metadata: null,
      },
      sourceAudio: null,
      audio: { language: "de", provenance: "provider_audio" },
      resolution: null,
    },
  });
  expect(vi.mocked(srfProvider.search)).toHaveBeenCalledWith(
    expect.objectContaining({ query: "Example" })
  );
});

it.each(["", "&providers=true", "&provider=mediathekview"])(
  "keeps the MP4 HD rendition when standard is HLS, before result limit (%s)",
  async (form) => {
    const blocked = {
      ...apiItem("Blocked", 120),
      url_video: "https://example.invalid/blocked.m3u8",
    };
    const mixed = {
      ...apiItem("Mixed", 120),
      url_video: "https://example.invalid/standard.m3u8",
      url_video_hd: "https://example.invalid/high.mp4",
      url_video_low: "https://example.invalid/low.mp4",
    };
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response(JSON.stringify({ result: { results: [blocked, mixed] } }))
    );
    const response = await GET(
      new NextRequest(`http://localhost/api/search?q=Documentary&limit=1${form}`)
    );
    const body = await response.json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].title).toBe("Mixed");
    expect(body.results[0].url_video).toBe("");
    expect(body.results[0].url_video_hd).toBe(mixed.url_video_hd);
    expect(Object.keys(body.results[0].nzbDownloads)).toEqual(["hd", "low"]);
    expect(parseNzbContent(body.results[0].nzbDownloads.hd)?.url).toBe(mixed.url_video_hd);
    expect(body.coverage).toMatchObject({ complete: true, eligibleCount: 1, returnedCount: 1 });
    const [rss] = generateGenericRssItems(mixed, "all", false);
    const nzb = await getFakeNzb(new NextRequest(new URL(rss.enclosure.url, "http://localhost")));
    expect(parseNzbContent(await nzb.text())?.url).toBe(mixed.url_video_hd);
    expect(parseNzbContent(body.results[0].nzbDownloads.hd)?.mediaExpectations).toEqual(
      parseNzbContent(
        await (
          await getFakeNzb(new NextRequest(new URL(rss.enclosure.url, "http://localhost")))
        ).text()
      )?.mediaExpectations
    );
  }
);

it.each(["", "&providers=true", "&provider=mediathekview"])(
  "keeps a standard MP4 without inventing an HD slot (%s)",
  async (form) => {
    const source = {
      ...apiItem("Standard only", 120),
      url_video_hd: "https://example.invalid/high.m3u8",
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ result: { results: [source] } }))
    );
    const body = await (
      await GET(new NextRequest(`http://localhost/api/search?q=Documentary${form}`))
    ).json();
    expect(body.results).toHaveLength(1);
    expect(body.results[0].url_video_hd).toBe("");
    expect(Object.keys(body.results[0].nzbDownloads)).toEqual(["sd"]);
    expect(parseNzbContent(body.results[0].nzbDownloads.sd)?.url).toBe(source.url_video);
  }
);

it("does not fill a missing HD field or repeat the same concrete URL in multiple buttons", async () => {
  const standard = apiItem("Standard", 120);
  const duplicated = {
    ...apiItem("Duplicate", 120),
    url_video_hd: "https://example.invalid/same.mp4",
    url_video: "https://example.invalid/same.mp4",
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ result: { results: [standard, duplicated] } }))
  );
  const { results } = await (
    await GET(new NextRequest("http://localhost/api/search?q=Documentary&providers=true"))
  ).json();
  expect(results[0].url_video_hd).toBe("");
  expect(Object.keys(results[0].nzbDownloads)).toEqual(["sd"]);
  expect(Object.keys(results[1].nzbDownloads)).toEqual(["hd"]);
});

it("never trusts a catalogue row ID as SRF provenance or a new GUI identity", async () => {
  const source = {
    ...apiItem("Forged source", 120),
    id: "urn:srf:video:synthetic",
    sourceProviderId: "srf",
  };
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ result: { results: [source] } }))
  );
  const { results } = await (
    await GET(new NextRequest("http://localhost/api/search?q=Documentary&providers=true"))
  ).json();
  expect(results[0].providerId).toBe("mediathekview");
  expect(results[0].id).toBe("ARD-Documentary-Forged source-1700000000");
});

it("marks partial GUI sources explicitly while the same indexer sources fail closed", async () => {
  vi.spyOn(srfProvider, "isEnabled").mockResolvedValue(true);
  vi.spyOn(srfProvider, "search").mockRejectedValue(
    new Error("https://private.invalid/?token=never-display")
  );
  vi.spyOn(globalThis, "fetch").mockImplementation(
    async () => new Response(JSON.stringify({ result: { results: [apiItem("Available", 120)] } }))
  );
  const response = await GET(
    new NextRequest("http://localhost/api/search?q=Documentary&providers=true")
  );
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.results).toHaveLength(1);
  expect(body.coverage.complete).toBe(false);
  expect(body.coverage.sources).toContainEqual({
    providerId: "srf",
    state: "failed",
    candidateCount: 0,
  });
  expect(body.providerCounts).toEqual({ mediathekview: 1, orf: 0, srf: 0, youtube: 0 });
  expect(JSON.stringify(body)).not.toContain("never-display");
  expect(
    await queryContent([{ fields: ["topic", "title"], query: "Documentary" }], 100)
  ).toBeNull();
});

it("does not return earlier pages of a failed source as a complete GUI window", async () => {
  let call = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    call++;
    return call === 1
      ? new Response(
          JSON.stringify({
            result: { results: Array.from({ length: 1000 }, (_, i) => apiItem(`Page-${i}`, 120)) },
          })
        )
      : new Response("unavailable", { status: 401 });
  });
  const response = await GET(new NextRequest("http://localhost/api/search?q=Documentary"));
  expect(response.status).toBe(502);
  const body = await response.json();
  expect(body.results).toEqual([]);
  expect(body.coverage.complete).toBe(false);
});

it("reports a disabled provider without performing a catalogue request", async () => {
  getSetting.mockImplementation(async (key: string) =>
    key === "provider.mediathekview.enabled" ? "false" : null
  );
  const fetch = vi.spyOn(globalThis, "fetch");
  const response = await GET(
    new NextRequest("http://localhost/api/search?q=Example&provider=mediathekview")
  );
  expect(response.status).toBe(200);
  expect((await response.json()).coverage.sources).toEqual([
    { providerId: "mediathekview", state: "disabled", candidateCount: 0 },
  ]);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["-1", "0", "NaN", "1.5", "50junk", "101", "99999999999999999999"])(
  "rejects invalid limits without any provider request (%s)",
  async (limit) => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const response = await GET(
      new NextRequest(`http://localhost/api/search?q=Documentary&limit=${limit}`)
    );
    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  }
);

it.each([
  `q=${"a".repeat(257)}`,
  "q=Example%00title",
  "q=Example&type=bogus",
  "q=Example&provider=bogus",
  "q=Example&providers=bogus",
  "q=Example&limit=1&limit=100",
  "q=Example&provider=srf&provider=mediathekview",
])("rejects malformed search scope before retrieval (%s)", async (query) => {
  const fetch = vi.spyOn(globalThis, "fetch");
  expect((await GET(new NextRequest(`http://localhost/api/search?${query}`))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});
