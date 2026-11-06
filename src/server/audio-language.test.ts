import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { unknownJobMediaExpectations } from "@/lib/media-expectations";
import type { WorkerLease } from "./worker-lease";

const mocks = vi.hoisted(() => ({ read: vi.fn(), verify: vi.fn(), correct: vi.fn() }));
vi.mock("./bounded-process", () => ({ readBoundedProcess: mocks.read }));
vi.mock("@/services/source-audio", () => ({ verifySourceAudio: mocks.verify }));
vi.mock("./ffmpeg", () => ({ correctGermanAudioTag: mocks.correct }));

import { correctAudioLanguage } from "./audio-language";

const expectations = {
  ...unknownJobMediaExpectations(),
  sourceAudio: {
    provider: "ard_media" as const,
    videoId: "synthetic_video_1234",
    mediaIdentity: "a".repeat(64),
    language: "de",
  },
};
const sourceUrl = "https://example.invalid/synthetic.mp4";
let root: string;
let file: string;
let controller: AbortController;
let lease: WorkerLease;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pingufunk-audio-language-"));
  file = path.join(root, "download.mp4");
  await writeFile(file, "original bytes");
  controller = new AbortController();
  lease = {
    signal: controller.signal,
    checkTransfer: () => controller.signal.throwIfAborted(),
  } as WorkerLease;
  mocks.read.mockReset().mockResolvedValue({
    state: "ok",
    output: JSON.stringify({ streams: [{ tags: { language: "eng" } }] }),
  });
  mocks.verify.mockReset().mockResolvedValue(expectations.sourceAudio);
  mocks.correct.mockReset().mockImplementation(async (_input: string, output: string) => {
    await writeFile(output, "copied with corrected label");
  });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it.each(["eng", undefined])(
  "corrects one track marked %s only after source evidence is confirmed",
  async (language) => {
    mocks.read.mockResolvedValue({
      state: "ok",
      output: JSON.stringify({ streams: [language ? { tags: { language } } : {}] }),
    });
    await correctAudioLanguage(file, root, sourceUrl, expectations, lease);
    expect(mocks.verify).toHaveBeenCalledWith(
      expectations.sourceAudio,
      sourceUrl,
      expect.anything(),
      controller.signal
    );
    expect(mocks.correct).toHaveBeenCalledOnce();
    expect(await readFile(file, "utf8")).toBe("copied with corrected label");
  }
);

it("does nothing when there is no proven source language", async () => {
  await correctAudioLanguage(file, root, sourceUrl, null, lease);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.correct).not.toHaveBeenCalled();
  expect(await readFile(file, "utf8")).toBe("original bytes");
});

it.each([
  ["already German", [{ tags: { language: "deu" } }]],
  ["multiple audio tracks", [{ tags: { language: "eng" } }, { tags: { language: "deu" } }]],
  ["no audio tracks", []],
  ["invalid track information", [null]],
])("leaves %s unchanged", async (_description, streams) => {
  mocks.read.mockResolvedValue({ state: "ok", output: JSON.stringify({ streams }) });
  await correctAudioLanguage(file, root, sourceUrl, expectations, lease);
  expect(mocks.verify).not.toHaveBeenCalled();
  expect(mocks.correct).not.toHaveBeenCalled();
  expect(await readFile(file, "utf8")).toBe("original bytes");
});

it.each(["probe", "source", "mux"])(
  "retains the downloaded file if the %s needed for tagging fails",
  async (failure) => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    if (failure === "probe") mocks.read.mockResolvedValue({ state: "failed", output: "" });
    if (failure === "source") mocks.verify.mockRejectedValue(new Error("source unavailable"));
    if (failure === "mux") mocks.correct.mockRejectedValue(new Error("copy failed"));
    try {
      await expect(correctAudioLanguage(file, root, sourceUrl, expectations, lease)).resolves.toBe(
        undefined
      );
      expect(await readFile(file, "utf8")).toBe("original bytes");
      expect(warning).toHaveBeenCalled();
    } finally {
      warning.mockRestore();
    }
  }
);

it("does not replace the original when the worker is interrupted", async () => {
  mocks.correct.mockImplementation(async (_input: string, output: string) => {
    await writeFile(output, "unfinished copy");
    controller.abort();
  });
  await expect(correctAudioLanguage(file, root, sourceUrl, expectations, lease)).rejects.toThrow();
  expect(await readFile(file, "utf8")).toBe("original bytes");
});
