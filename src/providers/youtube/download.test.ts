import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, writeFile, readFile, rm, access, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const state = vi.hoisted(() => ({ resolve: vi.fn(), download: vi.fn(), mux: vi.fn() }));
vi.mock("./resolve", () => ({ resolveYoutubeMedia: state.resolve }));
vi.mock("@/server/download-transfer", () => ({ downloadFile: state.download }));
vi.mock("@/server/ffmpeg", () => ({
  getFfmpegPath: () => process.execPath,
  mergeVideoAudio: state.mux,
}));
import { youtubeDownloadAdapter } from "./download";
import { transferSource } from "@/server/source-download";
import type { YoutubeSourceReference } from "@/lib/youtube-source";
const source: YoutubeSourceReference = {
  version: 1,
  family: "youtube",
  videoId: "abcdefghijk",
  channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlistId: "PLsynthetic123456",
  mappingRevision: "a".repeat(64),
  programme: { kind: "series", targetId: 42, season: 1, episode: 1 },
  originalTitle: "Synthetic",
  selection: {
    videoFormat: "137",
    audioFormat: "140",
    audioTrack: "140",
    language: "de",
    width: 1280,
    height: 720,
    duration: 120,
  },
};
let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pingufunk-youtube-transfer-"));
  state.resolve.mockReset();
  state.download.mockReset();
  state.mux.mockReset();
  state.resolve.mockResolvedValue({
    selection: source.selection,
    videoUrl: "https://synthetic.invalid/rotated-video",
    audioUrl: "https://synthetic.invalid/rotated-audio",
    size: 8,
  });
  state.download.mockImplementation(
    async (url: string, file: string, progress: (...args: number[]) => Promise<void>) => {
      await writeFile(file, url.endsWith("video") ? "video" : "aud");
      await progress(100, url.endsWith("video") ? 5 : 3, url.endsWith("video") ? 5 : 3, 1);
      return null;
    }
  );
  state.mux.mockImplementation(async (video: string, audio: string, file: string) => {
    await writeFile(file, Buffer.concat([await readFile(video), await readFile(audio)]));
    return { success: true, outputPath: file };
  });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
const context = () => ({
  stagingDirectory: dir,
  filename: "synthetic",
  expectations: null,
  getContainer: async () => "mkv" as const,
  signal: new AbortController().signal,
  onProgress: vi.fn(async (_percent: number, _bytes: number, _total: number, _speed: number) => {}),
});
it("dispatches frozen video and audio exactly once through the existing transfer/mux primitives and common staging guard", async () => {
  const ctx = context();
  const result = await transferSource(source, ctx);
  expect(result.path).toBe(path.join(dir, "synthetic.mkv"));
  expect(result.extension).toBe(".mkv");
  expect((await stat(result.path)).size).toBe(8);
  expect(state.resolve).toHaveBeenCalledWith(source, ctx.signal, source.selection);
  expect(state.download).toHaveBeenCalledTimes(2);
  for (const call of state.download.mock.calls) {
    expect(call[3]).toBe(ctx.signal);
    expect(call[4]).toEqual({ chunkSize: 10 * 1024 * 1024 });
  }
  expect(state.mux).toHaveBeenCalledWith(
    path.join(dir, "synthetic.video"),
    path.join(dir, "synthetic.audio"),
    result.path,
    ctx.signal,
    false
  );
  expect(ctx.onProgress.mock.calls.map((call) => call[1])).toEqual([5, 8]);
  await expect(access(path.join(dir, "synthetic.video"))).rejects.toThrow();
  await expect(access(path.join(dir, "synthetic.audio"))).rejects.toThrow();
});
it("does not download or fall back when fresh resolution fails, and does not mux after a failed transfer", async () => {
  state.resolve.mockRejectedValue(Error("rotated selection"));
  await expect(youtubeDownloadAdapter.transfer(source, context())).rejects.toThrow();
  expect(state.download).not.toHaveBeenCalled();
  state.resolve.mockResolvedValue({
    selection: source.selection,
    videoUrl: "video",
    audioUrl: "audio",
    size: 0,
  });
  state.download.mockResolvedValue({
    version: 1,
    phase: "request",
    reason: "http_status",
    code: null,
    receivedBytes: 0,
    writtenBytes: 0,
    expectedBytes: null,
    httpStatus: 403,
    elapsedMs: 1,
  });
  await expect(transferSource(source, context())).rejects.toThrow();
  expect(state.download).toHaveBeenCalledTimes(1);
  expect(state.mux).not.toHaveBeenCalled();
});
it("honours cancellation before resolving or writing and retains the shared output ownership gate", async () => {
  const ctx = context();
  ctx.signal = AbortSignal.abort();
  await expect(transferSource(source, ctx)).rejects.toThrow();
  expect(state.resolve).not.toHaveBeenCalled();
  await expect(transferSource(source, { ...context(), filename: "../escape" })).rejects.toThrow();
  expect(state.resolve).not.toHaveBeenCalled();
});
