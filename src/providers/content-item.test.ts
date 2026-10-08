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
  });
  expect(
    providerItemToApiResult({ ...provider, id: "urn:srf:video:synthetic", providerId: "srf" }).id
  ).toBe("urn:srf:video:synthetic");
  expect(
    apiResultToProviderItem({ ...item, url_video_hd: "" }, "mediathekview").videoUrls.high
  ).toBeUndefined();
});
