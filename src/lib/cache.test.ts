import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { config: { findMany } } }));

import {
  clearTTLCache,
  cacheMetadataMiss,
  coalesceMetadata,
  getMetadataTTL,
  hasMetadataMiss,
  getSearchTTL,
  initCacheTTL,
  mediathekCache,
  MetadataConcurrencyError,
  metadataCacheKey,
  tvdbCache,
} from "./cache";
import type { ApiResultItem } from "@/types";

beforeEach(() => {
  clearTTLCache();
  findMany.mockReset();
});

afterEach(() => vi.useRealTimers());

it("retains only definitive empty windows for at most fifteen seconds, never positive asset rows", async () => {
  vi.useFakeTimers();
  findMany.mockResolvedValue([{ key: "cache.ttl.search", value: "3600" }]);
  await initCacheTTL();
  mediathekCache.set("empty", { results: [] });
  mediathekCache.set("positive", {
    results: [{ url_video: "https://example.invalid/media.mp4" } as ApiResultItem],
  });
  expect(mediathekCache.get("empty")).toEqual({ results: [] });
  expect(mediathekCache.get("positive")).toBeUndefined();
  const clone = mediathekCache.get("empty")!;
  expect(clone).not.toBe(mediathekCache.get("empty"));
  vi.advanceTimersByTime(15_000);
  expect(mediathekCache.get("empty")).toBeUndefined();
});

it("bounds configured TTLs and rejects malformed values", async () => {
  findMany.mockResolvedValue([
    { key: "cache.ttl.search", value: "99999999" },
    { key: "cache.ttl.metadata", value: "not-a-number" },
  ]);
  await initCacheTTL();
  expect(getSearchTTL()).toBe(86400);
  expect(getMetadataTTL()).toBe(86400);
});

it("disables caching at zero TTL and invalidates entries on a TTL change", async () => {
  findMany.mockResolvedValue([
    { key: "cache.ttl.search", value: "0" },
    { key: "cache.ttl.metadata", value: "0" },
  ]);
  await initCacheTTL();
  mediathekCache.set("search", { results: [] });
  tvdbCache.set("metadata", { value: "x" });
  expect(mediathekCache.get("search")).toBeUndefined();
  expect(tvdbCache.get("metadata")).toBeUndefined();

  clearTTLCache();
  mediathekCache.set("search", { results: [] });
  expect(mediathekCache.get("search")).toEqual({ results: [] });
  clearTTLCache();
  expect(mediathekCache.get("search")).toBeUndefined();
});

it("separates provider, identity, credentials, instance and invalidation generations", () => {
  const priorInstance = process.env.DATABASE_URL;
  try {
    process.env.DATABASE_URL = "file:synthetic-instance-a";
    const key = metadataCacheKey("tvdb-series", 1, "first-credential");
    expect(metadataCacheKey("tmdb-series", 1, "first-credential")).not.toBe(key);
    expect(metadataCacheKey("tvdb-series", 2, "first-credential")).not.toBe(key);
    expect(metadataCacheKey("tvdb-series", 1, "rotated-credential")).not.toBe(key);
    process.env.DATABASE_URL = "file:synthetic-instance-b";
    expect(metadataCacheKey("tvdb-series", 1, "first-credential")).not.toBe(key);
    clearTTLCache();
    process.env.DATABASE_URL = "file:synthetic-instance-a";
    expect(metadataCacheKey("tvdb-series", 1, "first-credential")).not.toBe(key);
    expect(key).not.toContain("first-credential");
  } finally {
    if (priorInstance === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorInstance;
  }
});

it("coalesces concurrent metadata reads but not across a settings invalidation", async () => {
  let release!: (value: number) => void;
  const load = vi.fn(() => new Promise<number>((resolve) => (release = resolve)));
  const oldKey = metadataCacheKey("tvdb-series", 1, "credential");
  const first = coalesceMetadata(oldKey, load);
  const second = coalesceMetadata(oldKey, load);
  expect(load).toHaveBeenCalledTimes(1);
  clearTTLCache();
  const newKey = metadataCacheKey("tvdb-series", 1, "credential");
  const third = coalesceMetadata(newKey, async () => 2);
  release(1);
  expect(await Promise.all([first, second, third])).toEqual([1, 1, 2]);
});

it("bounds distinct in-flight metadata requests without starting the overflow loader", async () => {
  let release!: () => void;
  const gate = new Promise<number>((resolve) => (release = () => resolve(1)));
  const pending = Array.from({ length: 128 }, (_, index) =>
    coalesceMetadata(`bounded-${index}`, () => gate)
  );
  const overflow = vi.fn(async () => 2);
  await expect(coalesceMetadata("bounded-overflow", overflow)).rejects.toBeInstanceOf(
    MetadataConcurrencyError
  );
  expect(overflow).not.toHaveBeenCalled();
  release();
  expect(await Promise.all(pending)).toHaveLength(128);
  expect(await coalesceMetadata("bounded-overflow", overflow)).toBe(2);
});

it("expires a definitive metadata miss and disables it with zero TTL", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
  findMany.mockResolvedValue([]);
  await initCacheTTL();
  cacheMetadataMiss("missing");
  expect(hasMetadataMiss("missing")).toBe(true);
  vi.advanceTimersByTime(5 * 60 * 1000 + 1);
  expect(hasMetadataMiss("missing")).toBe(false);

  clearTTLCache();
  findMany.mockResolvedValue([{ key: "cache.ttl.metadata", value: "0" }]);
  await initCacheTTL();
  cacheMetadataMiss("disabled");
  expect(hasMetadataMiss("disabled")).toBe(false);
});
