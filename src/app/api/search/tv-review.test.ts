import { expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { parseUiSearchCoverage } from "@/lib/ui-search-coverage";
const mocks = vi.hoisted(() => ({
  bound: vi.fn(),
  window: vi.fn(),
  query: vi.fn(),
  nzb: vi.fn(),
  fingerprints: vi.fn(),
}));
vi.mock("@/services/tv-source-review", () => ({ searchTvSourceReviews: mocks.bound }));
vi.mock("@/services/content-search", async (original) => ({
  ...(await original<typeof import("@/services/content-search")>()),
  queryContent: mocks.query,
  queryContentWindow: mocks.window,
}));
vi.mock("@/services/ui-nzb", () => ({
  createUiNzbDownloads: mocks.nzb,
  uiNzbFingerprints: mocks.fingerprints,
}));
vi.mock("@/services/category", () => ({ getCategoriesForTopics: async () => new Map() }));
vi.mock("@/lib/settings", () => ({
  getSetting: async () => "false",
  getMinDurationSeconds: async () => 0,
  withSettingsSnapshot: async (operation: () => Promise<unknown>) => operation(),
}));
import { GET } from "./route";
const bound = {
  info: {
    episode: { runtime: 59 },
    item: {
      channel: "ZDF",
      topic: "Synthetic Series",
      title: "Episode S06E01",
      description: "",
      duration: 3540,
      size: 1,
      filmlisteTimestamp: 1,
      url_website: "https://example.invalid",
      url_video: "",
      url_video_hd: "https://example.invalid/source.mp4",
      url_video_low: "",
    },
  },
  review: { selector: { sourceId: "a".repeat(64) }, runtimeConflict: true },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.window.mockResolvedValue({
    items: [],
    coverage: { complete: true, candidateWindowLimited: false, sources: [] },
  });
  mocks.bound.mockImplementation(async (_query, reportCoverage) => {
    reportCoverage({
      complete: true,
      candidateWindowLimited: false,
      sources: [{ providerId: "mediathekview", state: "complete", candidateCount: 1 }],
    });
    return [bound];
  });
});
it.each(["", "&providers=true", "&type=all", "&providers=true&type=all"])(
  "does not expose source-only NZBs for verified conflicts %s",
  async (suffix) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/search?q=Synthetic%20Series${suffix}`)
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(parseUiSearchCoverage(body.coverage, body.results.length)).not.toBeNull();
    expect(body.results[0]).toMatchObject({
      tvReview: bound.review,
      nzbDownloads: {},
    });
    expect(mocks.nzb).not.toHaveBeenCalled();
    expect(mocks.window).not.toHaveBeenCalled();
  }
);
it("a provider selector cannot route a bound conflict around review", async () => {
  expect(
    (
      await GET(
        new NextRequest("http://localhost/api/search?q=Synthetic%20Series&provider=mediathekview")
      )
    ).status
  ).toBe(409);
  expect(mocks.window).not.toHaveBeenCalled();
});
it("provider outage does not silently degrade to a generic unbound download", async () => {
  mocks.bound.mockRejectedValue(new Error("private secret"));
  const response = await GET(new NextRequest("http://localhost/api/search?q=Synthetic%20Series"));
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("secret");
  expect(mocks.query).not.toHaveBeenCalled();
});

it("keeps canonical enqueue fingerprints on nonconflicting bound TV sources", async () => {
  bound.review.runtimeConflict = false;
  mocks.nzb.mockReturnValue({ hd: "synthetic-server-authored-nzb" });
  mocks.fingerprints.mockReturnValue({ hd: "b".repeat(64) });
  const response = await GET(new NextRequest("http://localhost/api/search?q=Synthetic%20Series"));
  expect(response.status).toBe(200);
  expect((await response.json()).results[0]).toMatchObject({
    nzbDownloads: { hd: "synthetic-server-authored-nzb" },
    nzbFingerprints: { hd: "b".repeat(64) },
  });
  expect(mocks.fingerprints).toHaveBeenCalledExactlyOnceWith({
    hd: "synthetic-server-authored-nzb",
  });
  expect(mocks.nzb).toHaveBeenCalledExactlyOnceWith(bound.info.item, false, bound.info.episode);
  expect(mocks.query).not.toHaveBeenCalled();
  bound.review.runtimeConflict = true;
});

it("does not invent coverage when a bound owner omits its retrieval evidence", async () => {
  mocks.bound.mockResolvedValue([bound]);
  const response = await GET(new NextRequest("http://localhost/api/search?q=Synthetic%20Series"));
  expect(response.status).toBe(502);
  expect(mocks.query).not.toHaveBeenCalled();
});
