import { z } from "zod";
import { createHash } from "node:crypto";
import { youtubeVideoId, youtubeChannelId, youtubePlaylistId } from "./youtube-catalogue";

const coordinate = z.number().int().positive().max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const programme = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("series"),
      targetId: coordinate,
      season: coordinate,
      episode: coordinate,
    })
    .strict(),
  z.object({ kind: z.literal("movie"), targetId: coordinate }).strict(),
]);
/** Stable programme intent; neither CDN URLs nor a title-derived language are identities. */
export const youtubeSourceIdentitySchema = z
  .object({
    version: z.literal(1),
    family: z.literal("youtube"),
    videoId: youtubeVideoId,
    channelId: youtubeChannelId,
    playlistId: youtubePlaylistId.optional(),
    mappingRevision: hash,
    programme,
    originalTitle: z.string().min(1).max(500),
  })
  .strict()
  .refine((value) => (value.programme.kind === "series" ? !!value.playlistId : !value.playlistId));
const formatId = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9._-]+$/);
/** A selected rendition is immutable in an accepted job; signatures are resolved afresh. */
export const youtubeSelectionSchema = z
  .object({
    videoFormat: formatId,
    audioFormat: formatId,
    audioTrack: z.string().min(1).max(100),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
      .refine((value) => !["und", "mul", "zxx"].includes(value.split("-")[0])),
    width: coordinate.max(65536),
    height: coordinate.max(65536),
    duration: z.number().finite().positive().max(86400),
  })
  .strict();
export const youtubeSourceReferenceSchema = z
  .object({
    ...youtubeSourceIdentitySchema.shape,
    selection: youtubeSelectionSchema,
  })
  .strict()
  .refine((value) => (value.programme.kind === "series" ? !!value.playlistId : !value.playlistId));
export type YoutubeSourceIdentity = z.infer<typeof youtubeSourceIdentitySchema>;
export type YoutubeSourceReference = z.infer<typeof youtubeSourceReferenceSchema>;
export type YoutubeSelection = z.infer<typeof youtubeSelectionSchema>;
export function parseYoutubeSource(value: unknown): YoutubeSourceIdentity | YoutubeSourceReference {
  return value && typeof value === "object" && "selection" in value
    ? youtubeSourceReferenceSchema.parse(value)
    : youtubeSourceIdentitySchema.parse(value);
}
export function youtubeWatchUrl(value: Pick<YoutubeSourceIdentity, "videoId">): string {
  return `https://www.youtube.com/watch?v=${youtubeVideoId.parse(value.videoId)}`;
}
/** An untyped YouTube address must not fall through to the historical file adapter. */
export function rejectUntypedYoutubeUrl(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return;
  }
  if (
    url.hostname === "youtube.com" ||
    url.hostname.endsWith(".youtube.com") ||
    url.hostname === "youtu.be"
  )
    throw Error("YouTube requires a verified typed source reference");
}
/** Stable across signed CDN rotation; mapping changes remain independently guarded. */
export function youtubeRenditionIdentity(value: YoutubeSourceReference): string {
  const source = youtubeSourceReferenceSchema.parse(value);
  return [
    "youtube",
    source.videoId,
    source.selection.videoFormat,
    source.selection.audioFormat,
    source.selection.audioTrack,
    source.selection.language,
  ].join(":");
}
export function youtubeRenditionFingerprint(value: YoutubeSourceReference): string {
  return createHash("sha256").update(youtubeRenditionIdentity(value)).digest("hex");
}
