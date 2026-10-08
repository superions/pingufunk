import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const state = vi.hoisted(() => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
  lstat: vi.fn(),
  realpath: vi.fn(),
}));
vi.mock("node:child_process", () => ({ spawn: state.spawn, spawnSync: state.spawnSync }));
vi.mock("node:fs/promises", () => ({ lstat: state.lstat, realpath: state.realpath }));
import { probeJobMedia } from "./media-probe";
import { unknownMediaExpectations, parseMediaExpectations } from "@/lib/media-expectations";
import { mediaSourceIdentity } from "@/services/source-audio";

const file = "/synthetic/job/movie.mp4";
const directory = "/synthetic/job";
let child: EventEmitter & {
  pid: number;
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};
let kill: ReturnType<typeof vi.spyOn>;
const stat = {
  isFile: () => true,
  isDirectory: () => false,
  isSymbolicLink: () => false,
  size: 100,
  ino: 7,
  dev: 1,
  mtimeMs: 1000,
};
const output = () =>
  Buffer.from(
    JSON.stringify({
      format: { format_name: "matroska,webm", duration: "120" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
        { codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
      ],
    })
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("PINGUFUNK_FFPROBE_PATH", "/synthetic/tools/ffprobe");
  child = Object.assign(new EventEmitter(), {
    pid: 999999,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn(),
  });
  state.spawn.mockReset().mockReturnValue(child);
  state.spawnSync.mockReset();
  state.lstat
    .mockReset()
    .mockImplementation(async (value) =>
      value === directory ? { ...stat, isFile: () => false, isDirectory: () => true } : stat
    );
  state.realpath.mockReset().mockImplementation(async (value) => value);
  kill = vi.spyOn(process, "kill").mockReturnValue(true);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const started = async () => {
  for (let turn = 0; turn < 12; turn++) await Promise.resolve();
  expect(state.spawn).toHaveBeenCalledTimes(1);
};

it("probes only the established local file with file-only protocols and bounded selected fields", async () => {
  const result = probeJobMedia(file, directory, null, 10);
  await started();
  const [binary, args, options] = state.spawn.mock.calls[0];
  expect(binary).toBe("/synthetic/tools/ffprobe");
  expect(args[args.indexOf("-protocol_whitelist") + 1]).toBe("file");
  expect(args.at(-1)).toBe(file);
  expect(options.detached).toBe(process.platform !== "win32");
  expect(options.shell).toBeUndefined();
  child.stdout.emit("data", output());
  child.emit("close", 0);
  expect((await result).durationSeconds).toBe(120);
  expect(kill).not.toHaveBeenCalled();
});

it("times out and kills only the process group created for this probe", async () => {
  const result = probeJobMedia(file, directory, null, 10);
  const rejected = expect(result).rejects.toThrow("Local media validation failed");
  await started();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
  child.emit("close", null);
  await rejected;
  expect(vi.getTimerCount()).toBe(0);
});

it("caps stdout and stderr together without retaining or publishing tool diagnostics", async () => {
  const result = probeJobMedia(file, directory, null, 10);
  const rejected = expect(result).rejects.toThrow("Local media validation failed");
  await started();
  child.stdout.emit("data", Buffer.alloc(600_000));
  child.stderr.emit("data", Buffer.alloc(500_000));
  expect(kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
  child.emit("close", null);
  await rejected;
});

it("rejects successful exit accompanied by a media error rather than hiding truncation", async () => {
  const result = probeJobMedia(file, directory, null, 10);
  const rejected = expect(result).rejects.toThrow("Local media validation failed");
  await started();
  child.stdout.emit("data", output());
  child.stderr.emit("data", Buffer.from("synthetic private path: truncated stream"));
  child.emit("close", 0);
  await rejected;
  expect(kill).not.toHaveBeenCalled();
});

it("rejects a replaced inode after probing instead of accepting another file", async () => {
  const result = probeJobMedia(file, directory, null, 10);
  const rejected = expect(result).rejects.toThrow("Local media validation failed");
  await started();
  state.lstat.mockResolvedValue({ ...stat, ino: 8 });
  child.stdout.emit("data", output());
  child.emit("close", 0);
  await rejected;
});

it("rejects escaped paths or symlinked job files before starting a tool", async () => {
  await expect(probeJobMedia("/synthetic/other.mp4", directory, null, 10)).rejects.toThrow();
  state.lstat.mockResolvedValue({ ...stat, isSymbolicLink: () => true });
  await expect(probeJobMedia(file, directory, null, 10)).rejects.toThrow();
  expect(state.spawn).not.toHaveBeenCalled();
});

it.each(["german", "foreign", "missing", "wrong-source"])(
  "revalidates v2 %s provider binding before accepting unknown local tracks",
  async (kind) => {
    const url = "https://fixture.akamaized.net/movie.mp4";
    const proof = {
      provider: "arte_hbbtv" as const,
      videoId: "123456-001-A",
      language: "de",
      mediaIdentity: mediaSourceIdentity(url),
    };
    const expected = parseMediaExpectations({
      ...unknownMediaExpectations(),
      version: 2,
      sourceAudio: proof,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({
        videoStreams:
          kind === "missing"
            ? []
            : [{ programId: proof.videoId, url, audioCode: kind === "foreign" ? "VF" : "VA" }],
      })
    );
    vi.stubGlobal("fetch", fetch);
    const result = probeJobMedia(
      file,
      directory,
      expected,
      10,
      kind === "wrong-source" ? url + "?edition=fr" : url
    );
    const rejected =
      kind === "german"
        ? undefined
        : expect(result).rejects.toThrow("Local media validation failed");
    await started();
    child.stdout.emit("data", output());
    child.emit("close", 0);
    if (kind === "german") {
      const facts = await result;
      expect(facts.audioLanguages).toEqual([]);
      expect(facts.sourceAudioEvidence).toEqual(proof);
      expect(facts.expectedChecks.audio).toBe("passed_provider");
    } else await rejected;
    expect(fetch).toHaveBeenCalledTimes(kind === "wrong-source" ? 0 : 1);
    expect(state.spawn.mock.calls[0][1]).not.toContain(url);
  }
);
