import { beforeEach, expect, it, vi } from "vitest";

const { setting, fetchWithRetry } = vi.hoisted(() => ({
  setting: { token: "eyJ.synthetic.first" },
  fetchWithRetry: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => setting.token) }));
vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry }));
vi.mock("@/lib/db", () => ({ prisma: { config: { findMany: vi.fn(async () => []) } } }));

import { clearTTLCache } from "@/lib/cache";
import { getMovieInfoByTmdbId, getShowInfoByTvdbId, searchMovieByTitle } from "./tmdb";

beforeEach(() => {
  clearTTLCache();
  setting.token = "eyJ.synthetic.first";
  fetchWithRetry.mockReset();
});

function seriesResponse(id: number): Response {
  return Response.json({
    id,
    name: `Show ${id}`,
    original_name: `Original ${id}`,
    seasons: [{ season_number: 1, episode_count: 1 }],
  });
}

it("coalesces a series fetch, then misses after credential rotation", async () => {
  fetchWithRetry.mockImplementation(async (url: string) => {
    if (url.includes("/find/")) return Response.json({ tv_results: [{ id: 9, name: "Show" }] });
    if (url.includes("/season/")) {
      return Response.json({ episodes: [{ name: "Pilot", season_number: 1, episode_number: 1 }] });
    }
    return seriesResponse(9);
  });

  const [first, concurrent] = await Promise.all([getShowInfoByTvdbId(7), getShowInfoByTvdbId(7)]);
  expect(first).toEqual(concurrent);
  expect(first?.episodes).toHaveLength(1);
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);
  expect(await getShowInfoByTvdbId(7)).toEqual(first);
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);

  setting.token = "eyJ.synthetic.second";
  await getShowInfoByTvdbId(7);
  expect(fetchWithRetry).toHaveBeenCalledTimes(6);
});

it("briefly caches only a confirmed empty result, never a transient failure or malformed payload", async () => {
  fetchWithRetry.mockResolvedValueOnce(new Response(null, { status: 503 }));
  expect(await getShowInfoByTvdbId(8)).toBeNull();
  fetchWithRetry.mockResolvedValueOnce(Response.json({ tv_results: "invalid" }));
  expect(await getShowInfoByTvdbId(8)).toBeNull();
  fetchWithRetry.mockResolvedValueOnce(Response.json({ tv_results: [] }));
  expect(await getShowInfoByTvdbId(8)).toBeNull();
  expect(await getShowInfoByTvdbId(8)).toBeNull();
  expect(fetchWithRetry).toHaveBeenCalledTimes(3);
});

it("does not cache a partial series when a season fails", async () => {
  fetchWithRetry.mockImplementation(async (url: string) => {
    if (url.includes("/find/")) return Response.json({ tv_results: [{ id: 9, name: "Show" }] });
    if (url.includes("/season/")) return new Response(null, { status: 503 });
    return seriesResponse(9);
  });
  expect(await getShowInfoByTvdbId(9)).toBeNull();
  expect(await getShowInfoByTvdbId(9)).toBeNull();
  expect(fetchWithRetry).toHaveBeenCalledTimes(6);
});

it("coalesces movie lookup and does not cache an incomplete localized response", async () => {
  fetchWithRetry.mockImplementation(async (url: string) => {
    if (url.includes("language=de-DE")) return new Response(null, { status: 503 });
    return Response.json({
      id: 3,
      imdb_id: null,
      title: "Movie",
      original_title: "Original",
      runtime: 90,
      release_date: "2025-01-01",
    });
  });
  expect(await Promise.all([getMovieInfoByTmdbId(3), getMovieInfoByTmdbId(3)])).toEqual([
    null,
    null,
  ]);
  expect(fetchWithRetry).toHaveBeenCalledTimes(2);
  await getMovieInfoByTmdbId(3);
  expect(fetchWithRetry).toHaveBeenCalledTimes(4);
});

it("separates movie search keys by year and bounds confirmed misses", async () => {
  fetchWithRetry.mockResolvedValue(Response.json({ results: [] }));
  expect(await searchMovieByTitle("Film", 2025)).toBeNull();
  expect(await searchMovieByTitle("Film", 2025)).toBeNull();
  expect(await searchMovieByTitle("Film", 2026)).toBeNull();
  expect(fetchWithRetry).toHaveBeenCalledTimes(2);
});
