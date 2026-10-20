import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SourceMediaFactsStore } from "./source-media-facts";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";

const url = (index = 0) => `https://rodlzdf-a.akamaihd.net/synthetic/episode-${index}.mp4`;
const stores: SourceMediaFactsStore[] = [];
const store = () => {
  const value = new SourceMediaFactsStore();
  stores.push(value);
  return value;
};
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  for (const value of stores) value.clear();
  await Promise.all(stores.map((value) => value.idle()));
  stores.length = 0;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const facts = { audioLanguage: "de", videoDimensions: { width: 1920, height: 1080 } };
function rangeMock() {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    const response = mp4RangeResponse(syntheticMp4(), init);
    response.headers.set("etag", '"synthetic-asset"');
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

it("binds cloned hints to the full URL/selector, expires them and invalidates neutral RSS keys", async () => {
  const value = store(),
    original = value.contextKey;
  value.remember(url(), { facts, fingerprint: "a".repeat(64) });
  expect(value.contextKey).not.toBe(original);
  const result = value.get(url())!;
  result.facts.videoDimensions!.height = 720;
  expect(value.get(url())!.facts).toEqual(facts);
  expect(value.get(url() + "?audio=fr")).toBeUndefined();
  expect(value.get(url() + "?token=different")).toBeUndefined();
  expect(value.get(url(1))).toBeUndefined();
  await vi.advanceTimersByTimeAsync(300_001);
  expect(value.get(url())).toBeUndefined();
});

it("warms only allowlisted exact MP4s, deduplicates and never performs a full GET", async () => {
  const fetch = rangeMock(),
    value = store();
  value.enqueue([
    url(),
    url(),
    "http://127.0.0.1/a.mp4",
    url().replace(".net", ".net.evil.test"),
    url().replace(".mp4", ".m3u8"),
  ]);
  await vi.advanceTimersByTimeAsync(30);
  await value.idle();
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][1]).toMatchObject({
    headers: { Range: "bytes=0-1048575" },
    redirect: "error",
  });
  expect(value.get(url())).toMatchObject({
    facts,
    fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  value.enqueue([url()]);
  await vi.advanceTimersByTimeAsync(30);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("caps pending URLs and rate across separate worker runs without resetting the batch", async () => {
  const fetch = rangeMock(),
    value = store();
  value.enqueue([url()]);
  await vi.advanceTimersByTimeAsync(30);
  value.enqueue(Array.from({ length: 150 }, (_, i) => url(i + 1)));
  await vi.advanceTimersByTimeAsync(30);
  expect(fetch).toHaveBeenCalledTimes(8);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(fetch).toHaveBeenCalledTimes(16);
  await vi.advanceTimersByTimeAsync(240_000);
  expect(fetch).toHaveBeenCalledTimes(129);
  expect(new Set(fetch.mock.calls.map(([input]) => input)).size).toBe(129);
});

it("finishes a healthy source across the rate-window boundary without blocking or retrying it", async () => {
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    const response = mp4RangeResponse(syntheticMp4(), init);
    response.headers.set("etag", '"synthetic-asset"');
    return response;
  });
  vi.stubGlobal("fetch", fetch);
  const value = store(),
    checked = vi.fn();
  value.onChecked(checked);
  value.retain(
    Array.from({ length: 10 }, (_, i) => url(i)),
    Date.now() + 7_200_000
  );
  await vi.advanceTimersByTimeAsync(21_000);
  await value.idle();
  expect(fetch).toHaveBeenCalledTimes(10);
  expect(checked).toHaveBeenCalledTimes(10);
  for (let i = 0; i < 10; i++) expect(value.get(url(i))?.facts).toEqual(facts);
  expect(checked.mock.calls.every(([, result]) => result?.fingerprint)).toBe(true);
});

it("runs one warm probe and invalidates late replies without touching other processes", async () => {
  let finish!: (value: Response) => void;
  const fetch = vi.fn(
    (_url: string, _init: RequestInit) =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
  );
  vi.stubGlobal("fetch", fetch);
  const value = store();
  value.enqueue([url(), url(1)]);
  await vi.advanceTimersByTimeAsync(30);
  expect(fetch).toHaveBeenCalledTimes(1);
  const signal = fetch.mock.calls[0][1].signal!;
  expect(signal.aborted).toBe(false);
  value.clear();
  expect(signal.aborted).toBe(true);
  finish(mp4RangeResponse(syntheticMp4(), fetch.mock.calls[0][1]));
  await value.idle();
  expect(value.get(url())).toBeUndefined();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("does not turn a transport failure into a fact or automatically retry it", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const value = store();
  value.enqueue([url()]);
  await vi.advanceTimersByTimeAsync(30);
  await value.idle();
  expect(value.get(url())).toBeUndefined();
  value.enqueue([url()]);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("bounds cache capacity and keeps unsupported evidence short-lived", async () => {
  const value = store();
  for (let i = 0; i < 513; i++) value.remember(url(i), { facts, fingerprint: "a".repeat(64) });
  expect(value.get(url())).toBeUndefined();
  expect(value.get(url(512))?.facts).toEqual(facts);
  value.remember(url(999), { facts: { audioLanguage: null, videoDimensions: null } });
  expect(value.get(url(999))?.facts.audioLanguage).toBeNull();
  await vi.advanceTimersByTimeAsync(30_001);
  expect(value.get(url(999))).toBeUndefined();
  expect(value.get(url(512))?.facts).toEqual(facts);
});

it("refreshes retained successful proof before expiry across a normal 30-minute RSS interval", async () => {
  const fetch = rangeMock(),
    value = store();
  value.retain([url()], Date.now() + 7_200_000);
  await vi.advanceTimersByTimeAsync(1_800_000);
  expect(fetch.mock.calls.length).toBeGreaterThan(5);
  expect(fetch.mock.calls.length).toBeLessThan(12);
  expect(value.get(url(), 75_000)?.facts).toEqual(facts);
  expect(fetch.mock.calls.every(([, init]) => new Headers(init.headers).has("Range"))).toBe(true);
  value.release([url()]);
  const count = fetch.mock.calls.length;
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetch).toHaveBeenCalledTimes(count);
  expect(value.get(url())).toBeUndefined();
});

it("does not revive a failed retained URL on repeated enrollment", async () => {
  const fetch = vi.fn(async () => new Response(null, { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  const value = store();
  value.retain([url()], Date.now() + 7_200_000);
  await vi.advanceTimersByTimeAsync(30);
  await value.idle();
  value.retain([url()], Date.now() + 7_200_000);
  await vi.advanceTimersByTimeAsync(600_000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([{ codes: ["deu", "fra"] }, { codes: ["deu", "und"] }])(
  "never relabels incoherent tracks $codes",
  async ({ codes }) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const response = mp4RangeResponse(syntheticMp4(1920, 1080, codes), init);
        response.headers.set("etag", '"synthetic-asset"');
        return response;
      })
    );
    const value = store();
    value.enqueue([url()]);
    await vi.advanceTimersByTimeAsync(30);
    await value.idle();
    expect(value.get(url())?.facts).toEqual({
      audioLanguage: null,
      videoDimensions: facts.videoDimensions,
    });
  }
);
