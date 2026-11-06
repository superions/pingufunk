import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { state, access, mkdir } = vi.hoisted(() => ({
  state: {
    calls: [] as string[][],
    autoClose: true,
    child: null as (EventEmitter & { kill: ReturnType<typeof vi.fn> }) | null,
  },
  access: vi.fn(async () => undefined),
  mkdir: vi.fn(async () => undefined),
}));

vi.mock("child_process", () => ({
  spawn: vi.fn((_command: string, args: string[]) => {
    state.calls.push(args);
    const child = new EventEmitter() as EventEmitter & {
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };
    child.stderr = new EventEmitter();
    child.kill = vi.fn();
    state.child = child;
    if (state.autoClose) queueMicrotask(() => child.emit("close", 0));
    return child;
  }),
}));

vi.mock("fs/promises", () => ({
  access,
  mkdir,
  unlink: vi.fn(async () => undefined),
}));

import { convertMp4ToMkv, ensureFfmpegExists, mergeVideoAudio } from "./ffmpeg";

beforeEach(() => {
  state.calls.length = 0;
  state.autoClose = true;
  state.child = null;
  access.mockReset();
  access.mockResolvedValue(undefined);
  mkdir.mockClear();
});

it("aborts a mux without claiming completion before close, even with exit code zero", async () => {
  state.autoClose = false;
  const controller = new AbortController();
  const work = mergeVideoAudio(
    "/synthetic/video.mp4",
    "/synthetic/audio.mp4",
    "/synthetic/out.mkv",
    controller.signal
  );
  await vi.waitFor(() => expect(state.child).not.toBeNull());
  let settled = false;
  void work.then(() => {
    settled = true;
  });
  controller.abort();
  expect(state.child!.kill).toHaveBeenCalledWith("SIGTERM");
  expect(settled).toBe(false);
  state.child!.emit("close", 0);
  expect((await work).success).toBe(false);
});

it("never installs a missing FFmpeg binary during maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  vi.stubGlobal("fetch", vi.fn());
  access.mockRejectedValueOnce(new Error("missing"));
  try {
    expect(await ensureFfmpegExists()).toBe(false);
    expect(mkdir).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  }
});

describe("FFmpeg language metadata", () => {
  it.each(["foreign", "OV", "unknown", "multitrack"])(
    "does not invent German track metadata for %s inputs",
    async (fixture) => {
      const result = await convertMp4ToMkv(`/synthetic/${fixture}.mp4`, "/synthetic/output.mkv");

      expect(result.success).toBe(true);
      expect(state.calls).toHaveLength(1);
      expect(state.calls[0]).toEqual(
        expect.arrayContaining(["-map", "0:v", "-map", "0:a", "-c", "copy"])
      );
      expect(state.calls[0]).not.toContain("-metadata:s:a:0");
      expect(state.calls[0]).not.toContain("language=ger");
    }
  );

  it("keeps the HLS video/audio stream-copy mapping without a forged language", async () => {
    const result = await mergeVideoAudio(
      "/synthetic/video-only.mp4",
      "/synthetic/audio-only.m4a",
      "/synthetic/merged.mkv"
    );

    expect(result.success).toBe(true);
    expect(state.calls[0]).toEqual(
      expect.arrayContaining(["-map", "0:v:0", "-map", "1:a:0", "-c", "copy"])
    );
    expect(state.calls[0]).not.toContain("-metadata:s:a:0");
    expect(state.calls[0]).not.toContain("language=ger");
  });
});
