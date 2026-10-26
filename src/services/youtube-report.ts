import { createHash } from "node:crypto";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { youtubeMappingKey } from "@/lib/youtube-catalogue";
import {
  mapYoutubeEpisodes,
  conflictingYoutubeVideos,
  youtubeTitleKey,
  YoutubeMappingError,
} from "@/lib/youtube-mapping";
import { youtubeReportSchema, type YoutubeReport } from "@/lib/youtube-report";
import { getShowInfoByTvdbId } from "./shows";
import { getRadarrMovie } from "./radarr-provider";
import { getMovieInfoByTmdbId } from "./tmdb";
import { movieSourceTitle } from "./movie-matcher";
import {
  readYoutubeCatalogueIndex,
  assertYoutubeCatalogueRevision,
  YoutubeCatalogueError,
} from "./youtube-catalogue";

/** Explicit setup report: programme intent, canonical binding, index coverage and media readiness stay separate. */
export async function youtubeMappingReport(key: string, page: number): Promise<YoutubeReport> {
  if (!Number.isSafeInteger(page) || page < 0 || page > 999)
    throw new YoutubeCatalogueError(400, "Ungültige Berichtsseite.");
  const index = await readYoutubeCatalogueIndex();
  const mapping = index.registry.programMappings.find(
    (mapping) => youtubeMappingKey(mapping) === key
  );
  if (!mapping) throw new YoutubeCatalogueError(404, "Gespeicherte Programmzuordnung fehlt.");
  const report: YoutubeReport = {
    revision: index.revision,
    mappingKey: key,
    kind: mapping.kind,
    targetId: mapping.targetId,
    name: mapping.name,
    state: !index.indexed ? "index_missing" : !index.current ? "index_outdated" : "ready",
    indexAt: index.at,
    indexCurrent: index.current,
    order: mapping.kind === "series" ? "aired" : null,
    mediaReady: false,
    page,
    rows: [],
    extras: [],
    rowCount: 0,
    extraCount: 0,
    totals: { mapped: 0, missing: 0, ambiguous: 0, unavailable: 0 },
  };
  const budget = new HttpRequestBudget(32, 15000);
  const inventory = index.current ? index.rows.filter((row) => row.mappingKey === key) : [];
  const conflicts = conflictingYoutubeVideos(index.registry, index.rows);
  let rows: YoutubeReport["rows"] = [],
    extras: YoutubeReport["extras"] = [];
  try {
    if (mapping.kind === "series") {
      const show = await getShowInfoByTvdbId(mapping.targetId, budget);
      if (!show || !show.episodes.length) report.state = "metadata_unavailable";
      else if (show.id !== mapping.targetId) report.state = "metadata_conflict";
      else {
        const revision = createHash("sha256")
          .update(JSON.stringify([index.revision, mapping, show]))
          .digest("hex");
        const result = mapYoutubeEpisodes(mapping, show, inventory, revision, conflicts);
        rows = result.rows;
        extras = result.extras;
        report.name = show.germanName || show.name;
      }
    } else {
      let movie;
      try {
        movie = await getRadarrMovie(mapping.targetId, null, budget);
      } catch {
        budget.assertAvailable();
      }
      movie ??= await getMovieInfoByTmdbId(mapping.targetId, budget);
      if (!movie) report.state = "metadata_unavailable";
      else if (movie.tmdbId !== mapping.targetId) report.state = "metadata_conflict";
      else {
        report.name = movie.germanTitle || movie.title;
        const revision = createHash("sha256")
          .update(JSON.stringify([index.revision, mapping, movie]))
          .digest("hex");
        const sources: YoutubeReport["rows"][number]["sources"] = [];
        if (inventory.length > 1) throw new YoutubeMappingError("source");
        let state: YoutubeReport["rows"][number]["state"] = "missing";
        for (const item of inventory) {
          const title = item.content?.title ?? item.lastKnown?.title ?? null;
          if (!item.videoId || !title) {
            extras.push({
              videoId: item.videoId,
              title,
              state: "unavailable",
              reason: "unavailable",
            });
            continue;
          }
          if (item.videoId !== mapping.sourceId) throw new YoutubeMappingError("source");
          if ((item.channelId ?? item.lastKnown?.channelId) !== mapping.channelId)
            throw new YoutubeMappingError("source");
          const parsed = movieSourceTitle(title);
          const year =
            movie.productionYear ??
            (movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : null);
          if (
            ![movie.title, movie.germanTitle, ...(movie.aliases ?? [])].some(
              (name) => youtubeTitleKey(name) === youtubeTitleKey(parsed.title)
            ) ||
            (parsed.year !== null && parsed.year !== year) ||
            conflicts.has(item.videoId)
          ) {
            extras.push({
              videoId: item.videoId,
              title,
              state: "ambiguous",
              reason: "metadata_conflict",
            });
            state = "ambiguous";
            continue;
          }
          sources.push({
            videoId: item.videoId,
            originalTitle: title,
            mappingRevision: revision,
            availability: item.availability,
          });
          state = item.availability === "listed" ? "mapped" : "unavailable";
        }
        rows = [{ season: null, episode: null, title: report.name, state, sources }];
      }
    }
  } catch (error) {
    report.state =
      error instanceof YoutubeMappingError
        ? error.reason === "source"
          ? "source_conflict"
          : "metadata_conflict"
        : "metadata_unavailable";
    rows = [];
    extras = [];
  }
  report.rowCount = rows.length;
  report.extraCount = extras.length;
  for (const row of rows) report.totals[row.state]++;
  report.rows = rows.slice(page * 100, page * 100 + 100);
  report.extras = extras.slice(page * 100, page * 100 + 100);
  await assertYoutubeCatalogueRevision(index.revision);
  return youtubeReportSchema.parse(report);
}
