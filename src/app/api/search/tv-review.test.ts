import { expect, it, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({
  bound: vi.fn(),
  provider: vi.fn(),
  query: vi.fn(),
  nzb: vi.fn(),
}));
vi.mock("@/services/tv-source-review", () => ({ searchTvSourceReviews: mocks.bound }));
vi.mock("@/providers", () => ({
  initializeProviders: vi.fn(),
  providerRegistry: { searchProvider: mocks.provider, searchAll: mocks.provider },
}));
vi.mock("@/services/content-search", () => ({ queryContent: mocks.query }));
vi.mock("@/services/ui-nzb", () => ({ createUiNzbDownloads: mocks.nzb }));
vi.mock("@/services/category", () => ({ getCategoriesForTopics: async () => new Map() }));
vi.mock("@/lib/settings", () => ({
  getSetting: async () => "false",
  getMinDurationSeconds: async () => 0,
}));
import { GET } from "./route";
const bound = {
  info: {
    item: {
      channel: "ZDF",
      topic: "Synthetic Series",
      title: "Episode S06E01",
      description: "",
      duration: 3540,
      size: 1,
      filmlisteTimestamp: 1,
      url_website: "https://example.invalid",
    },
  },
  review: { selector: { sourceId: "a".repeat(64) }, runtimeConflict: true },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bound.mockResolvedValue([bound]);
});
it.each(["", "&providers=true"])(
  "does not expose source-only NZBs for verified conflicts %s",
  async (suffix) => {
    const response = await GET(
      new NextRequest(`http://localhost/api/search?q=Synthetic%20Series${suffix}`)
    );
    expect(response.status).toBe(200);
    expect((await response.json()).results[0]).toMatchObject({
      tvReview: bound.review,
      nzbDownloads: {},
    });
    expect(mocks.nzb).not.toHaveBeenCalled();
    expect(mocks.provider).not.toHaveBeenCalled();
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
  expect(mocks.provider).not.toHaveBeenCalled();
});
it("provider outage does not silently degrade to a generic unbound download", async () => {
  mocks.bound.mockRejectedValue(new Error("private secret"));
  const response = await GET(new NextRequest("http://localhost/api/search?q=Synthetic%20Series"));
  expect(response.status).toBe(502);
  expect(JSON.stringify(await response.json())).not.toContain("secret");
  expect(mocks.query).not.toHaveBeenCalled();
});
