import { expect, it } from "vitest";
import { apiResultToProviderItem, providerItemToApiResult } from "./content-item";
import type { ApiResultItem } from "@/types";

it("preserves exact rendition facts and the shipped IDs across the provider adapter", () => {
  const item: ApiResultItem = {
    id: "unstable-catalogue-row",
    channel: "Synthetic",
    topic: "Example",
    title: "Episode",
    description: "",
    filmlisteTimestamp: 1,
    duration: 120,
    size: 0,
    url_website: "https://example.invalid/page",
    url_video: "https://example.invalid/sd.mp4",
    url_video_hd: "https://example.invalid/hd.mp4",
    url_video_low: "",
    audioLanguage: "de",
    sourceAudioEvidence: {
      provider: "arte_hbbtv",
      videoId: "123456-001-A",
      mediaIdentity: "a".repeat(64),
      language: "de",
    },
    sourceVideoDimensions: [{ url: "https://example.invalid/hd.mp4", width: 1280, height: 720 }],
    contentDates: { catalogueUpdatedAt: 1, broadcastAt: 2000000000 },
    sourceAvailability: { state: "unknown" },
  };
  const provider = apiResultToProviderItem(item, "mediathekview");
  expect(provider.id).toBe("Synthetic-Example-Episode-1");
  expect(provider.videoUrls).toEqual({
    standard: item.url_video,
    high: item.url_video_hd,
    low: undefined,
  });
  const restored = providerItemToApiResult(provider);
  expect(restored).toMatchObject({
    sourceProviderId: "mediathekview",
    audioLanguage: "de",
    sourceAudioEvidence: item.sourceAudioEvidence,
    sourceVideoDimensions: item.sourceVideoDimensions,
    contentDates: item.contentDates,
    sourceAvailability: item.sourceAvailability,
  });
  expect(
    providerItemToApiResult({ ...provider, id: "urn:srf:video:synthetic", providerId: "srf" }).id
  ).toBe("urn:srf:video:synthetic");
  expect(
    apiResultToProviderItem({ ...item, url_video_hd: "" }, "mediathekview").videoUrls.high
  ).toBeUndefined();
});

it("keeps validated optional catalogue fields in both adapter directions without changing IDs", () => {
  const item = {
    channel: "Synthetic",
    topic: "Example",
    title: "Episode",
    description: "",
    filmlisteTimestamp: 1,
    duration: 120,
    size: 0,
    url_website: "",
    url_video: "https://example.invalid/video.mp4",
    url_video_hd: "",
    url_video_low: "",
    url_subtitle: "https://example.invalid/subtitles.ttml",
    productionYear: 2001,
    audioLanguage: "de",
    subtitleLanguage: "en",
    originalVersion: false,
    audioDescription: true,
    signLanguage: false,
    clearSpeech: true,
    contentDates: { providerDay: "2024-02-29" },
  };
  const provider = apiResultToProviderItem(item, "mediathekview");
  expect(provider).toMatchObject({
    subtitleUrl: item.url_subtitle,
    productionYear: 2001,
    subtitleLanguage: "en",
    originalVersion: false,
    audioDescription: true,
    signLanguage: false,
    clearSpeech: true,
  });
  expect(provider.id).toBe("Synthetic-Example-Episode-1");
  expect(providerItemToApiResult(provider)).toMatchObject(item);
});
it("retains typed source identity and selected audio through both adapters while leaving all legacy byte slots empty", async () => {
  const { syntheticYoutubeSource, syntheticYoutubeExpectations } =
    await import("@/lib/__fixtures__/youtube");
  const source = syntheticYoutubeSource();
  const item: ApiResultItem = {
    channel: "Synthetic",
    topic: "Synthetic series",
    title: "Synthetic title",
    description: "",
    filmlisteTimestamp: 1,
    duration: 120,
    size: 0,
    url_website: "https://www.youtube.com/watch?v=abcdefghijk",
    url_video: "",
    url_video_hd: "",
    url_video_low: "",
    sourceProviderId: "youtube",
    sourceRef: source,
    sourceRenditions: [source],
    sourceAudioEvidence: syntheticYoutubeExpectations().sourceAudio,
  };
  const provider = apiResultToProviderItem(item, "youtube");
  const restored = providerItemToApiResult(provider);
  expect(restored.sourceRef).toEqual(source);
  expect(restored.sourceRenditions).toEqual([source]);
  expect(() =>
    apiResultToProviderItem({ ...item, sourceRenditions: Array(6).fill(source) }, "youtube")
  ).toThrow();
  expect(() =>
    providerItemToApiResult({ ...provider, sourceRenditions: Array(6).fill(source) })
  ).toThrow();
  expect(restored.sourceAudioEvidence).toEqual(item.sourceAudioEvidence);
  expect(restored.sourceProviderId).toBe("youtube");
  expect([restored.url_video, restored.url_video_hd, restored.url_video_low]).toEqual(["", "", ""]);
});
