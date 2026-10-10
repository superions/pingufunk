import { expect, it, vi } from "vitest";
import type { NewznabItem } from "@/types";
import { fetchSearchResultsForRssSync } from "./mediathek";

const state = vi.hoisted(() => ({
  ready: [] as NewznabItem[],
  epoch: 0,
  delivery: vi.fn(),
  query: vi.fn(async () => []),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: async () => null,
  getMinDurationSeconds: async () => 0,
}));
vi.mock("@/lib/cache", () => ({
  cacheContextEpoch: () => state.epoch,
  mediathekCache: { get: () => undefined, set: () => {} },
}));
vi.mock("./content-search", () => ({
  queryContent: state.query,
  searchCacheContext: async () => "synthetic-context",
  getConfiguredLanguagePolicy: async () => ({}),
}));
vi.mock("./tv-search-delivery", () => ({
  registerTvSearchDelivery: vi.fn(),
  getTvSearchDeliveryItems: async () => {
    state.delivery();
    return structuredClone(state.ready);
  },
}));
vi.mock("./sonarr-rss", () => ({ getSonarrRssMatches: async () => [] }));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: async () => {},
  getRulesetContext: () => "synthetic-rules",
  getRulesetsForTopic: () => [],
}));
vi.mock("./source-audio", () => ({ enrichTvMatches: async () => [] }));

const release = (id: number): NewznabItem => ({
  title: `Synthetic.Series.S01E${id}.GERMAN.1080p.WEB-DL`,
  guid: { isPermaLink: false, value: `owned-${id}` },
  link: `https://example.invalid/${id}`,
  comments: "",
  pubDate: new Date(1_700_000_000_000 + id * 1000).toUTCString(),
  category: "5000",
  description: "Synthetic",
  enclosure: { url: `https://example.invalid/${id}`, length: 1, type: "application/x-nzb" },
  attributes: [],
});
const guids = (xml: string) =>
  [...xml.matchAll(/<guid[^>]*>(.*?)<\/guid>/g)].map((match) => match[1]);

it("freezes the whole combined feed across pages, then refreshes on expiry or configuration invalidation", async () => {
  vi.useFakeTimers();
  try {
    state.ready = [1, 2, 3, 4, 5].map(release);
    expect(guids(await fetchSearchResultsForRssSync(2, 0))).toEqual(["owned-5", "owned-4"]);
    state.ready.push(release(6)); // A newly completed probe must not shift an in-flight page.
    expect(guids(await fetchSearchResultsForRssSync(2, 2))).toEqual(["owned-3", "owned-2"]);
    expect(guids(await fetchSearchResultsForRssSync(2, 4))).toEqual(["owned-1"]);
    expect(state.delivery).toHaveBeenCalledTimes(1);
    expect(state.query).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_001);
    expect(guids(await fetchSearchResultsForRssSync(2, 0))).toEqual(["owned-6", "owned-5"]);
    state.ready = [release(7)];
    state.epoch++;
    expect(guids(await fetchSearchResultsForRssSync(2, 0))).toEqual(["owned-7"]);
    expect(state.delivery).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
