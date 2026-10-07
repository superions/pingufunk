import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { getMinDurationSeconds, getCategoriesForTopics } = vi.hoisted(() => ({
  getMinDurationSeconds: vi.fn(),
  getCategoriesForTopics: vi.fn(),
}));

vi.mock("@/lib/settings", () => ({
  getMinDurationSeconds,
  getSetting: vi.fn(async () => null),
  withSettingsSnapshot: vi.fn(async (operation: () => Promise<unknown>) => operation()),
}));
vi.mock("@/services/category", () => ({
  getCategoriesForTopics,
}));

import { GET } from "./route";
import { providerRegistry } from "@/providers";
import { parseNzbContent } from "@/services/download";
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
    url_video: `https://example.com/${title}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  getMinDurationSeconds.mockReset();
  getCategoriesForTopics.mockReset();
  getCategoriesForTopics.mockResolvedValue(new Map());
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
});

it("preserves explicit provider audio in server-authored UI releases", async () => {
  vi.spyOn(providerRegistry, "searchProvider").mockResolvedValue([
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
  expect(vi.mocked(providerRegistry.searchProvider)).toHaveBeenCalledWith(
    "srf",
    expect.objectContaining({ query: "Example" })
  );
});
