import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getRadarrMovie, getRadarrMonitoredMovies, parseRadarrMovie } from "./radarr-provider";
import { getSetting } from "@/lib/settings";
import { clearMetadataCaches } from "@/lib/cache";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { externalCredential } from "@/lib/credential-settings";
import { validateRadarrSetting } from "@/lib/radarr-settings";

vi.mock("@/lib/settings", () => ({ getSetting: vi.fn() }));
vi.mock("@/lib/credential-settings", () => ({ externalCredential: vi.fn() }));
const movie = () => ({
  tmdbId: 28,
  imdbId: "tt0000028",
  title: "Synthetic film",
  originalTitle: "Original film",
  year: 2001,
  runtime: 2,
  alternateTitles: [{ title: "Verified alias" }],
  path: "/must-not-leave-adapter",
  apiKey: "must-not-leave-adapter",
});
beforeEach(() => {
  clearMetadataCaches();
  vi.mocked(getSetting).mockImplementation(async (key) =>
    key === "integration.radarr.enabled"
      ? "true"
      : key === "integration.radarr.url"
        ? "https://arr.invalid/base/radarr"
        : null
  );
  vi.mocked(externalCredential).mockResolvedValue({ configured: true, value: "synthetic-secret" });
});
afterEach(() => vi.restoreAllMocks());

it("maps only identity metadata and keeps year distinct from a fabricated date", () => {
  expect(parseRadarrMovie(movie())).toEqual({
    tmdbId: 28,
    imdbId: "tt0000028",
    title: "Original film",
    germanTitle: "Synthetic film",
    aliases: ["Verified alias"],
    productionYear: 2001,
    runtime: 2,
    releaseDate: null,
  });
  expect(parseRadarrMovie({ ...movie(), runtime: 0 }).runtime).toBeNull();
  expect(() => parseRadarrMovie({ ...movie(), tmdbId: 0 })).toThrow(
    "Optional movie metadata unavailable"
  );
});

it("does no credential I/O or HTTP when disabled", async () => {
  vi.mocked(getSetting).mockResolvedValue(null);
  vi.mocked(externalCredential).mockClear();
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(await getRadarrMovie(28, null, new HttpRequestBudget())).toBeNull();
  expect(externalCredential).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("preserves subpaths and shares a GET-only authenticated budget with identity readback", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0.1234" }))
    .mockResolvedValueOnce(Response.json([movie()]));
  const budget = new HttpRequestBudget(2);
  const result = await getRadarrMovie(28, "tt0000028", budget);
  expect(result?.aliases).toEqual(["Verified alias"]);
  expect(budget.remainingAttempts).toBe(0);
  expect(fetch.mock.calls.map(([url]) => String(url))).toEqual([
    "https://arr.invalid/base/radarr/api/v3/system/status",
    "https://arr.invalid/base/radarr/api/v3/movie?tmdbId=28",
  ]);
  for (const [, init] of fetch.mock.calls) {
    expect(init).toMatchObject({
      method: "GET",
      redirect: "error",
      headers: { "X-Api-Key": "synthetic-secret" },
    });
  }
  expect(await getRadarrMovie(28, "tt0000028", new HttpRequestBudget(1))).toEqual(result);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("uses the IMDb lookup without assuming a local library ID", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(Response.json(movie()));
  expect((await getRadarrMovie(null, "tt0000028", new HttpRequestBudget(2)))?.tmdbId).toBe(28);
  expect(String(fetch.mock.calls[1][0])).toContain("lookup/imdb?imdbId=tt0000028");
});

it("uses a remote lookup only for a schema-valid empty local library result", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json(movie()));
  expect((await getRadarrMovie(28, null, new HttpRequestBudget(3)))?.tmdbId).toBe(28);
  expect(String(fetch.mock.calls[2][0])).toContain("movie/lookup/tmdb?tmdbId=28");
});

it.each([{}, [movie(), movie()]])(
  "rejects a malformed local lookup without calling Skyhook",
  async (payload) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
      .mockResolvedValueOnce(Response.json(payload));
    await expect(getRadarrMovie(28, null, new HttpRequestBudget(3))).rejects.toThrow(
      "Optional movie metadata unavailable"
    );
    expect(fetch).toHaveBeenCalledTimes(2);
  }
);

it.each([
  { ...movie(), tmdbId: 29 },
  { ...movie(), imdbId: "tt0000029" },
  { ...movie(), year: 0 },
  { ...movie(), runtime: -1 },
])(
  "rejects malformed or conflicting identity without caching successful emptiness",
  async (payload) => {
    const fetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
      .mockResolvedValueOnce(Response.json([payload]))
      .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
      .mockResolvedValueOnce(Response.json([movie()]));
    await expect(getRadarrMovie(28, "tt0000028", new HttpRequestBudget(2))).rejects.toThrow(
      "Optional movie metadata unavailable"
    );
    expect((await getRadarrMovie(28, "tt0000028", new HttpRequestBudget(2)))?.tmdbId).toBe(28);
    expect(fetch).toHaveBeenCalledTimes(4);
  }
);

it("fails closed on unsupported versions, configuration and exhausted budgets", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ version: "99.0.0" }));
  await expect(getRadarrMovie(28, null, new HttpRequestBudget(1))).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  expect(fetch).toHaveBeenCalledTimes(1);
  fetch.mockClear();
  vi.mocked(externalCredential).mockResolvedValue({ configured: false, value: null });
  await expect(getRadarrMovie(28, null, new HttpRequestBudget(1))).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  expect(fetch).not.toHaveBeenCalled();
  vi.mocked(externalCredential).mockResolvedValue({ configured: true, value: "synthetic-secret" });
  const budget = new HttpRequestBudget(1);
  budget.takeAttempt();
  await expect(getRadarrMovie(28, null, budget)).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  expect(fetch).not.toHaveBeenCalled();
});

it("invalidates snapshots after credential rotation and settings epoch changes", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(String(url).includes("system/status") ? { version: "6.0.0" } : [movie()])
    );
  await getRadarrMovie(28, null, new HttpRequestBudget(2));
  vi.mocked(externalCredential).mockResolvedValue({ configured: true, value: "synthetic-rotated" });
  await getRadarrMovie(28, null, new HttpRequestBudget(2));
  clearMetadataCaches();
  await getRadarrMovie(28, null, new HttpRequestBudget(2));
  expect(fetch).toHaveBeenCalledTimes(6);
});

it("validates activation, URL and explicit percent units without accepting credentials", () => {
  expect(validateRadarrSetting("integration.radarr.enabled", "maybe")).toBeNull();
  expect(
    validateRadarrSetting("integration.radarr.url", "https://user:secret@arr.invalid")
  ).toBeNull();
  expect(validateRadarrSetting("integration.radarr.url", "https://arr.invalid/base")).toBe(
    "https://arr.invalid/base"
  );
  expect(validateRadarrSetting("matching.movie.tolerancePercent", "26")).toBeNull();
  expect(validateRadarrSetting("matching.movie.tolerancePercent", "0")).toBe("0");
  expect(validateRadarrSetting("integration.radarr.inventoryMaxMiB", "10")).toBe("10");
  expect(validateRadarrSetting("integration.radarr.inventoryMaxMiB", "64")).toBe("64");
  for (const value of ["0", "65", "-1", "10.5", "NaN", "", 10])
    expect(validateRadarrSetting("integration.radarr.inventoryMaxMiB", value)).toBeNull();
});

it("does not reuse an oversized inventory after lowering its configured limit", async () => {
  const payload = [{ ...movie(), monitored: true, overview: "x".repeat(6 * 1024 * 1024) }];
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async (url) =>
      Response.json(String(url).includes("system/status") ? { version: "6.0.0" } : payload)
    );
  expect(await getRadarrMonitoredMovies(new HttpRequestBudget(2))).toHaveLength(1);
  vi.mocked(getSetting).mockImplementation(
    async (key) =>
      ({
        "integration.radarr.enabled": "true",
        "integration.radarr.url": "https://arr.invalid/base/radarr",
        "integration.radarr.inventoryMaxMiB": "5",
      })[key] ?? null
  );
  await expect(getRadarrMonitoredMovies(new HttpRequestBudget(2))).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  expect(fetch).toHaveBeenCalledTimes(4);
});

it("rejects invalid persisted inventory limits before reading secrets or HTTP", async () => {
  vi.mocked(getSetting).mockImplementation(
    async (key) =>
      ({ "integration.radarr.enabled": "true", "integration.radarr.inventoryMaxMiB": "unbounded" })[
        key
      ] ?? null
  );
  vi.mocked(externalCredential).mockClear();
  const fetch = vi.spyOn(globalThis, "fetch");
  await expect(getRadarrMonitoredMovies(new HttpRequestBudget(2))).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  expect(externalCredential).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("reads only monitored movie goals, strips library fields and caches isolated copies", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(
      Response.json([
        { ...movie(), monitored: true },
        { monitored: false, path: "/not-a-goal" },
      ])
    );
  const result = await getRadarrMonitoredMovies(new HttpRequestBudget(2));
  expect(result).toEqual([parseRadarrMovie(movie())]);
  result[0].aliases!.push("not persisted");
  expect((await getRadarrMonitoredMovies(new HttpRequestBudget(1)))[0].aliases).toEqual([
    "Verified alias",
  ]);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(String(fetch.mock.calls[1][0])).toBe("https://arr.invalid/base/radarr/api/v3/movie");
  expect(fetch.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
});

it("does not read a disabled inventory's credentials or make HTTP requests", async () => {
  vi.mocked(getSetting).mockResolvedValue(null);
  vi.mocked(externalCredential).mockClear();
  const fetch = vi.spyOn(globalThis, "fetch");
  expect(await getRadarrMonitoredMovies(new HttpRequestBudget())).toEqual([]);
  expect(externalCredential).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it("bounds the library separately from 5-MiB single-film metadata responses", async () => {
  vi.spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(
      Response.json([{ ...movie(), monitored: true, overview: "x".repeat(6 * 1024 * 1024) }])
    );
  expect(await getRadarrMonitoredMovies(new HttpRequestBudget(2))).toEqual([
    parseRadarrMovie(movie()),
  ]);
  clearMetadataCaches();
  vi.mocked(fetch)
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(
      new Response("not read", { headers: { "content-length": String(10 * 1024 * 1024 + 1) } })
    );
  await expect(getRadarrMonitoredMovies(new HttpRequestBudget(2))).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
});

it("rejects duplicate monitored IDs and malformed monitoring without a partial inventory cache", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(
      Response.json([
        { ...movie(), monitored: true },
        { ...movie(), monitored: true },
      ])
    )
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(Response.json([{ ...movie(), monitored: "true" }]))
    .mockResolvedValueOnce(Response.json({ version: "6.0.0" }))
    .mockResolvedValueOnce(Response.json([{ ...movie(), monitored: true }]));
  await expect(getRadarrMonitoredMovies(new HttpRequestBudget(2))).rejects.toThrow();
  await expect(getRadarrMonitoredMovies(new HttpRequestBudget(2))).rejects.toThrow();
  expect(await getRadarrMonitoredMovies(new HttpRequestBudget(2))).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(6);
});
