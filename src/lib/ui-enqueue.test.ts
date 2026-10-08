import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { ENQUEUE_KEY_HEADER, ENQUEUE_KEY_RETENTION_MS } from "./enqueue-request";
import { enqueueUiNzb } from "./ui-enqueue";

const storageKey = "pingufunk.enqueue.v1";
let map: Map<string, string>;
let storage: Storage;
const request = {
  nzb: "<nzb>opaque synthetic private URL</nzb>",
  fingerprint: "a".repeat(64),
  category: "tv" as const,
};
const fetchMock = vi.fn<typeof fetch>();
const ack = (id = "synthetic-job") => new Response(JSON.stringify({ status: true, nzo_ids: [id] }));
const sentKey = (index: number) =>
  new Headers(fetchMock.mock.calls[index][1]?.headers).get(ENQUEUE_KEY_HEADER);
beforeEach(() => {
  map = new Map();
  storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  };
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  // Plain HTTP needs neither randomUUID nor SubtleCrypto.
  vi.stubGlobal("crypto", { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("persists only opaque intent/fingerprint before sending, preserves it across reload after a lost response", async () => {
  fetchMock.mockImplementationOnce(async () => {
    expect(map.get(storageKey)).not.toContain(request.nzb);
    expect(map.get(storageKey)).not.toContain("private URL");
    throw new TypeError("Synthetic lost committed response");
  });
  await expect(enqueueUiNzb(request, false, storage)).rejects.toThrow("nicht bestätigt");
  expect(fetchMock).toHaveBeenCalledOnce();
  const first = sentKey(0);
  vi.resetModules();
  const { enqueueUiNzb: reloaded } = await import("./ui-enqueue");
  fetchMock.mockResolvedValueOnce(ack());
  expect(await reloaded(request, false, storage)).toBe("synthetic-job");
  expect(sentKey(1)).toBe(first);
  expect(JSON.parse(map.get(storageKey)!)).toEqual({});
  fetchMock.mockResolvedValueOnce(ack("new-explicit-job"));
  expect(await reloaded(request, false, storage)).toBe("new-explicit-job");
  expect(sentKey(2)).not.toBe(first);
});
it("prevents concurrent clicks without a second request; does not automatically retry", async () => {
  let resolve!: (response: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise((r) => {
        resolve = r;
      })
  );
  const first = enqueueUiNzb(request, false, storage);
  await expect(enqueueUiNzb(request, false, storage)).rejects.toThrow("bereits");
  expect(fetchMock).toHaveBeenCalledOnce();
  resolve(ack());
  await first;
});
it.each([409, 500, 503])(
  "retains the same key after HTTP %s, and creates a different one only on an explicit new intent",
  async (status) => {
    fetchMock.mockResolvedValueOnce(new Response("synthetic", { status }));
    await expect(enqueueUiNzb(request, false, storage)).rejects.toThrow();
    const first = sentKey(0);
    fetchMock.mockResolvedValueOnce(ack());
    await enqueueUiNzb(request, true, storage);
    expect(sentKey(1)).not.toBe(first);
  }
);
it.each([
  { status: false },
  { status: true, nzo_ids: [] },
  { status: true, nzo_ids: ["../escape"] },
  { status: true, nzo_ids: ["one", "two"] },
])("does not treat malformed acknowledgement as success: %j", async (value) => {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(value)));
  await expect(enqueueUiNzb(request, false, storage)).rejects.toThrow();
  expect(Object.keys(JSON.parse(map.get(storageKey)!))).toHaveLength(1);
});
it("fails closed on expired keys, corrupt/full/unwritable storage before sending", async () => {
  const identity = request.fingerprint + ":tv";
  for (const raw of [
    "invalid",
    JSON.stringify({
      [identity]: `7dc162f6-177c-4c4a-a8bb-bb425af0c159:${Date.now() - ENQUEUE_KEY_RETENTION_MS}`,
    }),
    JSON.stringify(
      Object.fromEntries(
        Array.from({ length: 64 }, (_, i) => [
          `b${String(i).padStart(63, "0")}:tv`,
          `7dc162f6-177c-4c4a-a8bb-bb425af0c159:${Date.now()}`,
        ])
      )
    ),
  ]) {
    map.set(storageKey, raw);
    await expect(enqueueUiNzb(request, false, storage)).rejects.toThrow();
  }
  map.clear();
  const denied = {
    ...storage,
    setItem() {
      throw new Error("Synthetic unavailable storage");
    },
  };
  await expect(enqueueUiNzb(request, false, denied)).rejects.toThrow();
  expect(fetchMock).not.toHaveBeenCalled();
});
it("does not merge different qualities or categories by title or URL", async () => {
  fetchMock.mockRejectedValue(new TypeError("Synthetic uncertainty"));
  for (const value of [
    request,
    { ...request, fingerprint: "c".repeat(64) },
    { ...request, category: "movie" as const },
  ])
    await expect(enqueueUiNzb(value, false, storage)).rejects.toThrow();
  expect(new Set([sentKey(0), sentKey(1), sentKey(2)]).size).toBe(3);
  expect(Object.keys(JSON.parse(map.get(storageKey)!))).toHaveLength(3);
});
