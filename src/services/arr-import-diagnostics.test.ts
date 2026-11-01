import { beforeEach, afterEach, expect, it, vi } from "vitest";
const { setting } = vi.hoisted(() => ({ setting: vi.fn() }));
vi.mock("@/lib/settings", () => ({ getSetting: setting }));
import { diagnoseArrImport } from "./arr-import-diagnostics";
import { pairedProgrammeExpectations } from "@/lib/__fixtures__/mediathek-programme";
const id = "10000000-0000-4000-8000-000000000001";
let history: unknown[],
  file: Record<string, unknown>,
  entity: Record<string, unknown>,
  queue: unknown[],
  version: string;
beforeEach(() => {
  version = "4.0.20.3014";
  setting.mockImplementation(async (key: string) =>
    key.endsWith("enabled") ? "true" : "http://synthetic.invalid/subpath"
  );
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-secret");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY", "synthetic-secret");
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY_FILE", undefined);
  history = [
    { downloadId: id, eventType: "grabbed", episodeId: 1, seriesId: 2, data: {} },
    {
      downloadId: id,
      eventType: "downloadFolderImported",
      episodeId: 1,
      seriesId: 2,
      data: { fileId: "3", importedPath: "/synthetic/private.mkv" },
    },
  ];
  file = { id: 3, seriesId: 2, path: "/synthetic/private.mkv", size: 100 };
  entity = { id: 1, seriesId: 2, hasFile: true, episodeFileId: 3 };
  queue = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit) => {
      expect(init.method).toBe("GET");
      expect(init.redirect).toBe("error");
      expect(init.headers).toEqual({ "X-Api-Key": "synthetic-secret" });
      const url = new URL(input);
      expect(url.pathname.startsWith("/subpath/api/v3/")).toBe(true);
      expect(url.searchParams.has("apikey")).toBe(false);
      if (url.pathname.endsWith("system/status")) return Response.json({ version });
      if (url.pathname.endsWith("history")) {
        expect(url.searchParams.get("downloadId")).toBe(id);
        return Response.json({
          page: 1,
          pageSize: 100,
          totalRecords: history.length,
          records: history,
        });
      }
      if (url.pathname.endsWith("queue"))
        return Response.json({
          page: 1,
          pageSize: 100,
          totalRecords: queue.length,
          records: queue,
        });
      if (/\/(episodefile|moviefile)\/3$/.test(url.pathname)) return Response.json(file);
      if (/\/(episode|movie)\/1$/.test(url.pathname)) return Response.json(entity);
      return new Response(null, { status: 404 });
    })
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("requires paired exact download/episode history and the current API file; never physical-host proof", async () => {
  expect(await diagnoseArrImport(id, "sonarr")).toEqual({
    state: "reported_import",
    reason: "api_file_associated",
  });
  expect(JSON.stringify(await diagnoseArrImport(id, "sonarr"))).not.toMatch(
    /secret|synthetic|private|fileId/
  );
  expect(fetch).toHaveBeenCalledTimes(8);
});
it("accepts native null optional history metadata while requiring exact imported file fields", async () => {
  history = history.map((row) => ({
    ...(row as { data: object }),
    data: { ...(row as { data: object }).data, imdbId: null },
  }));
  expect(await diagnoseArrImport(id, "sonarr")).toEqual({
    state: "reported_import",
    reason: "api_file_associated",
  });
});
it("checks Radarr movie/file identities and sizes separately from hasFile", async () => {
  version = "6.4.4.10685";
  history = history.map((row) => ({
    ...(row as object),
    episodeId: undefined,
    seriesId: undefined,
    movieId: 1,
  }));
  file = { id: 3, movieId: 1, path: "/synthetic/private.mkv", size: 100 };
  entity = { id: 1, hasFile: true, movieFile: { id: 3, movieId: 1, size: 100 } };
  expect((await diagnoseArrImport(id, "radarr")).state).toBe("reported_import");
  entity.movieFile = { id: 3, movieId: 1, size: 101 };
  expect((await diagnoseArrImport(id, "radarr")).state).toBe("conflicting");
});
it.each([
  "wrongDownload",
  "noGrab",
  "wrongEpisode",
  "wrongSeries",
  "wrongFile",
  "wrongPath",
  "emptyFile",
  "notHasFile",
])("does not turn %s into a verified import", async (kind) => {
  if (kind === "wrongDownload")
    history = history.map((row) => ({ ...(row as object), downloadId: "foreign" }));
  if (kind === "noGrab") history = history.slice(1);
  if (kind === "wrongEpisode") entity.id = 9;
  if (kind === "wrongSeries") file.seriesId = 9;
  if (kind === "wrongFile") entity.episodeFileId = 4;
  if (kind === "wrongPath") file.path = "/synthetic/other.mkv";
  if (kind === "emptyFile") file.size = 0;
  if (kind === "notHasFile") entity.hasFile = false;
  expect((await diagnoseArrImport(id, "sonarr")).state).not.toBe("reported_import");
});
it("does not infer import from an empty queue, another job's block or title similarity", async () => {
  history = [];
  queue = [
    {
      downloadId: "foreign",
      trackedDownloadState: "importBlocked",
      statusMessages: [{ title: "Series title mismatch", messages: ["private-token"] }],
    },
  ];
  expect(await diagnoseArrImport(id, "sonarr")).toEqual({
    state: "unknown",
    reason: "not_associated",
  });
});
it("projects the exact associated blocked queue into a closed reason, stripping messages/paths", async () => {
  history = [];
  queue = [
    {
      downloadId: id,
      trackedDownloadState: "importBlocked",
      statusMessages: [
        {
          title: "Series title mismatch",
          messages: ["https://private.invalid?token=never-disclose"],
        },
      ],
    },
  ];
  expect(await diagnoseArrImport(id, "sonarr")).toEqual({
    state: "blocked",
    reason: "title_mismatch",
  });
});
it("disabled/unknown category does no secret or network I/O", async () => {
  setting.mockResolvedValue("false");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", "/missing/synthetic");
  expect((await diagnoseArrImport(id, "tv")).reason).toBe("integration_disabled");
  expect((await diagnoseArrImport(id, "default")).reason).toBe("category_unknown");
  expect(fetch).not.toHaveBeenCalled();
});
it("unsupported version and failed API stay unavailable, not imported or confirmed empty", async () => {
  version = "5.0.0";
  expect((await diagnoseArrImport(id, "sonarr")).reason).toBe("unsupported_version");
  vi.mocked(fetch).mockResolvedValue(new Response("private-token", { status: 401 }));
  expect(await diagnoseArrImport(id, "sonarr")).toEqual({
    state: "unavailable",
    reason: "request_failed",
  });
});
it("incomplete filtered history and oversized multi-episode association remain unknown", async () => {
  history = Array.from({ length: 5 }, () => history[1]);
  expect((await diagnoseArrImport(id, "sonarr")).reason).toBe("window_limited");
});
it("does not claim a complete import when history pagination is truncated or inconsistent", async () => {
  const nativeFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await nativeFetch(input, init);
    if (new URL(String(input)).pathname.endsWith("history")) {
      const value = await response.json();
      return Response.json({ ...value, totalRecords: history.length + 1 });
    }
    return response;
  });
  expect((await diagnoseArrImport(id, "sonarr")).reason).toBe("window_limited");
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const response = await nativeFetch(input, init);
    if (new URL(String(input)).pathname.endsWith("history")) {
      const value = await response.json();
      return Response.json({ ...value, totalRecords: 0 });
    }
    return response;
  });
  expect((await diagnoseArrImport(id, "sonarr")).state).toBe("unavailable");
});

it.each([
  "complete",
  "repeated-grab",
  "partial",
  "other-coordinate",
  "other-series",
  "other-file",
  "other-path",
  "duplicate-import",
  "missing-grab",
])("v7 import requires both exact targets and one shared native file: %s", async (kind) => {
  entity.seasonNumber = 0;
  entity.episodeNumber = 2;
  const second: Record<string, unknown> = { ...entity, id: 2, episodeNumber: 3 };
  history.push(
    { downloadId: id, eventType: "grabbed", episodeId: 2, seriesId: 2, data: {} },
    {
      downloadId: id,
      eventType: "downloadFolderImported",
      episodeId: 2,
      seriesId: 2,
      data: { fileId: "3", importedPath: file.path },
    }
  );
  const native = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith("/episode/2")) return Response.json(second);
    if (path.endsWith("/series/2"))
      return Response.json({ id: 2, tvdbId: kind === "other-series" ? 999 : 123 });
    return native(input, init);
  });
  if (kind === "partial") history.pop();
  if (kind === "other-coordinate") second.episodeNumber = 4;
  if (kind === "other-file") second.episodeFileId = 4;
  if (kind === "other-path")
    history[3] = {
      ...(history[3] as object),
      data: { fileId: "3", importedPath: "/different.mkv" },
    };
  if (kind === "duplicate-import") history[3] = history[1];
  if (kind === "missing-grab") history.splice(2, 1);
  if (kind === "repeated-grab") history.push(history[0], history[2]);
  const result = await diagnoseArrImport(id, "sonarr", pairedProgrammeExpectations.sourceProgramme);
  expect(result.state).toBe(
    ["complete", "repeated-grab"].includes(kind)
      ? "reported_import"
      : kind === "partial"
        ? "unknown"
        : "conflicting"
  );
  expect(JSON.stringify(result)).not.toMatch(/synthetic|private|downloadId|fileId/);
});
