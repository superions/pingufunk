import { z } from "zod";

export class SonarrMetadataError extends Error {
  constructor() {
    super("Sonarr metadata identity or schema is invalid");
  }
}

const positiveId = z.number().int().positive().max(2_147_483_647);
const seriesSchema = z.object({
  id: positiveId,
  tvdbId: positiveId,
  title: z.string().trim().min(1),
  monitored: z.boolean().nullish(),
  alternateTitles: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(1024),
        seasonNumber: z.number().int().min(-1).max(2_147_483_647),
      })
    )
    .max(256)
    .nullish(),
});
const episodeSchema = z.object({
  id: positiveId,
  seriesId: positiveId,
  seasonNumber: z.number().int().nonnegative().max(2_147_483_647),
  episodeNumber: positiveId,
  title: z.string().trim().min(1),
  airDateUtc: z.string().nullish(),
  runtime: z.number().int().nonnegative().max(2_147_483_647).nullish(),
});

export interface SonarrSeriesMetadata {
  sonarrId: number;
  tvdbId: number;
  title: string;
  monitored: boolean;
  /** Only series-wide aliases; season-scoped scene titles are not global identities. */
  aliases?: string[];
}

export interface SonarrEpisodeMetadata {
  sonarrId: number;
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title: string;
  aired: Date | null;
  /** EpisodeResource.runtime in minutes, converted once; never Series.runtime. */
  expectedRuntimeSeconds: number | null;
}

/** Fail closed on unsupported majors; API v3 is not the Sonarr major version. */
export function parseSonarrVersion(payload: unknown): string {
  const result = z
    .object({ version: z.string().regex(/^[34]\.\d+\.\d+(?:\.\d+)?$/) })
    .safeParse(payload);
  if (!result.success) throw new SonarrMetadataError();
  return result.data.version;
}

/** Local IDs belong to this instance only; TVDB identifies the requested series. */
export function parseSonarrSeries(payload: unknown): SonarrSeriesMetadata[] {
  const result = z.array(seriesSchema).max(5_000).safeParse(payload);
  if (!result.success) throw new SonarrMetadataError();
  const ids = new Set<number>();
  const tvdbIds = new Set<number>();
  return result.data.map((series) => {
    if (ids.has(series.id) || tvdbIds.has(series.tvdbId)) throw new SonarrMetadataError();
    ids.add(series.id);
    tvdbIds.add(series.tvdbId);
    return {
      sonarrId: series.id,
      tvdbId: series.tvdbId,
      title: series.title,
      monitored: series.monitored === true,
      ...(series.alternateTitles
        ? {
            aliases: [
              ...new Set(
                series.alternateTitles
                  .filter((alias) => alias.seasonNumber === -1)
                  .map((alias) => alias.title)
              ),
            ],
          }
        : {}),
    };
  });
}

/** UTC timestamps only; date-only broadcast days do not prove an RSS instant. */
function parseAired(value: string | null | undefined): Date | null {
  if (!value) return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,7})?(?:Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!match) return null;
  const [, year, month, day, hour, minute, second] = match.map(Number);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  )
    return null;
  const aired = new Date(value);
  return Number.isFinite(aired.getTime()) ? aired : null;
}

/** Reject foreign/duplicate coordinates rather than publishing a partial snapshot. */
export function parseSonarrEpisodes(payload: unknown, seriesId: number): SonarrEpisodeMetadata[] {
  if (!positiveId.safeParse(seriesId).success) throw new SonarrMetadataError();
  const result = z.array(episodeSchema).max(20_000).safeParse(payload);
  if (!result.success) throw new SonarrMetadataError();
  const ids = new Set<number>();
  const coordinates = new Set<string>();
  return result.data.map((episode) => {
    const coordinate = `${episode.seasonNumber}:${episode.episodeNumber}`;
    if (episode.seriesId !== seriesId || ids.has(episode.id) || coordinates.has(coordinate))
      throw new SonarrMetadataError();
    ids.add(episode.id);
    coordinates.add(coordinate);
    return {
      sonarrId: episode.id,
      seriesId: episode.seriesId,
      seasonNumber: episode.seasonNumber,
      episodeNumber: episode.episodeNumber,
      title: episode.title,
      aired: parseAired(episode.airDateUtc),
      expectedRuntimeSeconds: episode.runtime ? episode.runtime * 60 : null,
    };
  });
}
