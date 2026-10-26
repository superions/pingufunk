import { createHash } from "node:crypto";
import { youtubeMappingKey, type YoutubeMapping } from "@/lib/youtube-catalogue";
import {
  youtubeSourceIdentitySchema,
  youtubeSourceReferenceSchema,
  youtubeWatchUrl,
  type YoutubeSourceIdentity,
  type YoutubeSourceReference,
} from "@/lib/youtube-source";
import {
  mapYoutubeEpisodes,
  conflictingYoutubeVideos,
  youtubeTitleKey,
} from "@/lib/youtube-mapping";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { readYoutubeCatalogueIndex, assertYoutubeCatalogueRevision } from "./youtube-catalogue";
import { getShowInfoByTvdbId } from "./shows";
import { getRadarrMovie } from "./radarr-provider";
import { getMovieInfoByTmdbId } from "./tmdb";
import { movieSourceTitle } from "./movie-matcher";
import type { ApiResultItem, TvdbData } from "@/types";

type Index = Awaited<ReturnType<typeof readYoutubeCatalogueIndex>>;
export function youtubeMappingRevision(
  revision: string,
  mapping: YoutubeMapping,
  metadata: unknown
): string {
  if (metadata && typeof metadata === "object" && "episodes" in metadata) {
    const show = metadata as TvdbData;
    metadata = {
      id: show.id,
      name: show.name,
      germanName: show.germanName,
      aliases: show.aliases,
      episodes: show.episodes.map((episode) => ({
        name: episode.name,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        aired: episode.aired,
        runtime: episode.runtime,
      })),
      blocked: show.sonarrBlockedCoordinates ?? [],
    };
  }
  return createHash("sha256")
    .update(JSON.stringify([revision, mapping, metadata]))
    .digest("hex");
}
/** Canonical programme binding, shared by discovery and pre-enqueue validation. No media requests. */
export async function boundYoutubeItems(
  index: Index,
  mapping: YoutubeMapping,
  budget: HttpRequestBudget,
  show?: TvdbData
): Promise<ApiResultItem[]> {
  if (
    !index.enabled ||
    !index.current ||
    !mapping.enabled ||
    !index.registry.channels.some((row) => row.id === mapping.channelId && row.enabled)
  )
    return [];
  const key = youtubeMappingKey(mapping);
  const inventory = index.rows.filter((row) => row.mappingKey === key);
  const conflicts = conflictingYoutubeVideos(index.registry, index.rows);
  const output: ApiResultItem[] = [];
  let name: string, revision: string;
  const add = (source: YoutubeSourceIdentity) => {
    const row = inventory.find(
      (row) => row.videoId === source.videoId && row.availability === "listed"
    );
    if (!row?.content) return;
    output.push({
      ...row.content,
      topic: name,
      sourceProviderId: "youtube",
      sourceRef: source,
      url_website: youtubeWatchUrl(source),
      url_video: "",
      url_video_hd: "",
      url_video_low: "",
    });
  };
  if (mapping.kind === "series") {
    const metadata =
      show?.id === mapping.targetId ? show : await getShowInfoByTvdbId(mapping.targetId, budget);
    if (!metadata || metadata.id !== mapping.targetId || !metadata.episodes.length)
      throw Error("Canonical series unavailable");
    name = metadata.germanName || metadata.name;
    revision = youtubeMappingRevision(index.revision, mapping, metadata);
    const report = mapYoutubeEpisodes(mapping, metadata, inventory, revision, conflicts);
    for (const row of report.rows)
      if (row.state === "mapped")
        for (const source of row.sources)
          if (source.availability === "listed")
            add(
              youtubeSourceIdentitySchema.parse({
                version: 1,
                family: "youtube",
                videoId: source.videoId,
                channelId: mapping.channelId,
                playlistId: mapping.sourceId,
                mappingRevision: revision,
                programme: {
                  kind: "series",
                  targetId: mapping.targetId,
                  season: row.season,
                  episode: row.episode,
                },
                originalTitle: source.originalTitle,
              })
            );
  } else {
    let movie;
    try {
      movie = await getRadarrMovie(mapping.targetId, null, budget);
    } catch {
      budget.assertAvailable();
    }
    movie ??= await getMovieInfoByTmdbId(mapping.targetId, budget);
    if (!movie || movie.tmdbId !== mapping.targetId) throw Error("Canonical movie unavailable");
    name = movie.germanTitle || movie.title;
    revision = youtubeMappingRevision(index.revision, mapping, movie);
    if (inventory.length > 1) throw Error("Conflicting movie source");
    const row = inventory[0],
      title = row?.content?.title;
    if (
      row?.availability === "listed" &&
      row.videoId === mapping.sourceId &&
      row.channelId === mapping.channelId &&
      title &&
      !conflicts.has(row.videoId)
    ) {
      const parsed = movieSourceTitle(title),
        year =
          movie.productionYear ??
          (movie.releaseDate ? Number(movie.releaseDate.slice(0, 4)) : null);
      if (
        [movie.title, movie.germanTitle, ...(movie.aliases ?? [])].some(
          (value) => youtubeTitleKey(value) === youtubeTitleKey(parsed.title)
        ) &&
        (parsed.year === null || parsed.year === year)
      )
        add(
          youtubeSourceIdentitySchema.parse({
            version: 1,
            family: "youtube",
            videoId: row.videoId,
            channelId: mapping.channelId,
            mappingRevision: revision,
            programme: { kind: "movie", targetId: mapping.targetId },
            originalTitle: title,
          })
        );
    }
  }
  budget.assertAvailable();
  return output;
}
/** New enqueue uses current registry; an accepted durable job no longer calls this owner. */
export async function validateYoutubeEnqueue(
  url: string,
  value: YoutubeSourceReference,
  budget = new HttpRequestBudget(32)
): Promise<import("@/lib/source-admission").SourceAdmission> {
  const source = youtubeSourceReferenceSchema.parse(value);
  if (url !== youtubeWatchUrl(source)) throw Error("YouTube source URL mismatch");
  const index = await readYoutubeCatalogueIndex();
  const mapping = index.registry.programMappings.find(
    (row) =>
      row.kind === source.programme.kind &&
      row.targetId === source.programme.targetId &&
      row.channelId === source.channelId &&
      row.sourceId === (source.playlistId ?? source.videoId)
  );
  if (!mapping) throw Error("YouTube source no longer registered");
  const items = await boundYoutubeItems(index, mapping, budget);
  const found = items.find((item) => item.sourceRef?.videoId === source.videoId)?.sourceRef;
  const { selection: _, ...identity } = source;
  if (!found || JSON.stringify(found) !== JSON.stringify(identity))
    throw Error("YouTube binding changed");
  await assertYoutubeCatalogueRevision(index.revision);
  return index.guardValues;
}

/** Recheck discovery permission immediately before a background extractor call. Accepted jobs bypass this. */
export async function assertCurrentYoutubeDiscovery(source: YoutubeSourceIdentity): Promise<void> {
  const index = await readYoutubeCatalogueIndex();
  if (!index.enabled || !index.current || !index.indexed) throw Error("YouTube discovery disabled");
  const mapping = index.registry.programMappings.find(
    (row) =>
      row.enabled &&
      row.kind === source.programme.kind &&
      row.targetId === source.programme.targetId &&
      row.channelId === source.channelId &&
      row.sourceId === (source.playlistId ?? source.videoId)
  );
  if (
    !mapping ||
    !index.registry.channels.some((row) => row.id === source.channelId && row.enabled) ||
    !index.rows.some(
      (row) =>
        row.mappingKey === youtubeMappingKey(mapping) &&
        row.videoId === source.videoId &&
        row.channelId === source.channelId &&
        row.availability === "listed" &&
        row.content?.title === source.originalTitle
    )
  )
    throw Error("YouTube discovery changed");
}
