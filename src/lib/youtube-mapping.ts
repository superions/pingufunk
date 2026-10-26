import { isPlaceholderEpisodeTitle } from "./episode-title";
import { youtubeMappingKey, type YoutubeIndexRow, type YoutubeMapping } from "./youtube-catalogue";
import type { TvdbData } from "@/types";

export class YoutubeMappingError extends Error {
  constructor(readonly reason: "metadata" | "mapping" | "source") {
    super("Unconfirmed YouTube mapping data");
  }
}

/** Exact, source-scoped title equivalence; never changes the shared episode parser. */
export function youtubeTitleKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("de-DE")
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

export interface YoutubeEpisodeSource {
  videoId: string;
  originalTitle: string;
  sourceCoordinates?: { season: number; episode: number };
  mappingRevision: string;
  availability: "listed" | "unavailable";
}
export interface YoutubeEpisodeReportRow {
  season: number;
  episode: number;
  title: string;
  state: "mapped" | "missing" | "ambiguous" | "unavailable";
  sources: YoutubeEpisodeSource[];
}
export interface YoutubeMappingExtra {
  videoId: string | null;
  title: string | null;
  state: "unavailable" | "unmatched" | "ambiguous";
  reason:
    | "unavailable"
    | "title_missing"
    | "title_ambiguous"
    | "number_conflict"
    | "metadata_conflict";
}

function concreteTitle(value: string): boolean {
  return (
    !!value.trim() &&
    !isPlaceholderEpisodeTitle(value) &&
    !/^(?:pilot|folge|episode|teil|part|staffel|season|bonus|special)\d*$/i.test(
      youtubeTitleKey(value)
    ) &&
    !/\b(?:trailer|teaser|preview|clip|outtakes)\b/i.test(value)
  );
}
function unquote(value: string): string {
  const title = value.trim();
  return [
    ['"', '"'],
    ["„", "“"],
    ["“", "”"],
  ].some(([a, b]) => title.startsWith(a) && title.endsWith(b))
    ? title.slice(1, -1).trim()
    : title;
}
/** Remove only a verified series prefix and its declared publisher numbering. */
function sourceTitle(value: string, names: string[]) {
  const title = unquote(value);
  const prefix = /^(.+?),\s*Staffel\s+(\d+),\s*Folge\s+(\d+):\s*(.+)$/i.exec(title);
  if (!prefix) return { title, coordinates: undefined, publisherPrefix: false };
  if (!names.some((name) => youtubeTitleKey(name) === youtubeTitleKey(prefix[1])))
    return { title, coordinates: undefined, publisherPrefix: false };
  if (
    [Number(prefix[2]), Number(prefix[3])].some(
      (value) => !Number.isSafeInteger(value) || value < 1 || value > 2147483647
    )
  )
    return { title, coordinates: undefined, publisherPrefix: false };
  return {
    title: prefix[4],
    coordinates: { season: Number(prefix[2]), episode: Number(prefix[3]) },
    publisherPrefix: true,
  };
}

/** Every regular canonical coordinate appears once; extras never acquire an episode by position. */
export function mapYoutubeEpisodes(
  mapping: Extract<YoutubeMapping, { kind: "series" }>,
  show: TvdbData,
  inventory: YoutubeIndexRow[],
  revision: string,
  conflictingVideos: ReadonlySet<string> = new Set()
): { rows: YoutubeEpisodeReportRow[]; extras: YoutubeMappingExtra[] } {
  if (show.id !== mapping.targetId || !/^[a-f0-9]{64}$/.test(revision))
    throw new YoutubeMappingError("metadata");
  const rows: YoutubeEpisodeReportRow[] = [];
  const coordinates = new Map<string, YoutubeEpisodeReportRow>();
  const titles = new Map<string, YoutubeEpisodeReportRow[]>();
  const aliases = new Map<string, string>();
  for (const alias of mapping.episodeTitleAliases ?? []) {
    const key = youtubeTitleKey(alias.source);
    if (aliases.has(key)) throw new YoutubeMappingError("mapping");
    aliases.set(key, alias.canonical);
  }
  for (const episode of show.episodes) {
    if (episode.seasonNumber === 0) continue;
    if (
      ![episode.seasonNumber, episode.episodeNumber].every(
        (value) => Number.isSafeInteger(value) && value > 0 && value <= 2147483647
      )
    )
      throw new YoutubeMappingError("metadata");
    const key = `${episode.seasonNumber}:${episode.episodeNumber}`;
    if (coordinates.has(key)) throw new YoutubeMappingError("metadata");
    const row: YoutubeEpisodeReportRow = {
      season: episode.seasonNumber,
      episode: episode.episodeNumber,
      title: episode.name,
      state: "missing",
      sources: [],
    };
    rows.push(row);
    coordinates.set(key, row);
    if (concreteTitle(episode.name)) {
      const title = youtubeTitleKey(episode.name);
      titles.set(title, [...(titles.get(title) ?? []), row]);
    }
  }
  rows.sort((a, b) => a.season - b.season || a.episode - b.episode);
  const blocked = new Set(show.sonarrBlockedCoordinates ?? []);
  const names = [show.name, show.germanName, ...show.aliases.map((alias) => alias.name)].filter(
    (name): name is string => !!name
  );
  const extras: YoutubeMappingExtra[] = [];
  const seen = new Set<string>();
  for (const item of inventory) {
    if (item.mappingKey !== youtubeMappingKey(mapping)) continue;
    if (item.videoId) {
      if (seen.has(item.videoId)) throw new YoutubeMappingError("source");
      seen.add(item.videoId);
    }
    if (item.availability === "listed" && item.channelId !== mapping.channelId)
      throw new YoutubeMappingError("source");
    const historical = item.lastKnown;
    const originalTitle = item.content?.title ?? historical?.title ?? null;
    const extra = (state: YoutubeMappingExtra["state"], reason: YoutubeMappingExtra["reason"]) =>
      extras.push({ videoId: item.videoId, title: originalTitle, state, reason });
    if (!item.videoId || !originalTitle) {
      extra("unavailable", "unavailable");
      continue;
    }
    if (historical && historical.channelId !== mapping.channelId)
      throw new YoutubeMappingError("source");
    const parsed = sourceTitle(originalTitle, names);
    if (
      !concreteTitle(parsed.title) ||
      (mapping.sourceNumbering === "publisher" && !parsed.publisherPrefix)
    ) {
      extra("unmatched", "title_missing");
      continue;
    }
    const alias = aliases.get(youtubeTitleKey(parsed.title));
    const candidates = titles.get(youtubeTitleKey(alias ?? parsed.title)) ?? [];
    if (candidates.length !== 1) {
      for (const candidate of candidates)
        if (candidate.state === "missing") candidate.state = "ambiguous";
      extra(
        candidates.length ? "ambiguous" : "unmatched",
        candidates.length ? "title_ambiguous" : "title_missing"
      );
      continue;
    }
    const row = candidates[0];
    const conflict =
      conflictingVideos.has(item.videoId) || blocked.has(`${row.season}:${row.episode}`)
        ? "metadata_conflict"
        : parsed.coordinates &&
            mapping.sourceNumbering !== "publisher" &&
            (parsed.coordinates.season !== row.season || parsed.coordinates.episode !== row.episode)
          ? "number_conflict"
          : null;
    if (conflict) {
      if (row.state === "missing") row.state = "ambiguous";
      extra("ambiguous", conflict);
      continue;
    }
    row.sources.push({
      videoId: item.videoId,
      originalTitle,
      ...(parsed.coordinates ? { sourceCoordinates: parsed.coordinates } : {}),
      mappingRevision: revision,
      availability: item.availability,
    });
    row.state = row.sources.some((source) => source.availability === "listed")
      ? "mapped"
      : "unavailable";
  }
  return { rows, extras };
}

/** One video cannot silently become different programmes through overlapping mappings. */
export function conflictingYoutubeVideos(
  registry: import("./youtube-catalogue").YoutubeRegistry,
  inventory: YoutubeIndexRow[]
): Set<string> {
  const mappings = new Map(
    registry.programMappings
      .filter(
        (mapping) =>
          mapping.enabled &&
          registry.channels.some((channel) => channel.id === mapping.channelId && channel.enabled)
      )
      .map((mapping) => [youtubeMappingKey(mapping), `${mapping.kind}:${mapping.targetId}`])
  );
  const seen = new Map<string, string>();
  const conflicts = new Set<string>();
  for (const row of inventory) {
    const identity = mappings.get(row.mappingKey);
    if (!row.videoId || !identity) continue;
    const previous = seen.get(row.videoId);
    if (previous && previous !== identity) conflicts.add(row.videoId);
    seen.set(row.videoId, identity);
  }
  return conflicts;
}
