import { z } from "zod";
import { sourceDay } from "./content-dates";

export const YOUTUBE_REGISTRY_KEY = "internal.youtube.registry.v1";
export const YOUTUBE_INDEX_KEY = "internal.youtube.catalogue.v1";
export const YOUTUBE_ENABLED_KEY = "provider.youtube.enabled";
export const YOUTUBE_REGISTRY_BYTES = 1024 * 1024;
export const YOUTUBE_INDEX_BYTES = 8 * 1024 * 1024;
export const YOUTUBE_PAGE_SIZE = 100;
export const YOUTUBE_REFRESH_MS = 6 * 60 * 60 * 1000;
export const youtubeChannelId = z.string().regex(/^UC[A-Za-z0-9_-]{22}$/);
export const youtubeVideoId = z.string().regex(/^[A-Za-z0-9_-]{11}$/);
export const youtubePlaylistId = z.string().regex(/^PL[A-Za-z0-9_-]{10,78}$/);
const label = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[^\x00-\x1f\x7f]+$/);

export const youtubeChannelSchema = z
  .object({
    id: youtubeChannelId,
    name: label,
    enabled: z.boolean(),
  })
  .strict();
export const youtubeMappingSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("series"),
      channelId: youtubeChannelId,
      sourceId: youtubePlaylistId,
      name: label,
      targetId: z.number().int().positive().max(2147483647),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("movie"),
      channelId: youtubeChannelId,
      sourceId: youtubeVideoId,
      name: label,
      targetId: z.number().int().positive().max(2147483647),
      enabled: z.boolean(),
    })
    .strict(),
]);
export type YoutubeChannel = z.infer<typeof youtubeChannelSchema>;
export type YoutubeMapping = z.infer<typeof youtubeMappingSchema>;
export function youtubeMappingKey(
  mapping: Pick<YoutubeMapping, "channelId" | "kind" | "sourceId">
): string {
  return `${mapping.channelId}/${mapping.kind}/${mapping.sourceId}`;
}
export const youtubeRegistrySchema = z
  .object({
    version: z.literal(1),
    channels: z.array(youtubeChannelSchema).max(64),
    programMappings: z.array(youtubeMappingSchema).max(256),
  })
  .strict()
  .superRefine((registry, context) => {
    const channels = new Set(registry.channels.map((channel) => channel.id));
    const mappings = new Set(registry.programMappings.map(youtubeMappingKey));
    if (
      channels.size !== registry.channels.length ||
      mappings.size !== registry.programMappings.length
    )
      context.addIssue({ code: "custom", message: "Kanal oder Quelle ist doppelt eingetragen." });
    for (const mapping of registry.programMappings)
      if (!channels.has(mapping.channelId))
        context.addIssue({
          code: "custom",
          message: "Eine Programmzuordnung benötigt ihren registrierten Kanal.",
        });
  });
export type YoutubeRegistry = z.infer<typeof youtubeRegistrySchema>;

/** Local rows override the same seed identity. New seeds never activate themselves. */
export function mergeYoutubeRegistry(
  seed: YoutubeRegistry,
  local: YoutubeRegistry | null
): YoutubeRegistry {
  const channels = new Map(seed.channels.map((row) => [row.id, { ...row, enabled: false }]));
  const mappings = new Map(
    seed.programMappings.map((row) => [youtubeMappingKey(row), { ...row, enabled: false }])
  );
  for (const row of local?.channels ?? []) channels.set(row.id, row);
  for (const row of local?.programMappings ?? []) mappings.set(youtubeMappingKey(row), row);
  return youtubeRegistrySchema.parse({
    version: 1,
    channels: [...channels.values()],
    programMappings: [...mappings.values()],
  });
}

export type YoutubeInput = { kind: "channel" | "series" | "movie"; id: string; url: string };
/** URLs are input aids; no credentials, redirects, arbitrary hosts or extractor options. */
export function youtubeInput(value: string): YoutubeInput {
  if (value.length > 256 || /[\s\x00-\x1f\x7f]/.test(value))
    throw new Error("Ungültige YouTube-Adresse.");
  if (youtubeChannelId.safeParse(value).success)
    return { kind: "channel", id: value, url: `https://www.youtube.com/channel/${value}` };
  if (youtubePlaylistId.safeParse(value).success)
    return { kind: "series", id: value, url: `https://www.youtube.com/playlist?list=${value}` };
  if (youtubeVideoId.safeParse(value).success)
    return { kind: "movie", id: value, url: `https://www.youtube.com/watch?v=${value}` };
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    !["www.youtube.com", "youtube.com", "youtu.be"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  )
    throw new Error("Nur kanonische HTTPS-Adressen von YouTube sind erlaubt.");
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length) throw new Error("Doppelte YouTube-Parameter.");
  if (
    url.hostname === "youtu.be" &&
    !keys.length &&
    youtubeVideoId.safeParse(url.pathname.slice(1)).success
  )
    return youtubeInput(url.pathname.slice(1));
  if (url.hostname === "youtu.be") throw new Error("Ungültige Video-Adresse.");
  if (url.pathname === "/playlist" && keys.length === 1 && keys[0] === "list")
    return youtubeInput(youtubePlaylistId.parse(url.searchParams.get("list")));
  if (url.pathname === "/watch" && keys.length === 1 && keys[0] === "v")
    return youtubeInput(youtubeVideoId.parse(url.searchParams.get("v")));
  if (!keys.length && url.pathname.startsWith("/channel/"))
    return youtubeInput(youtubeChannelId.parse(url.pathname.slice(9)));
  if (!keys.length && /^\/@[A-Za-z0-9_.-]{3,30}$/.test(url.pathname))
    return { kind: "channel", id: url.pathname, url: `https://www.youtube.com${url.pathname}` };
  throw new Error("Eine Kanal-, Playlist- oder Video-Adresse eingeben.");
}

export const youtubeSaveSchema = z
  .object({
    action: z.literal("save"),
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    enabled: z.boolean(),
    registry: youtubeRegistrySchema,
  })
  .strict();
export type YoutubeSave = z.infer<typeof youtubeSaveSchema>;
export const youtubeScanSchema = z
  .object({
    state: z.enum(["idle", "running", "complete", "failed", "limited", "cancelled", "interrupted"]),
    completedMappings: z.number().int().min(0).max(256),
    batches: z.number().int().min(0).max(2560),
    entries: z.number().int().min(0).max(256000),
    message: z.string().max(500),
  })
  .strict();
export type YoutubeScanState = z.infer<typeof youtubeScanSchema>;
export const youtubeSnapshotSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    enabled: z.boolean(),
    registry: youtubeRegistrySchema,
    scan: youtubeScanSchema,
    lastCompleteAt: z.number().int().positive().nullable(),
    nextRefreshAt: z.number().int().positive().nullable(),
    indexCurrent: z.boolean(),
    presetChannelIds: z.array(youtubeChannelId).max(64),
    presetMappingKeys: z.array(z.string().max(160)).max(256),
  })
  .strict();
export type YoutubeSnapshot = z.infer<typeof youtubeSnapshotSchema>;
export const youtubeInspectionSchema = z
  .object({
    kind: z.enum(["channel", "series", "movie"]),
    sourceId: z.string().max(80),
    channelId: youtubeChannelId,
    channelName: label,
    name: label,
  })
  .strict();
export const youtubeIndexRowSchema = z
  .object({
    videoId: youtubeVideoId.nullable(),
    channelId: youtubeChannelId.nullable(),
    mappingKey: z.string().max(160),
    availability: z.enum(["listed", "unavailable"]),
    content: z
      .object({
        channel: label,
        topic: label,
        title: z.string().min(1).max(500),
        description: z.string().max(8000),
        duration: z.number().finite().nonnegative(),
        size: z.literal(0),
        filmlisteTimestamp: z.number().int().positive(),
        url_website: z.string().regex(/^https:\/\/www\.youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/),
        url_video: z.literal(""),
        url_video_hd: z.literal(""),
        url_video_low: z.literal(""),
        contentDates: z
          .object({
            providerDay: z
              .string()
              .regex(/^\d{4}-\d{2}-\d{2}$/)
              .refine((value) => sourceDay(value) === value)
              .optional(),
            catalogueUpdatedAt: z.number().int().positive(),
          })
          .strict(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((row, context) => {
    if (
      row.availability === "listed"
        ? !row.content ||
          !row.videoId ||
          !row.channelId ||
          row.content.url_website !== `https://www.youtube.com/watch?v=${row.videoId}` ||
          !row.mappingKey.startsWith(`${row.channelId}/`)
        : row.content !== null || row.channelId !== null
    )
      context.addIssue({ code: "custom", message: "Invalid catalogue row" });
  });
export type YoutubeIndexRow = z.infer<typeof youtubeIndexRowSchema>;

export class YoutubeCatalogueDataError extends Error {
  constructor(readonly reason: "missing_id" | "foreign_uploader" | "invalid_row" | "duplicate_id") {
    super(
      {
        missing_id: "Stabile Video- oder Kanal-ID fehlt in den Metadaten.",
        foreign_uploader:
          "Playlist oder Video gehört zu einem anderen Uploader als dem registrierten Kanal.",
        invalid_row:
          "Unvollständige oder ungültige Katalogzeile; kein vollständiger Index bestätigt.",
        duplicate_id: "Eine Video-ID erscheint mehrfach in derselben Playlist.",
      }[reason]
    );
  }
}
function metadataObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new YoutubeCatalogueDataError("invalid_row");
  return value as Record<string, unknown>;
}
function metadataText(value: unknown, limit: number): string {
  return typeof value === "string" &&
    value.length <= limit &&
    !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)
    ? value
    : "";
}
/** Pure metadata projection; no provider I/O, persistence, canonical episode or media claim. */
export function normalizeYoutubeInspection(raw: unknown, input: YoutubeInput) {
  const row = metadataObject(raw);
  const channel = youtubeChannelId.safeParse(row.channel_id);
  if (!channel.success) throw new YoutubeCatalogueDataError("missing_id");
  if (
    (input.kind === "channel" && !input.id.startsWith("/@") && channel.data !== input.id) ||
    (input.kind !== "channel" && row.id !== input.id)
  )
    throw new YoutubeCatalogueDataError("invalid_row");
  return youtubeInspectionSchema.parse({
    kind: input.kind,
    sourceId: input.kind === "channel" ? channel.data : input.id,
    channelId: channel.data,
    channelName: metadataText(row.channel, 160),
    name: metadataText(row.title, 160) || metadataText(row.channel, 160),
  });
}

export function normalizeYoutubePage(
  raw: unknown,
  mapping: YoutubeMapping,
  channel: YoutubeChannel,
  indexedAt: number
): YoutubeIndexRow[] {
  const result = metadataObject(raw);
  if (result.id !== mapping.sourceId) throw new YoutubeCatalogueDataError("invalid_row");
  if (result.channel_id !== channel.id) throw new YoutubeCatalogueDataError("foreign_uploader");
  const entries = mapping.kind === "movie" ? [result] : result.entries;
  if (!Array.isArray(entries) || entries.length > YOUTUBE_PAGE_SIZE)
    throw new YoutubeCatalogueDataError("invalid_row");
  return entries.map((value) => {
    const row = metadataObject(value);
    const id = youtubeVideoId.safeParse(row.id);
    const unavailable =
      ["private", "unavailable", "needs_auth", "subscriber_only", "premium_only"].includes(
        String(row.availability)
      ) ||
      ["[Private video]", "[Deleted video]", "[Unavailable video]"].includes(String(row.title));
    if (row.channel_id !== undefined && row.channel_id !== null && row.channel_id !== channel.id)
      throw new YoutubeCatalogueDataError("foreign_uploader");
    if (unavailable)
      return {
        videoId: id.success ? id.data : null,
        channelId: null,
        mappingKey: youtubeMappingKey(mapping),
        availability: "unavailable",
        content: null,
      };
    if (!id.success) throw new YoutubeCatalogueDataError("missing_id");
    if (!youtubeChannelId.safeParse(row.channel_id).success)
      throw new YoutubeCatalogueDataError("missing_id");
    const title = metadataText(row.title, 500);
    if (!title.trim()) throw new YoutubeCatalogueDataError("invalid_row");
    const upload =
      typeof row.upload_date === "string" && /^\d{8}$/.test(row.upload_date)
        ? sourceDay(
            `${row.upload_date.slice(0, 4)}-${row.upload_date.slice(4, 6)}-${row.upload_date.slice(6)}`
          )
        : undefined;
    return youtubeIndexRowSchema.parse({
      videoId: id.data,
      channelId: channel.id,
      mappingKey: youtubeMappingKey(mapping),
      availability: "listed",
      content: {
        channel: channel.name,
        topic: mapping.name,
        title,
        description: metadataText(row.description, 8000),
        duration:
          typeof row.duration === "number" && Number.isFinite(row.duration) && row.duration > 0
            ? row.duration
            : 0,
        size: 0,
        filmlisteTimestamp: indexedAt,
        url_website: `https://www.youtube.com/watch?v=${id.data}`,
        url_video: "",
        url_video_hd: "",
        url_video_low: "",
        contentDates: { ...(upload ? { providerDay: upload } : {}), catalogueUpdatedAt: indexedAt },
      },
    });
  });
}
export const youtubePageSchema = z
  .object({
    items: z.array(youtubeIndexRowSchema).max(100),
    count: z.number().int().nonnegative(),
    current: z.boolean(),
  })
  .strict();

/** Verify actual saved/read-back rows, not a 200 response or echoed success flag. */
export function confirmedYoutubeSave(payload: unknown, submitted: YoutubeSave): YoutubeSnapshot {
  const result = payload as { success?: unknown; snapshot?: YoutubeSnapshot };
  const parsed = youtubeSnapshotSchema.safeParse(result?.snapshot);
  const snapshot = parsed.success ? parsed.data : null;
  if (
    result?.success !== true ||
    !snapshot ||
    !/^[a-f0-9]{64}$/.test(snapshot.revision) ||
    snapshot.revision === submitted.revision ||
    snapshot.enabled !== submitted.enabled ||
    !youtubeRegistrySchema.safeParse(snapshot.registry).success ||
    JSON.stringify(snapshot.registry) !== JSON.stringify(submitted.registry)
  )
    throw new Error("Speichern unbestätigt. Vor erneutem Speichern neu laden.");
  return snapshot;
}
