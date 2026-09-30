import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const settings = vi.hoisted(() => new Map<string, string>());
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => settings.get(key) ?? null,
  getSettings: async (keys: string[]) =>
    Object.fromEntries(keys.map((key) => [key, settings.get(key) ?? null])),
}));

beforeEach(() => {
  vi.resetModules();
  settings.clear();
  settings.set("api.tvdb.key", "synthetic-key");
  settings.set("api.tmdb.key", "eyJ.synthetic-key");
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const tvdbSeries = (id = 7) => ({
  status: "success",
  data: {
    id,
    name: "Synthetic series",
    nameTranslations: ["eng", "deu"],
    aliases: [],
    episodes: [{ name: "Pilot", seasonNumber: 1, number: 1, runtime: null, aired: null }],
  },
});
const tmdbResponse = (url: string, seasons = 1): Response => {
  if (url.includes("/find/")) return Response.json({ tv_results: [{ id: 9 }] });
  if (url.includes("/season/"))
    return Response.json({
      episodes: [
        {
          name: "Pilot",
          season_number: Number(url.match(/season\/(\d+)/)?.[1]),
          episode_number: 1,
          runtime: null,
          air_date: null,
        },
      ],
    });
  return Response.json({
    id: 9,
    name: "Synthetic series",
    original_name: "Synthetic series",
    seasons: Array.from({ length: seasons }, (_, index) => ({ season_number: index + 1 })),
  });
};

it("uses one real attempt budget for catalogue refresh, TVDB login and series read", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("raw.githubusercontent.com")) return Response.json([]);
    if (url.endsWith("/login"))
      return Response.json({ status: "success", data: { token: "synthetic-token" } });
    return Response.json(tvdbSeries());
  });
  vi.stubGlobal("fetch", fetchMock);
  const { getBaseShowInfoByTvdbId } = await import("./shows");
  const budget = new HttpRequestBudget(3);
  expect(await getBaseShowInfoByTvdbId(7, budget)).toMatchObject({
    id: 7,
    episodes: [{ runtime: null }],
  });
  expect(budget.remainingAttempts).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(3);
});

it("does not reset an exhausted caller budget after a catalogue read", async () => {
  const fetchMock = vi.fn(async () => Response.json([]));
  vi.stubGlobal("fetch", fetchMock);
  const { getBaseShowInfoByTvdbId } = await import("./shows");
  await expect(getBaseShowInfoByTvdbId(7, new HttpRequestBudget(1))).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("recovers via configured TMDB after TVDB retries using only the remaining shared budget", async () => {
  const fetchMock = vi.fn(async (url: string) => {
    if (url.includes("raw.githubusercontent.com")) return Response.json([]);
    if (url.endsWith("/login"))
      return Response.json({ status: "success", data: { token: "synthetic-token" } });
    if (url.includes("thetvdb.com")) return new Response(null, { status: 503 });
    return tmdbResponse(url);
  });
  vi.stubGlobal("fetch", fetchMock);
  const { getBaseShowInfoByTvdbId } = await import("./shows");
  const budget = new HttpRequestBudget();
  expect((await getBaseShowInfoByTvdbId(7, budget))?.episodes).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(8);
  expect(budget.remainingAttempts).toBe(2);
});

it("shares the real TMDB budget across find, details and every season, without caching partial metadata", async () => {
  const fetchMock = vi.fn(async (url: string) => tmdbResponse(url, 2));
  vi.stubGlobal("fetch", fetchMock);
  const { getShowInfoByTvdbId } = await import("./tmdb");
  await expect(getShowInfoByTvdbId(7, new HttpRequestBudget(3))).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  const budget = new HttpRequestBudget(4);
  expect((await getShowInfoByTvdbId(7, budget))?.episodes).toHaveLength(2);
  expect(budget.remainingAttempts).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(7);
});

it("rejects a foreign TVDB identity and retries rather than caching it", async () => {
  let foreign = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      url.endsWith("/login")
        ? Response.json({ status: "success", data: { token: "synthetic-token" } })
        : Response.json(tvdbSeries(foreign ? 8 : 7))
    )
  );
  const { getShowInfoByTvdbId } = await import("./tvdb");
  await expect(getShowInfoByTvdbId(7, new HttpRequestBudget())).rejects.toThrow();
  foreign = false;
  expect((await getShowInfoByTvdbId(7, new HttpRequestBudget()))?.id).toBe(7);
});

it("rejects ambiguous TMDB resolution before reading an arbitrary first series", async () => {
  const fetchMock = vi.fn(async () => Response.json({ tv_results: [{ id: 9 }, { id: 10 }] }));
  vi.stubGlobal("fetch", fetchMock);
  const { getShowInfoByTvdbId } = await import("./tmdb");
  await expect(getShowInfoByTvdbId(7, new HttpRequestBudget())).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("bounds a TVDB body and does not expose its contents in diagnostics", async () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const fetchMock = vi.fn(async (url: string) =>
    url.endsWith("/login")
      ? Response.json({ status: "success", data: { token: "synthetic-token" } })
      : new Response("synthetic-private-body", {
          headers: { "content-length": String(8 * 1024 * 1024 + 1) },
        })
  );
  vi.stubGlobal("fetch", fetchMock);
  const { getShowInfoByTvdbId } = await import("./tvdb");
  await expect(getShowInfoByTvdbId(7, new HttpRequestBudget())).rejects.toThrow(
    "Invalid provider response"
  );
  expect(JSON.stringify(log.mock.calls)).not.toContain("synthetic-private-body");
});
