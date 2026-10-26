import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/server/ytdlp", () => ({ readYoutubeMediaMetadata: state.read }));
import { resolveYoutubeMedia, youtubeCdnUrl } from "./resolve";
const identity = { videoId: "abcdefghijk", channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" };
const signal = new AbortController().signal;
const cdn = (id: string, signature = "one") =>
  `https://rr1---sn-test.googlevideo.com/videoplayback?expire=${Math.floor(Date.now() / 1000) + 600}&id=${id}&sig=${signature}`;
const formats = () => [
  {
    format_id: "137",
    url: cdn("video"),
    protocol: "https",
    vcodec: "avc1",
    acodec: "none",
    width: 1920,
    height: 1080,
  },
  {
    format_id: "136",
    url: cdn("video-low"),
    protocol: "https",
    vcodec: "avc1",
    acodec: "none",
    width: 1280,
    height: 720,
  },
  {
    format_id: "140-1",
    url: cdn("audio-de"),
    protocol: "https",
    vcodec: "none",
    acodec: "mp4a",
    language: "de",
    audio_channels: 2,
    abr: 128,
  },
  {
    format_id: "140-0",
    url: cdn("audio-en"),
    protocol: "https",
    vcodec: "none",
    acodec: "mp4a",
    language: "en",
    audio_channels: 2,
    abr: 256,
  },
];
const payload = () => ({
  id: identity.videoId,
  channel_id: identity.channelId,
  duration: 120,
  availability: "public",
  is_live: false,
  formats: formats(),
});
beforeEach(() => {
  state.read.mockReset();
  state.read.mockResolvedValue(payload());
});
it("selects concrete video plus German audio, preserving exact rendition across CDN signature rotation", async () => {
  const first = await resolveYoutubeMedia(identity, signal);
  expect(first.selection).toEqual({
    videoFormat: "137",
    audioFormat: "140-1",
    audioTrack: "140-1",
    language: "de",
    width: 1920,
    height: 1080,
    duration: 120,
  });
  const rotated = payload();
  rotated.formats = rotated.formats.map((row) => ({
    ...row,
    url: row.url.replace("sig=one", "sig=two"),
  }));
  state.read.mockResolvedValue(rotated);
  const next = await resolveYoutubeMedia(identity, signal, first.selection);
  expect(next.selection).toEqual(first.selection);
  expect(next.videoUrl).not.toBe(first.videoUrl);
  expect(state.read).toHaveBeenCalledWith(identity.videoId, signal);
});
it.each([
  "uploader",
  "video",
  "unknown-audio",
  "foreign-audio",
  "expired",
  "wrong-host",
  "drm",
  "duplicate",
  "live",
  "missing-format",
  "changed-size",
  "changed-duration",
  "changed-track",
])("fails closed on %s without choosing another rendition", async (kind) => {
  const first = await resolveYoutubeMedia(identity, signal);
  const data = payload();
  if (kind === "uploader") data.channel_id = "UCbbbbbbbbbbbbbbbbbbbbbb";
  if (kind === "video") data.id = "zyxwvutsrqp";
  if (kind === "unknown-audio") data.formats[2].language = "und";
  if (kind === "foreign-audio") data.formats[2].language = "en";
  if (kind === "expired")
    data.formats[0].url = "https://rr1.googlevideo.com/videoplayback?expire=1";
  if (kind === "wrong-host")
    data.formats[0].url = "https://evil.invalid/videoplayback?expire=9999999999";
  if (kind === "drm") Object.assign(data.formats[0], { has_drm: true });
  if (kind === "duplicate") data.formats.push(data.formats[0]);
  if (kind === "live") data.is_live = true;
  if (kind === "missing-format") data.formats.shift();
  if (kind === "changed-size") data.formats[0].height = 720;
  if (kind === "changed-duration") data.duration = 126;
  if (kind === "changed-track") data.formats[2].format_id = "140-2";
  state.read.mockResolvedValue(data);
  await expect(resolveYoutubeMedia(identity, signal, first.selection)).rejects.toThrow(
    "unconfirmed"
  );
});
it("rejects extractor failure and abort, never inventing metadata or starting a fallback", async () => {
  state.read.mockRejectedValue(Error("synthetic unavailable"));
  await expect(resolveYoutubeMedia(identity, signal)).rejects.toThrow("unconfirmed");
  const controller = new AbortController();
  controller.abort();
  state.read.mockClear();
  await expect(resolveYoutubeMedia(identity, controller.signal)).rejects.toThrow();
  expect(state.read).not.toHaveBeenCalled();
});
it.each([
  "http://rr1.googlevideo.com/videoplayback?expire=9999999999",
  "https://googlevideo.com.evil.invalid/videoplayback?expire=9999999999",
  "https://rr1.googlevideo.com/redirect?expire=9999999999",
  "https://user:pass@rr1.googlevideo.com/videoplayback?expire=9999999999",
])("rejects noncanonical CDN selector %s", (url) => expect(() => youtubeCdnUrl(url)).toThrow());

it("returns all measured resolutions from one reply while an accepted 720p job remains exactly 720p", async () => {
  const result = await resolveYoutubeMedia(identity, signal);
  expect(result.selections?.map((row) => [row.videoFormat, row.height])).toEqual([
    ["137", 1080],
    ["136", 720],
  ]);
  const low = result.selections!.find((row) => row.height === 720)!;
  const transfer = await resolveYoutubeMedia(identity, signal, low);
  expect(transfer.selection).toEqual(low);
  expect(transfer.videoUrl).toContain("video-low");
  expect(transfer).not.toHaveProperty("selections");
});

it("treats provider nulls on audio-only rows as unknown dimensions and ignores unproven storyboard codecs without hiding valid German media", async () => {
  const raw = payload();
  state.read.mockResolvedValue({
    ...raw,
    formats: [
      ...raw.formats.map((row) => ({
        ...row,
        width: row.vcodec === "none" ? null : row.width,
        height: row.vcodec === "none" ? null : row.height,
        fps: row.vcodec === "none" ? null : 25,
        audio_channels: row.vcodec === "none" ? row.audio_channels : null,
        abr: row.vcodec === "none" ? row.abr : null,
        filesize: null,
      })),
      {
        format_id: "sb0",
        url: "https://example.invalid/storyboard",
        protocol: "mhtml",
        vcodec: "images",
        acodec: null,
        width: 160,
        height: 90,
        audio_channels: null,
        fps: 0,
        abr: null,
      },
    ],
  });
  const result = await resolveYoutubeMedia(identity, signal);
  expect(result.selection).toMatchObject({
    videoFormat: "137",
    audioFormat: "140-1",
    language: "de",
    width: 1920,
    height: 1080,
  });
  expect(result.selections?.map((row) => row.height)).toEqual([1080, 720]);
});
it("never interprets null or missing codecs as a proven audio/video stream", async () => {
  state.read.mockResolvedValue({
    ...payload(),
    formats: formats().map((row) => ({ ...row, acodec: null, vcodec: undefined })),
  });
  await expect(resolveYoutubeMedia(identity, signal)).rejects.toThrow("unconfirmed");
});
