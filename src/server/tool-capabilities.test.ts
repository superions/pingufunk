import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), configured: vi.fn(), ffprobe: vi.fn() }));
vi.mock("./bounded-process", () => ({ readBoundedProcess: mocks.read }));
vi.mock("./ffmpeg", () => ({ getFfmpegPath: () => "/synthetic/owned/ffmpeg" }));
vi.mock("./media-probe", () => ({ getFfprobePath: mocks.ffprobe }));
vi.mock("./ytdlp", () => ({ getConfiguredYtdlpPath: mocks.configured }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useRealTimers();
  mocks.configured.mockResolvedValue("/synthetic/custom/yt-dlp");
  mocks.ffprobe.mockReturnValue("/synthetic/custom/ffprobe");
  mocks.read.mockImplementation(async (binary: string) => ({
    state: "ok",
    output: binary.endsWith("yt-dlp")
      ? "2026.09.23\n"
      : `${binary.endsWith("ffprobe") ? "ffprobe" : "ffmpeg"} version 7.0\n`,
  }));
});

it("uses configured binaries, coalesces concurrent reads and expires its short cache", async () => {
  const { getToolCapabilities } = await import("./tool-capabilities");
  const results = await Promise.all(Array.from({ length: 10 }, () => getToolCapabilities()));
  expect(results.every((result) => result.ytdlp.version === "2026.09.23")).toBe(true);
  expect(mocks.read.mock.calls).toEqual([
    ["/synthetic/owned/ffmpeg", ["-version"]],
    ["/synthetic/custom/ffprobe", ["-version"]],
    ["/synthetic/custom/yt-dlp", ["--version"]],
  ]);
  await getToolCapabilities();
  expect(mocks.read).toHaveBeenCalledTimes(3);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 30_001);
  await getToolCapabilities();
  expect(mocks.read).toHaveBeenCalledTimes(6);
  vi.restoreAllMocks();
});

it("does not expose malformed versions or reuse an old configured binary", async () => {
  const { getToolCapabilities } = await import("./tool-capabilities");
  mocks.read.mockResolvedValue({ state: "ok", output: "https://synthetic.invalid/token/private" });
  const invalid = await getToolCapabilities();
  expect(
    Object.values(invalid).every(
      (result) => result.state === "invalid_response" && result.version === null
    )
  ).toBe(true);
  expect(JSON.stringify(invalid)).not.toContain("private");
  mocks.configured.mockResolvedValue("/synthetic/new/yt-dlp");
  mocks.read.mockResolvedValue({ state: "missing", output: "" });
  expect((await getToolCapabilities()).ytdlp.state).toBe("missing");
  expect(mocks.read.mock.calls.at(-1)?.[0]).toBe("/synthetic/new/yt-dlp");
});

it("does not start another inspection or confirm an old path during configuration rotation", async () => {
  const { getToolCapabilities } = await import("./tool-capabilities");
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  mocks.read.mockImplementation(async (binary: string) => {
    await gate;
    return {
      state: "ok",
      output: binary.endsWith("yt-dlp")
        ? "2026.09.23\n"
        : `${binary.endsWith("ffprobe") ? "ffprobe" : "ffmpeg"} version 7.0\n`,
    };
  });
  const original = getToolCapabilities();
  await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(3));
  mocks.configured.mockResolvedValue("/synthetic/rotated/yt-dlp");
  const rotated = await getToolCapabilities();
  expect(Object.values(rotated).every((entry) => entry.state === "failed" && !entry.version)).toBe(
    true
  );
  expect(mocks.read).toHaveBeenCalledTimes(3);
  release();
  await original;
  expect((await getToolCapabilities()).ytdlp.state).toBe("ok");
  expect(mocks.read.mock.calls.at(-1)?.[0]).toBe("/synthetic/rotated/yt-dlp");
  expect(mocks.read).toHaveBeenCalledTimes(6);
});

it("rejects relative ffprobe paths exactly as the real media probe does", async () => {
  const { getToolCapabilities } = await import("./tool-capabilities");
  mocks.ffprobe.mockReturnValue("relative/ffprobe");
  expect((await getToolCapabilities()).ffprobe).toEqual({ state: "failed", version: null });
  expect(mocks.read.mock.calls.some(([binary]) => binary === "relative/ffprobe")).toBe(false);
});
