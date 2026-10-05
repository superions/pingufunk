import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import type { TvdbData } from "@/types";

const state = vi.hoisted(() => ({
  epoch: 0,
  pending: new Map<string, Promise<unknown>>(),
  settings: new Map<string, string>(),
}));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => state.settings.get(key) ?? null),
}));
vi.mock("@/lib/cache", () => ({
  cacheContextEpoch: () => state.epoch,
  metadataCacheKey: (source: string, id: unknown, context: unknown) =>
    JSON.stringify([state.epoch, source, id, context]),
  coalesceMetadata: (key: string, load: () => Promise<unknown>) => {
    if (state.pending.has(key)) return state.pending.get(key);
    const pending = load().finally(() => state.pending.delete(key));
    state.pending.set(key, pending);
    return pending;
  },
}));

import { openSonarrSession, mergeSonarrShow, SonarrUnavailableError } from "./sonarr-provider";

const series = { id: 12, tvdbId: 123, title: "Synthetic series", monitored: true };
const episode = {
  id: 45,
  seriesId: 12,
  seasonNumber: 2,
  episodeNumber: 3,
  title: "Missing episode",
  airDateUtc: "2026-09-29T18:00:00Z",
  runtime: 2,
};
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  state.epoch++;
  state.settings.clear();
  state.settings.set("integration.sonarr.enabled", "true");
  state.settings.set("integration.sonarr.url", "https://example.invalid/sonarr");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-key");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  fetchMock = vi.fn(async (url: string) => {
    const route = new URL(url).pathname;
    if (route.endsWith("/system/status")) return Response.json({ version: "4.0.16.2944" });
    if (route.endsWith("/series")) return Response.json([series]);
    if (route.endsWith("/episode")) return Response.json([episode]);
    throw new Error("Unexpected synthetic request");
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Sonarr read-only provider", () => {
  it("does not let caller fields override the instance-verified series identity", async () => {
    const session = (await openSonarrSession())!;
    const result = await session.episodes(
      {
        sonarrId: 12,
        tvdbId: 123,
        title: "Unverified title",
        aliases: ["Unverified alias"],
        monitored: false,
      },
      new HttpRequestBudget()
    );
    expect(result.series).toEqual({
      sonarrId: 12,
      tvdbId: 123,
      title: series.title,
      monitored: true,
    });
  });
  it("refreshes a stale inventory once for a newly added verified series without changing IDs", async () => {
    let added = false;
    fetchMock.mockImplementation(async (value: string) => {
      const url = new URL(value);
      if (url.pathname.endsWith("/system/status")) return Response.json({ version: "4.0.20.3014" });
      if (url.pathname.endsWith("/series"))
        return Response.json(url.search || added ? [series] : []);
      if (url.pathname.endsWith("/episode")) return Response.json([episode]);
      throw Error("Unexpected synthetic request");
    });
    const session = (await openSonarrSession())!;
    expect(await session.inventory(new HttpRequestBudget())).toEqual([]);
    added = true;
    const budget = new HttpRequestBudget();
    expect((await session.show(123, budget))?.series.sonarrId).toBe(12);
    expect(budget.remainingAttempts).toBe(7);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/series"))).toHaveLength(2);
  });
  it("does not cache an absent series across its addition", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ version: "4.0.20.3014" }))
      .mockResolvedValueOnce(Response.json([]));
    const session = (await openSonarrSession())!;
    expect(await session.show(123)).toBeNull();
    expect((await session.show(123))?.series.sonarrId).toBe(12);
  });
  it("merges verified aliases without inventing a German language or overwriting base metadata", async () => {
    const supplemental = (await (await openSonarrSession())!.show(123))!;
    supplemental.series.aliases = ["Deutscher Titel"];
    expect(mergeSonarrShow(null, supplemental)).toMatchObject({
      germanName: null,
      aliases: [{ name: "Deutscher Titel", language: "und" }],
    });
  });
  it("does no HTTP or credential access when disabled", async () => {
    state.settings.set("integration.sonarr.enabled", "false");
    vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", "/missing/synthetic-file");
    expect(await openSonarrSession()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("verifies version, series identity and local episode ID with the same budget", async () => {
    const session = (await openSonarrSession())!;
    const budget = new HttpRequestBudget();
    const show = await session.show(123, budget);
    expect(show?.episodes[0]).toMatchObject({
      seasonNumber: 2,
      episodeNumber: 3,
      expectedRuntimeSeconds: 120,
    });
    expect(budget.remainingAttempts).toBe(6);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toMatch(/^https:\/\/example.invalid\/sonarr\/api\/v3\//);
      expect(url).not.toContain("synthetic-key");
      expect(init).toMatchObject({
        method: "GET",
        redirect: "error",
        headers: { "X-Api-Key": "synthetic-key" },
      });
    }
    expect(await session.show(123, budget)).toEqual(show);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("coalesces concurrent lookups and returns mutation-isolated copies", async () => {
    const session = (await openSonarrSession())!;
    const [first, second] = await Promise.all([session.show(123), session.show(123)]);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    first!.episodes[0].title = "Mutated";
    expect(second!.episodes[0].title).toBe("Missing episode");
    expect((await session.show(123))!.episodes[0].title).toBe("Missing episode");
  });

  it("expires metadata after ten minutes", async () => {
    vi.useFakeTimers();
    const session = (await openSonarrSession())!;
    await session.show(123);
    vi.setSystemTime(Date.now() + 600_000);
    await session.show(123);
    expect(fetchMock).toHaveBeenCalledTimes(8);
  });

  it("does not reuse cached responses after credential or instance rotation", async () => {
    await (await openSonarrSession())!.show(123);
    vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "rotated-synthetic-key");
    await (await openSonarrSession())!.show(123);
    state.settings.set("integration.sonarr.url", "https://other.example.invalid/base");
    await (await openSonarrSession())!.show(123);
    expect(fetchMock).toHaveBeenCalledTimes(12);
  });

  it("rejects late invalidated responses and leaves the new epoch empty", async () => {
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const session = (await openSonarrSession())!;
    const lookup = session.show(123);
    state.epoch++;
    release(Response.json({ version: "4.0.16.2944" }));
    await expect(lookup).rejects.toBeInstanceOf(SonarrUnavailableError);
    await (await openSonarrSession())!.show(123);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("rejects a filtered response with a foreign TVDB ID", async () => {
    fetchMock.mockImplementation(async (url: string) =>
      new URL(url).pathname.endsWith("/system/status")
        ? Response.json({ version: "4.0.1" })
        : Response.json([{ ...series, tvdbId: 999 }])
    );
    await expect((await openSonarrSession())!.show(123)).rejects.toBeInstanceOf(
      SonarrUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects a local ID not verified by this instance's inventory", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/system/status")) return Response.json({ version: "4.0.1" });
      return Response.json([{ ...series, id: url.includes("tvdbId=") ? 12 : 99 }]);
    });
    await expect((await openSonarrSession())!.show(123)).rejects.toBeInstanceOf(
      SonarrUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("does not retry 401 or cache authentication failure as an empty success", async () => {
    fetchMock.mockResolvedValueOnce(new Response("private provider error", { status: 401 }));
    const session = (await openSonarrSession())!;
    await expect(session.show(123)).rejects.toThrow("Optional episode metadata unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(await session.show(123)).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("counts 429 retries toward the operation's shared attempt limit", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 429 }));
    const budget = new HttpRequestBudget(2);
    await expect((await openSonarrSession())!.show(123, budget)).rejects.toBeInstanceOf(
      SonarrUnavailableError
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(budget.remainingAttempts).toBe(0);
  });

  it("aborts a stalled request at the shared deadline without caching an empty result", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const session = (await openSonarrSession())!;
    const failed = expect(session.show(123, new HttpRequestBudget(10, 100))).rejects.toBeInstanceOf(
      SonarrUnavailableError
    );
    await vi.advanceTimersByTimeAsync(100);
    await failed;
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(await session.show(123)).not.toBeNull();
  });

  it("a coalesced caller retains its own shorter deadline without cancelling another caller", async () => {
    vi.useFakeTimers();
    let release!: (response: Response) => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        })
    );
    const session = (await openSonarrSession())!;
    const first = session.show(123, new HttpRequestBudget(10, 1000));
    const second = expect(session.show(123, new HttpRequestBudget(10, 10))).rejects.toBeInstanceOf(
      SonarrUnavailableError
    );
    await vi.advanceTimersByTimeAsync(10);
    await second;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(false);
    release(Response.json({ version: "4.0.1" }));
    expect(await first).not.toBeNull();
  });
});

describe("non-destructive episode supplementation", () => {
  const base: TvdbData = {
    id: 123,
    name: "Local series",
    germanName: "Lokale Serie",
    aliases: [],
    episodes: [
      {
        name: "Existing",
        aired: new Date("2026-01-01T12:00:00Z"),
        runtime: 40,
        seasonNumber: 1,
        episodeNumber: 1,
      },
    ],
  };

  it("adds a missing episode without replacing any base field", async () => {
    const result = mergeSonarrShow(base, await (await openSonarrSession())!.show(123))!;
    expect(result).toMatchObject({ id: base.id, name: base.name, germanName: base.germanName });
    expect(result.episodes[0]).toBe(base.episodes[0]);
    expect(result.episodes[1]).toMatchObject({
      runtime: 2,
      metadataSource: "sonarr",
      seasonNumber: 2,
      episodeNumber: 3,
    });
    expect(base.episodes).toHaveLength(1);
  });

  it("blocks conflicting coordinates without changing the existing episode", async () => {
    const show = (await (await openSonarrSession())!.show(123))!;
    show.episodes[0].seasonNumber = 1;
    show.episodes[0].episodeNumber = 1;
    const result = mergeSonarrShow(base, show)!;
    expect(result.episodes).toEqual(base.episodes);
    expect(result.sonarrBlockedCoordinates).toEqual(["1:1"]);
  });

  it("permits a fully verified Sonarr-only show and rejects mismatched base identity", async () => {
    const show = await (await openSonarrSession())!.show(123);
    expect(mergeSonarrShow(null, show)).toMatchObject({
      id: 123,
      name: "Synthetic series",
      episodes: [{ runtime: 2, metadataSource: "sonarr" }],
    });
    expect(() => mergeSonarrShow({ ...base, id: 456 }, show)).toThrow(SonarrUnavailableError);
  });
});
