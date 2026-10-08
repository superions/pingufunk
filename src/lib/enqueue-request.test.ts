import { afterEach, expect, it, vi } from "vitest";
import {
  ENQUEUE_KEY_RETENTION_MS,
  MAX_NZB_BYTES,
  parseEnqueueKey,
  readNzbBody,
} from "./enqueue-request";

afterEach(() => vi.useRealTimers());
const request = (body: BodyInit, headers: HeadersInit = {}) =>
  new Request("http://example.invalid/api/download", {
    method: "POST",
    body,
    headers,
    duplex: "half",
  } as RequestInit);
const key = (time = Date.now()) => `7dc162f6-177c-4c4a-a8bb-bb425af0c159:${time}`;

it("accepts an optional canonical key, not an expired/future/oversized identity", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
  expect(parseEnqueueKey(null)).toBeUndefined();
  const current = key();
  expect(parseEnqueueKey(current.toUpperCase())).toBe(current);
  for (const value of [
    "",
    "bad",
    key(Date.now() + 60001),
    key(Date.now() - ENQUEUE_KEY_RETENTION_MS),
    key() + "x",
  ])
    expect(() => parseEnqueueKey(value)).toThrow();
});
it("accepts bounded UTF8 including split multibyte chunks without rewriting NZB text", async () => {
  const bytes = new TextEncoder().encode("<nzb>Äöü</nzb>");
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
      c.close();
    },
  });
  expect(await readNzbBody(request(body))).toBe("<nzb>Äöü</nzb>");
  expect(await readNzbBody(request("a".repeat(MAX_NZB_BYTES)))).toHaveLength(MAX_NZB_BYTES);
});
it("rejects oversized declared/chunked bodies, excessive chunks and invalid encoding", async () => {
  for (const input of [
    request("small", { "content-length": String(MAX_NZB_BYTES + 1) }),
    request("a".repeat(MAX_NZB_BYTES + 1)),
    request("small", { "content-length": "-1" }),
    request("small", { "content-encoding": "gzip" }),
    request(new Uint8Array([0xff])),
    request(""),
    request(
      new ReadableStream<Uint8Array>({
        start(c) {
          for (let i = 0; i < 4097; i++) c.enqueue(new Uint8Array([65]));
          c.close();
        },
      })
    ),
  ])
    await expect(readNzbBody(input)).rejects.toThrow();
});
it("keeps the absolute deadline even when a malicious stream never finishes cancellation", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const stream = new ReadableStream<Uint8Array>({ pull() {}, cancel });
  const pending = readNzbBody(request(stream));
  const assertion = expect(pending).rejects.toMatchObject({ status: 408 });
  await vi.advanceTimersByTimeAsync(15000);
  await assertion;
  expect(cancel).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});
it("aborts a pending read and removes its deadline without parsing or retrying", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const stream = new ReadableStream<Uint8Array>({ pull() {} });
  const input = new Request("http://example.invalid/api", {
    method: "POST",
    body: stream,
    signal: controller.signal,
    duplex: "half",
  } as RequestInit);
  const assertion = expect(readNzbBody(input)).rejects.toThrow("aborted");
  controller.abort();
  await assertion;
  expect(vi.getTimerCount()).toBe(0);
});
