import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  search: vi.fn(),
  index: vi.fn(),
  settings: new Map<string, string>(),
}));
vi.mock("./search", () => ({ youtubeSearchAdapter: { searchWindow: state.search } }));
vi.mock("@/services/youtube-catalogue", () => ({ readYoutubeCatalogueIndex: state.index }));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => state.settings.get(key) ?? null,
  getMinDurationSeconds: async () => 0,
}));
import { YoutubeProvider } from "./index";
import { syntheticYoutubeSource, syntheticYoutubeExpectations } from "@/lib/__fixtures__/youtube";
const provider = new YoutubeProvider();
beforeEach(() => {
  state.search.mockReset();
  state.index.mockReset();
  state.settings.clear();
});
it("registers a disabled optional source without any runtime or network preflight", async () => {
  await provider.initialize();
  expect(await provider.isEnabled()).toBe(false);
  expect(await provider.search({ query: "Synthetic" })).toEqual([]);
  expect((await provider.checkStatus()).available).toBe(false);
  expect(state.search).not.toHaveBeenCalled();
  expect(state.index).not.toHaveBeenCalled();
});
it("delegates retrieval to its source owner and exposes only typed transfer information, never a Watch URL as media bytes", async () => {
  state.settings.set("provider.youtube.enabled", "true");
  const source = syntheticYoutubeSource();
  state.search.mockResolvedValue({
    items: [
      {
        channel: "Synthetic",
        topic: "Synthetic series",
        title: "Synthetic title",
        description: "",
        duration: 120,
        size: 0,
        filmlisteTimestamp: 1,
        url_website: "https://www.youtube.com/watch?v=abcdefghijk",
        url_video: "",
        url_video_hd: "",
        url_video_low: "",
        audioLanguage: "de",
        sourceRef: source,
        sourceProviderId: "youtube",
        sourceAudioEvidence: syntheticYoutubeExpectations().sourceAudio,
      },
    ],
    coverage: { complete: true },
  });
  const rows = await provider.search({ query: "Synthetic", type: "series" });
  expect(rows).toHaveLength(1);
  expect(state.search.mock.calls[0][2]).toMatchObject({ mediaType: "series" });
  expect(await provider.getDownloadInfo(rows[0])).toMatchObject({
    url: "",
    sourceRef: source,
    quality: "720p",
  });
  state.index.mockResolvedValue({ enabled: true, indexed: true, current: true });
  expect((await provider.checkStatus()).available).toBe(true);
  state.search.mockResolvedValue({ items: [], coverage: { complete: false } });
  await expect(provider.search({ query: "Synthetic" })).rejects.toThrow("unavailable");
});

it("uses the shared concrete rendition choice for provider download preferences", async () => {
  const source = syntheticYoutubeSource(),
    high = {
      ...source,
      selection: { ...source.selection, videoFormat: "137-high", width: 1920, height: 1080 },
    };
  const item = {
    id: "synthetic",
    providerId: "youtube",
    channel: "Synthetic",
    topic: "Synthetic",
    title: "Synthetic",
    description: "",
    timestamp: 1,
    duration: 120,
    size: 0,
    websiteUrl: "https://www.youtube.com/watch?v=abcdefghijk",
    videoUrls: { standard: "" },
    sourceRef: high,
    sourceRenditions: [high, source],
  };
  expect(await provider.getDownloadInfo(item, "high")).toMatchObject({
    quality: "1080p",
    sourceRef: high,
    url: "",
  });
  expect(await provider.getDownloadInfo(item, "standard")).toMatchObject({
    quality: "720p",
    sourceRef: source,
    url: "",
  });
  await expect(provider.getDownloadInfo(item, "low")).rejects.toThrow("unavailable");
});
