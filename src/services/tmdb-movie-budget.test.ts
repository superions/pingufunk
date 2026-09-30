import { beforeEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { clearMetadataCaches } from "@/lib/cache";
import { getMovieInfoByImdbId, getMovieInfoByTmdbId } from "./tmdb";
const { fetchWithRetry } = vi.hoisted(() => ({ fetchWithRetry: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => "eyJ.synthetic.movie") }));
vi.mock("@/lib/fetch-retry", async (original) => ({
  ...(await original<typeof import("@/lib/fetch-retry")>()),
  fetchWithRetry,
}));
const movie = () => ({
  id: 42,
  imdb_id: "tt0000042",
  title: "Film",
  original_title: "Original Film",
  runtime: 90,
  release_date: "1998-01-01",
});
beforeEach(() => {
  clearMetadataCaches();
  fetchWithRetry.mockReset();
});

it("shares the caller budget across IMDb resolution and both localized movie reads", async () => {
  fetchWithRetry.mockImplementation(async (url: string, _init, options) => {
    options.requestBudget.takeAttempt();
    return Response.json(url.includes("/find/") ? { movie_results: [{ id: 42 }] } : movie());
  });
  const budget = new HttpRequestBudget(3);
  expect((await getMovieInfoByImdbId("tt0000042", budget))?.tmdbId).toBe(42);
  expect(budget.remainingAttempts).toBe(0);
  expect(fetchWithRetry.mock.calls.every((call) => call[2].requestBudget === budget)).toBe(true);
});

it("rejects an ambiguous IMDb result without adopting its first movie", async () => {
  fetchWithRetry.mockResolvedValue(Response.json({ movie_results: [{ id: 42 }, { id: 43 }] }));
  await expect(getMovieInfoByImdbId("tt0000042", new HttpRequestBudget())).rejects.toThrow();
  expect(fetchWithRetry).toHaveBeenCalledTimes(1);
});

it("does not cache a wrong localized identity or an upstream outage as empty success", async () => {
  fetchWithRetry
    .mockResolvedValueOnce(Response.json(movie()))
    .mockResolvedValueOnce(Response.json({ ...movie(), imdb_id: "tt0000043" }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }))
    .mockResolvedValueOnce(Response.json(movie()))
    .mockResolvedValueOnce(Response.json(movie()));
  await expect(getMovieInfoByTmdbId(42, new HttpRequestBudget())).rejects.toThrow();
  await expect(getMovieInfoByTmdbId(42, new HttpRequestBudget())).rejects.toThrow();
  expect((await getMovieInfoByTmdbId(42, new HttpRequestBudget()))?.imdbId).toBe("tt0000042");
  expect(fetchWithRetry).toHaveBeenCalledTimes(5);
});

it("preserves unknown date and runtime instead of inventing evidence", async () => {
  fetchWithRetry.mockImplementation(async () =>
    Response.json({ ...movie(), runtime: null, release_date: null })
  );
  expect(await getMovieInfoByTmdbId(42, new HttpRequestBudget())).toMatchObject({
    runtime: null,
    releaseDate: null,
  });
});
