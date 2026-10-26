import { beforeEach, afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ setting: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: state.setting }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { findProgrammeIdentity, ProgrammeIdentityConflictError } from "./tmdb";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { youtubeTitleKey } from "@/lib/youtube-mapping";
beforeEach(() => {
  vi.clearAllMocks();
  state.setting.mockResolvedValue("eyJ.synthetic.token");
  vi.stubGlobal("fetch", state.fetch);
});
afterEach(() => vi.unstubAllGlobals());
const lookup = (kind: "series" | "movie" = "series", year: number | null = 2001) =>
  findProgrammeIdentity(
    "Synthetic title",
    kind,
    year,
    new HttpRequestBudget(10, 1000),
    youtubeTitleKey
  );
it("verifies the TVDB/TMDB cross ID in both directions with a shared bounded budget", async () => {
  state.fetch
    .mockResolvedValueOnce(
      Response.json({
        total_pages: 1,
        results: [{ id: 7, name: "Synthetic title", first_air_date: "2001-01-01" }],
      })
    )
    .mockResolvedValueOnce(Response.json({ id: 7, tvdb_id: 42 }))
    .mockResolvedValueOnce(Response.json({ tv_results: [{ id: 7 }] }));
  expect(await lookup()).toEqual({ available: true, ambiguous: false, targetId: 42 });
  expect(state.fetch).toHaveBeenCalledTimes(3);
  for (const [url, options] of state.fetch.mock.calls) {
    expect(url).not.toContain("eyJ.synthetic.token");
    expect(options.headers.Authorization).toBe("Bearer eyJ.synthetic.token");
    expect(options.redirect).toBe("error");
  }
});
it.each(["homonyms", "truncated", "unknown-year"])(
  "does not resolve an uncertain %s from its first result",
  async (mode) => {
    const row = {
      id: 7,
      name: "Synthetic title",
      first_air_date: mode === "unknown-year" ? "" : "2001-01-01",
    };
    state.fetch.mockResolvedValue(
      Response.json({
        total_pages: mode === "truncated" ? 2 : 1,
        results: mode === "homonyms" ? [row, { ...row, id: 8 }] : [row],
      })
    );
    expect(await lookup()).toEqual({ available: true, ambiguous: true, targetId: null });
    expect(state.fetch).toHaveBeenCalledTimes(1);
  }
);
it("rejects a conflicting reverse cross ID rather than selecting another metadata provider", async () => {
  state.fetch
    .mockResolvedValueOnce(
      Response.json({
        total_pages: 1,
        results: [{ id: 7, name: "Synthetic title", first_air_date: "2001-01-01" }],
      })
    )
    .mockResolvedValueOnce(Response.json({ id: 7, tvdb_id: 42 }))
    .mockResolvedValueOnce(Response.json({ tv_results: [{ id: 8 }] }));
  await expect(lookup()).rejects.toBeInstanceOf(ProgrammeIdentityConflictError);
});
it("keeps movies in the TMDB namespace and does not turn an unknown film year into a match", async () => {
  state.fetch.mockResolvedValue(
    Response.json({
      total_pages: 1,
      results: [{ id: 7, title: "Synthetic title", release_date: "2001-01-01" }],
    })
  );
  expect(await lookup("movie")).toEqual({ available: true, ambiguous: false, targetId: 7 });
  expect(state.fetch).toHaveBeenCalledTimes(1);
  state.setting.mockResolvedValue(null);
  state.fetch.mockClear();
  expect(await lookup("movie")).toEqual({ available: false, ambiguous: false, targetId: null });
  expect(state.fetch).not.toHaveBeenCalled();
});
it("bounds response bytes and never represents a transport failure as empty success", async () => {
  state.fetch.mockResolvedValue(new Response(" ".repeat(1024 * 1024 + 1)));
  await expect(lookup()).rejects.toThrow();
  state.fetch.mockResolvedValue(new Response("Synthetic unavailable", { status: 503 }));
  await expect(lookup()).rejects.toThrow();
});
