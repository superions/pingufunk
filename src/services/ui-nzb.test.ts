import { expect, it, vi } from "vitest";
import type { ApiResultItem } from "@/types";
import { createUiNzbDownloads } from "./ui-nzb";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { parseNzbContent } from "./download";

const item: ApiResultItem = {
  channel: "Synthetic",
  topic: "Example & Topic",
  title: 'Film "Title" -- S02E03',
  description: "",
  duration: 120,
  filmlisteTimestamp: 1700000000,
  size: 1000,
  url_website: "https://example.invalid/page",
  url_video: "https://example.invalid/sd--video.mp4?a=1&b=2",
  url_video_hd: "https://example.invalid/hd.mp4",
  url_video_low: "https://example.invalid/low.mp4",
};
it("keeps server-authored UI filenames, current URLs and v1 facts in all renditions", () => {
  const releases = createUiNzbDownloads(item, false);
  expect(Object.keys(releases)).toEqual(["hd", "sd", "low"]);
  for (const [key, url] of [
    ["hd", item.url_video_hd],
    ["sd", item.url_video],
    ["low", item.url_video_low],
  ] as const)
    expect(parseNzbContent(releases[key]!)).toEqual({
      title: "Example & Topic - Film _Title_ -- S02E03",
      url,
      mediaExpectations: {
        version: 1,
        duration: { seconds: 120, provenance: "source_catalogue" },
        audio: null,
        resolution: null,
      },
    });
});
it("declares unknown v1 facts rather than a browser-authored legacy NZB", () => {
  const releases = createUiNzbDownloads({ ...item, duration: 0 }, false);
  expect(parseNzbContent(releases.sd!)?.mediaExpectations).toEqual({
    version: 1,
    duration: null,
    audio: null,
    resolution: null,
  });
});
it("retains explicit provider audio evidence without inferring it from the title", () => {
  expect(
    parseNzbContent(createUiNzbDownloads({ ...item, audioLanguage: "de" }, false).sd!)
      ?.mediaExpectations?.audio
  ).toEqual({ language: "de", provenance: "provider_audio" });
  expect(
    parseNzbContent(createUiNzbDownloads({ ...item, title: "GERMAN HD" }, false).sd!)
      ?.mediaExpectations?.audio
  ).toBeNull();
});
it("does not emit an HLS download while the existing opt-in is off", () => {
  const mixed = { ...item, url_video_hd: "https://example.invalid/master.m3u8", url_video_low: "" };
  expect(createUiNzbDownloads(mixed, false)).not.toHaveProperty("hd");
  expect(parseNzbContent(createUiNzbDownloads(mixed, true).hd!)?.url).toBe(mixed.url_video_hd);
});
