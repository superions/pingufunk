import { beforeEach, expect, it, vi } from "vitest";

const { seriesCount, episodeCount, seriesDelete, episodeDelete, clearCaches } = vi.hoisted(() => ({
  seriesCount: vi.fn(),
  episodeCount: vi.fn(),
  seriesDelete: vi.fn(),
  episodeDelete: vi.fn(),
  clearCaches: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    tvdbSeries: { count: seriesCount, deleteMany: seriesDelete },
    tvdbEpisode: { count: episodeCount, deleteMany: episodeDelete },
  },
}));
vi.mock("@/lib/cache", () => ({
  mediathekCache: { clear: clearCaches },
  clearMetadataCaches: clearCaches,
  rulesetsCache: { clear: clearCaches },
}));

import { DELETE, GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  seriesCount.mockResolvedValue(3);
  episodeCount.mockResolvedValue(12);
});

it("preserves historical database rows when clearing only transient memory caches", async () => {
  const result = await DELETE();
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({
    success: true,
    cleared: { legacyDatabaseRows: "preserved" },
  });
  expect(clearCaches).toHaveBeenCalledTimes(3);
  expect(seriesDelete).not.toHaveBeenCalled();
  expect(episodeDelete).not.toHaveBeenCalled();
  expect(seriesCount).not.toHaveBeenCalled();
  expect(episodeCount).not.toHaveBeenCalled();
});

it("reports the historical row counts without mutating them", async () => {
  expect(await (await GET()).json()).toEqual({ tvdbSeries: 3, tvdbEpisodes: 12 });
  expect(seriesDelete).not.toHaveBeenCalled();
  expect(episodeDelete).not.toHaveBeenCalled();
});
