import { expect, it, vi } from "vitest";
import type { ApiResultItem } from "@/types";
import { createUiNzbDownloads, uiNzbFingerprints } from "./ui-nzb";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { parseNzbContent } from "./download";
import { mediaSourceIdentity } from "./source-audio";

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
it("keeps reload fingerprints stable across NZB transport dates but binds actual payload changes", () => {
  const first = createUiNzbDownloads(item, false);
  const later = Object.fromEntries(
    Object.entries(first).map(([quality, body]) => [
      quality,
      body.replace(/date="\d+"/, 'date="123"'),
    ])
  );
  expect(uiNzbFingerprints(later)).toEqual(uiNzbFingerprints(first));
  expect(
    uiNzbFingerprints(createUiNzbDownloads({ ...item, audioLanguage: "de" }, false))
  ).not.toEqual(uiNzbFingerprints(first));
  expect(
    uiNzbFingerprints(
      createUiNzbDownloads({ ...item, url_video: "https://example.invalid/rotated.mp4" }, false)
    ).sd
  ).not.toEqual(uiNzbFingerprints(first).sd);
  expect(new Set(Object.values(uiNzbFingerprints(first))).size).toBe(3);
});
it("keeps server-authored UI filenames, current URLs and v3 facts in all renditions", () => {
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
        version: 3,
        mediaKind: "unknown",
        durations: {
          source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
          metadata: null,
        },
        sourceAudio: null,
        audio: null,
        resolution: null,
      },
    });
});
it("declares unknown v3 facts rather than inferring media kind from a UI title", () => {
  const releases = createUiNzbDownloads({ ...item, duration: 0 }, false);
  expect(parseNzbContent(releases.sd!)?.mediaExpectations).toEqual({
    version: 3,
    mediaKind: "unknown",
    durations: { source: null, metadata: null },
    sourceAudio: null,
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

it("binds UI NZB dimensions to the selected URL, never the default rendition", () => {
  const releases = createUiNzbDownloads(
    {
      ...item,
      sourceVideoDimensions: [
        { url: item.url_video, width: 1920, height: 1080 },
        { url: item.url_video_hd, width: 1280, height: 720 },
      ],
    },
    false
  );
  expect(parseNzbContent(releases.hd!)?.mediaExpectations?.resolution).toEqual({
    width: 1280,
    height: 720,
    provenance: "provider_dimensions",
  });
  expect(parseNzbContent(releases.sd!)?.mediaExpectations?.resolution).toEqual({
    width: 1920,
    height: 1080,
    provenance: "provider_dimensions",
  });
  expect(parseNzbContent(releases.low!)?.mediaExpectations?.resolution).toBeNull();
});

it("never copies a rendition-bound audio proof to a different video URL", () => {
  const sourceAudioEvidence = {
    provider: "arte_hbbtv" as const,
    videoId: "123456-001-A",
    mediaIdentity: mediaSourceIdentity(item.url_video_hd),
    language: "de",
  };
  const releases = createUiNzbDownloads(
    { ...item, sourceAudioEvidence, audioLanguage: "de" },
    false
  );
  expect(parseNzbContent(releases.hd!)?.mediaExpectations).toMatchObject({
    sourceAudio: sourceAudioEvidence,
  });
  expect(parseNzbContent(releases.sd!)?.mediaExpectations).toMatchObject({
    sourceAudio: null,
    audio: null,
  });
  expect(parseNzbContent(releases.low!)?.mediaExpectations).toMatchObject({
    sourceAudio: null,
    audio: null,
  });
});

it("uses shared rendition eligibility and exact-URL dedupe for UI releases", () => {
  const onlyHd = createUiNzbDownloads(
    { ...item, url_video: "https://example.invalid/sd.m3u8", url_video_low: "" },
    false
  );
  expect(Object.keys(onlyHd)).toEqual(["hd"]);
  const repeated = createUiNzbDownloads(
    { ...item, url_video: item.url_video_hd, url_video_low: item.url_video_hd },
    false
  );
  expect(Object.keys(repeated)).toEqual(["hd"]);
});
