import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { findUnique, findMany, create, upsert, searchMulti } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  searchMulti: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { topicCategory: { findUnique, findMany, create, upsert } },
}));
vi.mock("./tmdb", () => ({ searchMulti }));

import { getCategoriesForTopics, getCategoryForTopic } from "./category";

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
  searchMulti.mockResolvedValue({ mediaType: "tv", tmdbId: 7 });
});
afterEach(() => vi.unstubAllEnvs());

it("never persists a cache miss during PostgreSQL maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  expect(await getCategoryForTopic("synthetic")).toBe("tv");
  expect(await getCategoriesForTopics(["synthetic"])).toEqual(new Map([["synthetic", "tv"]]));
  expect(create).not.toHaveBeenCalled();
  expect(upsert).not.toHaveBeenCalled();
});

it("persists topic categories only after explicit write enablement", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
  expect(await getCategoryForTopic("synthetic")).toBe("tv");
  await getCategoriesForTopics(["synthetic"]);
  expect(create).toHaveBeenCalledTimes(1);
  expect(upsert).toHaveBeenCalledTimes(1);
});
