import { z } from "zod";
import { getSetting } from "@/lib/settings";
import { externalCredential } from "@/lib/credential-settings";
import { createReadOnlyArrJsonClient } from "@/lib/read-only-arr-client";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { publicDownloadCategory } from "@/lib/download-paths";
import { cacheContextEpoch } from "@/lib/cache";
import type { ImportDiagnosis } from "@/lib/job-diagnostics";

const positiveId = z.number().int().positive().max(2_147_483_647);
const historyRow = z.object({
  downloadId: z.string().max(200).nullable(),
  eventType: z.string().max(64),
  episodeId: positiveId.optional(),
  seriesId: positiveId.optional(),
  movieId: positiveId.optional(),
  data: z.record(z.string(), z.string().max(16_384)),
});
const paging = z
  .object({
    page: z.literal(1),
    pageSize: z.literal(100),
    totalRecords: z.number().int().nonnegative().safe(),
    records: z.array(z.unknown()).max(100),
  })
  .refine((value) => value.totalRecords >= value.records.length);
const unknown = (reason: ImportDiagnosis["reason"]): ImportDiagnosis => ({
  state: "unknown",
  reason,
});
const idMatches = (left: string | null, right: string) =>
  left?.toLowerCase() === right.toLowerCase();

/** API evidence only. Never infer import from Completed, a title or an unrelated hasFile. */
export async function diagnoseArrImport(
  downloadId: string,
  category: string
): Promise<ImportDiagnosis> {
  const publicCategory = publicDownloadCategory(category);
  const app = ["sonarr", "tv"].includes(publicCategory)
    ? "sonarr"
    : ["radarr", "movies", "movie"].includes(publicCategory)
      ? "radarr"
      : null;
  if (!app) return unknown("category_unknown");
  const epoch = cacheContextEpoch();
  if ((await getSetting(`integration.${app}.enabled`)) !== "true")
    return unknown("integration_disabled");
  try {
    const base = await getSetting(`integration.${app}.url`),
      credential = await externalCredential(`PINGUFUNK_${app.toUpperCase()}_API_KEY`);
    if (!base || !credential.value) throw Error();
    const client = createReadOnlyArrJsonClient(base, credential.value);
    const budget = new HttpRequestBudget(10, 8000);
    const read = async (route: string, query?: URLSearchParams) => {
      const value = await client(route, query, { requestBudget: budget, maxRetries: 0 });
      if (epoch !== cacheContextEpoch()) throw Error();
      return value;
    };
    const status = z
      .object({ version: z.string().max(50) })
      .parse(await read("api/v3/system/status"));
    if (
      !(app === "sonarr" ? /^[34]\.\d+\.\d+(?:\.\d+)?$/ : /^6\.\d+\.\d+(?:\.\d+)?$/).test(
        status.version
      )
    )
      return { state: "unavailable", reason: "unsupported_version" };
    const page = paging.parse(
      await read(
        "api/v3/history",
        new URLSearchParams({
          downloadId,
          page: "1",
          pageSize: "100",
          sortKey: "date",
          sortDirection: "descending",
        })
      )
    );
    const history = page.records.map((value) => historyRow.parse(value));
    // Ignore no extra unassociated row: a faulty/unsupported filter is not proof.
    if (history.some((row) => !idMatches(row.downloadId, downloadId))) throw Error();
    if (page.totalRecords > history.length) return unknown("window_limited");
    const imported = history.filter((row) => row.eventType === "downloadFolderImported");
    if (imported.length) {
      if (imported.length > 4) return unknown("window_limited");
      for (const row of imported) {
        const fileId = Number(row.data.fileId),
          importedPath = row.data.importedPath;
        if (!positiveId.safeParse(fileId).success || !importedPath)
          return { state: "conflicting", reason: "file_mismatch" };
        const grab = history.some(
          (other) =>
            other.eventType === "grabbed" &&
            (app === "sonarr"
              ? other.episodeId === row.episodeId && other.seriesId === row.seriesId
              : other.movieId === row.movieId)
        );
        if (!grab) return unknown("not_associated");
        const file = z
          .object({
            id: positiveId,
            size: z.number().int().positive().safe(),
            path: z.string().min(1).max(16_384),
            seriesId: positiveId.optional(),
            movieId: positiveId.optional(),
          })
          .parse(await read(`api/v3/${app === "sonarr" ? "episodefile" : "moviefile"}/${fileId}`));
        if (file.id !== fileId || file.path !== importedPath)
          return { state: "conflicting", reason: "file_mismatch" };
        if (app === "sonarr") {
          if (!row.episodeId || !row.seriesId || file.seriesId !== row.seriesId)
            return { state: "conflicting", reason: "file_mismatch" };
          const episode = z
            .object({
              id: positiveId,
              seriesId: positiveId,
              hasFile: z.boolean(),
              episodeFileId: positiveId,
            })
            .parse(await read(`api/v3/episode/${row.episodeId}`));
          if (
            episode.id !== row.episodeId ||
            episode.seriesId !== row.seriesId ||
            !episode.hasFile ||
            episode.episodeFileId !== fileId
          )
            return { state: "conflicting", reason: "file_mismatch" };
        } else {
          if (!row.movieId || file.movieId !== row.movieId)
            return { state: "conflicting", reason: "file_mismatch" };
          const movie = z
            .object({
              id: positiveId,
              hasFile: z.boolean(),
              movieFile: z.object({
                id: positiveId,
                movieId: positiveId,
                size: z.number().int().positive().safe(),
              }),
            })
            .parse(await read(`api/v3/movie/${row.movieId}`));
          if (
            movie.id !== row.movieId ||
            !movie.hasFile ||
            movie.movieFile.id !== fileId ||
            movie.movieFile.movieId !== row.movieId ||
            movie.movieFile.size !== file.size
          )
            return { state: "conflicting", reason: "file_mismatch" };
        }
      }
      return { state: "reported_import", reason: "api_file_associated" };
    }
    const queue = paging.parse(
      await read(
        "api/v3/queue",
        new URLSearchParams({
          page: "1",
          pageSize: "100",
          [app === "sonarr" ? "includeUnknownSeriesItems" : "includeUnknownMovieItems"]: "true",
        })
      )
    );
    const rows = z
      .array(
        z.object({
          downloadId: z.string().max(200).nullable(),
          trackedDownloadState: z.string().max(64).nullish(),
          statusMessages: z
            .array(
              z.object({
                title: z.string().max(500),
                messages: z.array(z.string().max(2000)).max(32),
              })
            )
            .max(32)
            .optional(),
        })
      )
      .parse(queue.records);
    const matching = rows.filter((row) => idMatches(row.downloadId, downloadId));
    if (matching.some((row) => row.trackedDownloadState === "importBlocked")) {
      const messages = matching
        .flatMap(
          (row) =>
            row.statusMessages?.flatMap((message) => [message.title, ...message.messages]) ?? []
        )
        .join(" ");
      // Free provider messages are mapped, never returned to the browser.
      const reason: ImportDiagnosis["reason"] = /title mismatch/i.test(messages)
        ? "title_mismatch"
        : /language/i.test(messages)
          ? "language_mismatch"
          : /quality/i.test(messages)
            ? "quality_mismatch"
            : /path|accessible/i.test(messages)
              ? "path_unavailable"
              : "import_blocked";
      return { state: "blocked", reason };
    }
    return unknown(queue.totalRecords > rows.length ? "window_limited" : "not_associated");
  } catch {
    return { state: "unavailable", reason: "request_failed" };
  }
}
