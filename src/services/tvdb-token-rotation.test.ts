import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { settings, fetchWithRetry, findUnique } = vi.hoisted(() => ({
  settings: { key: "first-key", pin: "" },
  fetchWithRetry: vi.fn(),
  findUnique: vi.fn(async () => null),
}));
vi.mock("@/lib/settings", () => ({
  getSettings: vi.fn(async () => ({ "api.tvdb.key": settings.key, "api.tvdb.pin": settings.pin })),
}));
vi.mock("@/lib/fetch-retry", () => ({ fetchWithRetry }));
vi.mock("@/lib/db", () => ({ prisma: { tvdbSeries: { findUnique } } }));

import { clearTvdbTokenMemoryCache, getShowInfoByTvdbId } from "./tvdb";

beforeEach(() => {
  clearTvdbTokenMemoryCache();
  settings.key = "first-key";
  settings.pin = "";
  fetchWithRetry.mockReset();
  findUnique.mockClear();
  let login = 0;
  fetchWithRetry.mockImplementation(async (url: string) => {
    if (url.endsWith("/login")) {
      login++;
      return Response.json({ status: "success", data: { token: `synthetic-token-${login}` } });
    }
    return Response.json({ status: "failure", privateMessage: "synthetic-private-provider-body" });
  });
});
afterEach(() => vi.restoreAllMocks());

it("rotates TVDB bearer tokens in memory without writing DB tokens or logging response bodies", async () => {
  const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
  await getShowInfoByTvdbId(1001);
  settings.key = "rotated-key";
  await getShowInfoByTvdbId(1002);

  const logins = fetchWithRetry.mock.calls.filter(([url]) => String(url).endsWith("/login"));
  const series = fetchWithRetry.mock.calls.filter(([url]) => String(url).includes("/series/"));
  expect(logins).toHaveLength(2);
  expect(series).toHaveLength(2);
  expect(series[0][1].headers.Authorization).toBe("Bearer synthetic-token-1");
  expect(series[1][1].headers.Authorization).toBe("Bearer synthetic-token-2");
  expect(fetchWithRetry.mock.calls.every(([url]) => !String(url).includes("first-key"))).toBe(true);
  expect(JSON.stringify(errorLog.mock.calls)).not.toContain("synthetic-private-provider-body");
});
