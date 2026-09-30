import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { getSetting, fetchMock } = vi.hoisted(() => ({
  getSetting: vi.fn(),
  fetchMock: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getSetting }));
vi.mock("@/lib/db", () => ({ prisma: {} }));

import { searchMulti } from "./tmdb";

beforeEach(() => {
  getSetting.mockReset();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("does not place a legacy TMDB v3 key in a URL", async () => {
  getSetting.mockResolvedValue("legacy-v3-key");
  expect(await searchMulti("test")).toEqual({ mediaType: "unknown", tmdbId: null });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("sends a read-access token only in a bearer header and blocks redirects", async () => {
  getSetting.mockResolvedValue("eyJ.synthetic.read.token");
  fetchMock.mockResolvedValue(Response.json({ results: [{ id: 7, media_type: "movie" }] }));

  expect(await searchMulti("test")).toEqual({ mediaType: "movie", tmdbId: 7 });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toContain("/search/multi?query=test&language=de-DE");
  expect(url).not.toContain("eyJ.synthetic.read.token");
  expect(options.headers.Authorization).toBe("Bearer eyJ.synthetic.read.token");
  expect(options.redirect).toBe("error");
});
