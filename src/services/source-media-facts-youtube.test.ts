import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock("@/providers/youtube/resolve", () => ({ resolveYoutubeMedia: state.resolve }));
vi.mock("./youtube-bindings", () => ({ assertCurrentYoutubeDiscovery: async () => {} }));
import { SourceMediaFactsStore } from "./source-media-facts";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";
import type { YoutubeSourceIdentity } from "@/lib/youtube-source";
const source = (i = 0): YoutubeSourceIdentity => ({
  version: 1,
  family: "youtube",
  videoId: String(i).padStart(11, "0"),
  channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlistId: "PLsynthetic123456",
  mappingRevision: "a".repeat(64),
  programme: { kind: "series", targetId: 42, season: 1, episode: i + 1 },
  originalTitle: "Synthetic source " + i,
});
const selection = {
  videoFormat: "137",
  audioFormat: "140-1",
  audioTrack: "140-1",
  language: "de",
  width: 1920,
  height: 1080,
  duration: 120,
};
let store: SourceMediaFactsStore;
beforeEach(() => {
  vi.useFakeTimers();
  store = new SourceMediaFactsStore();
  state.resolve.mockReset();
  state.resolve.mockResolvedValue({
    selection,
    videoUrl: "never-persisted",
    audioUrl: "never-persisted",
    size: 0,
  });
});
afterEach(async () => {
  store.clear();
  await store.idle();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("bounds detail processes to twelve per rolling minute while still serving queued and newly arriving Mediathek evidence", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const response = mp4RangeResponse(syntheticMp4(), init);
    response.headers.set("etag", '"synthetic"');
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  store.enqueue(Array.from({ length: 14 }, (_, i) => source(i)));
  await vi.advanceTimersByTimeAsync(30);
  expect(state.resolve).toHaveBeenCalledTimes(12);
  store.enqueue(["https://rodlzdf-a.akamaihd.net/synthetic/fair.mp4"]);
  await vi.advanceTimersByTimeAsync(30);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(state.resolve).toHaveBeenCalledTimes(12);
  await vi.advanceTimersByTimeAsync(60000);
  await store.idle();
  expect(state.resolve).toHaveBeenCalledTimes(14);
  expect(store.get(source())?.sourceRef?.selection).toEqual(selection);
  expect(JSON.stringify(store.get(source()))).not.toContain("never-persisted");
});
it("owns one detail process and rejects late replies after cancellation without clearing another source", async () => {
  let complete!: (value: unknown) => void;
  state.resolve.mockImplementation(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  store.enqueue([source(), source(1)]);
  await vi.advanceTimersByTimeAsync(30);
  expect(state.resolve).toHaveBeenCalledTimes(1);
  const signal = state.resolve.mock.calls[0][1] as AbortSignal;
  store.clear();
  expect(signal.aborted).toBe(true);
  complete({ selection, videoUrl: "private", audioUrl: "private", size: 0 });
  await store.idle();
  expect(store.get(source())).toBeUndefined();
  expect(state.resolve).toHaveBeenCalledTimes(1);
});
it("quarantines a failed typed discovery without retry, and never accepts a changed programme binding as its proof", async () => {
  state.resolve.mockRejectedValue(Error("synthetic unavailable"));
  const checked = vi.fn();
  store.onChecked(checked);
  store.retain([source()], Date.now() + 7200000);
  await vi.advanceTimersByTimeAsync(30);
  expect(checked).toHaveBeenCalledWith(source());
  await vi.advanceTimersByTimeAsync(120000);
  expect(state.resolve).toHaveBeenCalledTimes(1);
  expect(store.get(source())).toBeUndefined();
  expect(store.get({ ...source(), mappingRevision: "b".repeat(64) })).toBeUndefined();
});
it("does not reuse an earlier positive hint after a fresh retained source has failed", async () => {
  store.retain([source()], Date.now() + 7200000);
  await vi.advanceTimersByTimeAsync(30);
  await store.idle();
  expect(store.get(source())?.sourceRef).toBeDefined();
  state.resolve.mockRejectedValue(Error("fresh selection failed"));
  await vi.advanceTimersByTimeAsync(900000);
  expect(store.get(source())).toBeUndefined();
});
it("finishes and keeps all 97 retained canonical targets warm across a regular RSS interval within the declared process rate", async () => {
  const sources = Array.from({ length: 97 }, (_, i) => source(i));
  store.enqueue(sources);
  store.retain(sources, Date.now() + 7200000);
  await vi.advanceTimersByTimeAsync(9 * 60000);
  expect(state.resolve).toHaveBeenCalledTimes(97);
  for (const item of sources)
    expect(
      store.get(item, 75000)?.sourceRef,
      `${item.videoId}: calls ${state.resolve.mock.calls.length}`
    ).toBeDefined();
  await vi.advanceTimersByTimeAsync(21 * 60000);
  for (const item of sources)
    expect(
      store.get(item, 75000)?.sourceRef,
      `${item.videoId}: calls ${state.resolve.mock.calls.length}`
    ).toBeDefined();
  const calls = state.resolve.mock.calls.map((call) => call[1] as AbortSignal);
  expect(calls.every((signal) => !signal.aborted)).toBe(true);
});
