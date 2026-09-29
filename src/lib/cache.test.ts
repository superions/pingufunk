import { beforeEach, expect, it, vi } from "vitest";

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { config: { findMany } } }));

import {
  clearTTLCache,
  getMetadataTTL,
  getSearchTTL,
  initCacheTTL,
  mediathekCache,
  tvdbCache,
} from "./cache";

beforeEach(() => {
  clearTTLCache();
  findMany.mockReset();
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
