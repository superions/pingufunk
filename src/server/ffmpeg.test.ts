import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

const { state } = vi.hoisted(() => ({ state: { calls: [] as string[][] } }));

vi.mock("child_process", () => ({
  spawn: vi.fn((_command: string, args: string[]) => {
    state.calls.push(args);
    const child = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit("close", 0));
    return child;
  }),
}));

vi.mock("fs/promises", () => ({
  access: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

import { convertMp4ToMkv, mergeVideoAudio } from "./ffmpeg";

beforeEach(() => {
  state.calls.length = 0;
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
