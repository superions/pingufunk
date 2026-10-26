import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { youtubeInput } from "@/lib/youtube-catalogue";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("child_process", () => ({ spawn }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) =>
    key === "download.ytdlpPath" ? process.execPath : null
  ),
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { readYoutubeMetadata, YoutubeMetadataError } from "./ytdlp";
let child: EventEmitter & {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
};
beforeEach(() => {
  vi.useFakeTimers();
  spawn.mockReset();
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => {
      queueMicrotask(() => child.emit("close", 1));
      return true;
    }),
  });
  spawn.mockReturnValue(child as unknown as ChildProcess);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function started(signal = new AbortController().signal) {
  const result = readYoutubeMetadata(youtubeInput("PLabcdefghijklm"), 0, signal);
  // Wait only for the actual access/settings preflight, not for a source timeout.
  await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
  return { result };
}
it("uses bounded metadata-only arguments without config, plugins, retries or installation", async () => {
  const { result } = await started();
  child.stdout.write(JSON.stringify({ id: "PLabcdefghijklm", entries: [] }));
  child.emit("close", 0);
  expect(await result).toEqual({ id: "PLabcdefghijklm", entries: [] });
  const args = spawn.mock.calls[0][1];
  expect(args).toEqual(
    expect.arrayContaining([
      "--ignore-config",
      "--no-plugin-dirs",
      "--no-remote-components",
      "--simulate",
      "--skip-download",
      "--flat-playlist",
      "--dump-single-json",
      "--playlist-end",
      "100",
      "--retries",
      "0",
    ])
  );
  expect(args.slice(-2)).toEqual(["--", "https://www.youtube.com/playlist?list=PLabcdefghijklm"]);
  expect(spawn.mock.calls[0][2]).toMatchObject({
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
});
it.each(["timeout", "overflow", "process", "invalid", "cancelled"] as const)(
  "fails closed on %s and never returns a false empty success",
  async (reason) => {
    const controller = new AbortController();
    const { result } = await started(controller.signal);
    const rejection = expect(result).rejects.toMatchObject({ reason });
    if (reason === "timeout") await vi.advanceTimersByTimeAsync(30001);
    if (reason === "overflow") child.stdout.write(Buffer.alloc(8 * 1024 * 1024 + 1));
    if (reason === "process") {
      child.stderr.write("https://private.invalid?secret=value");
      child.emit("close", 1);
    }
    if (reason === "invalid") {
      child.stdout.write("not-json");
      child.emit("close", 0);
    }
    if (reason === "cancelled") controller.abort();
    await rejection;
    if (["timeout", "overflow", "cancelled"].includes(reason))
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  }
);
it("rejects an unknown extractor target before starting a process", async () => {
  await expect(
    readYoutubeMetadata(
      { kind: "movie", id: "abcdefghijk", url: "https://evil.invalid/video" },
      0,
      new AbortController().signal
    )
  ).rejects.toThrow();
  expect(spawn).not.toHaveBeenCalled();
  expect(new YoutubeMetadataError("invalid").message).not.toContain("secret");
});
