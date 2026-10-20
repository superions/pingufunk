import { z } from "zod";
import { verifiedDurationCheck } from "./verified-duration";

const durationSchema = z
  .object({
    seconds: z.number().finite().positive().max(Number.MAX_SAFE_INTEGER),
    provenance: z.enum(["source_catalogue", "episode_metadata"]),
  })
  .strict();
const audioSchema = z
  .object({
    language: z
      .string()
      .max(35)
      .regex(/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/)
      .refine((value) => !["und", "mul", "zxx"].includes(value.split("-")[0])),
    provenance: z.literal("provider_audio"),
  })
  .strict();
const resolutionSchema = z
  .object({
    width: z.number().int().positive().max(65_536),
    height: z.number().int().positive().max(65_536),
    provenance: z.literal("provider_dimensions"),
  })
  .strict();

/** NULL is unknown, not a passed duration/language/resolution check. */
const v1Schema = z
  .object({
    version: z.literal(1),
    duration: durationSchema.nullable(),
    audio: audioSchema.nullable(),
    resolution: resolutionSchema.nullable(),
  })
  .strict();
const arteAudioSchema = z
  .object({
    provider: z.literal("arte_hbbtv"),
    videoId: z.string().regex(/^\d{6}-\d{3}-[AF]$/),
    mediaIdentity: z.string().regex(/^[a-f0-9]{64}$/),
    language: audioSchema.shape.language,
  })
  .strict();
const ardAudioSchema = arteAudioSchema
  .extend({
    provider: z.literal("ard_media"),
    videoId: z.string().regex(/^[A-Za-z0-9_-]{16,2048}$/),
  })
  .strict();
export const sourceAudioSchema = z.discriminatedUnion("provider", [
  arteAudioSchema,
  ardAudioSchema,
]);
const v2Schema = v1Schema
  .extend({ version: z.literal(2), audio: z.null(), sourceAudio: sourceAudioSchema })
  .strict();
const toleranceSchema = z.number().int().min(0).max(25);
const v3Schema = z
  .object({
    version: z.literal(3),
    mediaKind: z.enum(["movie", "series", "unknown"]),
    durations: z
      .object({
        source: durationSchema
          .extend({ provenance: z.literal("source_catalogue"), tolerancePercent: z.literal(10) })
          .strict()
          .nullable(),
        metadata: durationSchema
          .extend({ provenance: z.literal("episode_metadata"), tolerancePercent: toleranceSchema })
          .strict()
          .nullable(),
      })
      .strict(),
    audio: audioSchema.nullable(),
    sourceAudio: sourceAudioSchema.nullable(),
    resolution: resolutionSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.durations.metadata && value.mediaKind !== "series")
      context.addIssue({
        code: "custom",
        message: "Episode reference requires verified series context",
      });
    if (value.audio && value.sourceAudio)
      context.addIssue({ code: "custom", message: "Provider evidence is not a container tag" });
  });
export type NewMediaExpectations = z.infer<typeof v3Schema>;
/** Internal-only job decision. It is never accepted from an NZB or SAB upload. */
const v4Schema = z
  .object({
    ...v3Schema.shape,
    version: z.literal(4),
    approval: z
      .object({
        kind: z.literal("episode_runtime_once"),
        jobId: z.uuid(),
        fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
        confirmedAt: z.iso.datetime(),
        tvdbId: z.number().int().positive(),
        season: z.number().int().nonnegative(),
        episode: z.number().int().positive(),
        sourceId: z.string().regex(/^[a-f0-9]{64}$/),
        rendition: z.enum(["hd", "sd", "low"]),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.mediaKind === "series" &&
      !!value.durations.source &&
      !!value.durations.metadata &&
      !!value.resolution &&
      !!value.audio !== !!value.sourceAudio &&
      !verifiedDurationCheck(
        value.durations.source.seconds,
        value.durations.metadata.seconds,
        0,
        value.durations.metadata.tolerancePercent
      ).accepted,
    "Approval requires verified conflicting source facts"
  );
export const mediaExpectationsSchema = z.discriminatedUnion("version", [
  v1Schema,
  v2Schema,
  v3Schema,
  v4Schema,
]);
export type SourceAudioEvidence = z.infer<typeof sourceAudioSchema>;
export type MediaExpectations = z.infer<typeof mediaExpectationsSchema>;
export type LegacyMediaExpectations = Extract<MediaExpectations, { version: 1 | 2 }>;

export function sourceAudioExpectation(
  value: MediaExpectations | null
): SourceAudioEvidence | null {
  return value?.version === 2 || value?.version === 3 || value?.version === 4
    ? value.sourceAudio
    : null;
}

/** v1/v2 keep their shipped dynamic tolerance; v3 carries each frozen reference. */
export function durationExpectations(value: MediaExpectations | null, legacyTolerance: number) {
  // The metadata reference stays intact for audit; only its check is explicitly
  // exempted for this one job. Source duration is still enforced by the worker.
  return value?.version === 4
    ? [value.durations.source].filter((reference) => reference !== null)
    : value?.version === 3
      ? [value.durations.source, value.durations.metadata].filter((reference) => reference !== null)
      : value?.duration
        ? [{ ...value.duration, tolerancePercent: legacyTolerance }]
        : [];
}

export function unknownJobMediaExpectations(): NewMediaExpectations {
  return {
    version: 3,
    mediaKind: "unknown",
    durations: { source: null, metadata: null },
    audio: null,
    sourceAudio: null,
    resolution: null,
  };
}

export class MediaExpectationsError extends Error {
  constructor() {
    super("Invalid media expectations");
  }
}

export class MediaRuntimeConflictError extends Error {
  constructor() {
    super("Source duration conflicts with episode metadata; download requires resolved metadata");
  }
}

/** A visible review candidate must not turn into a download through NZB/SAB. */
export function hasMediaRuntimeConflict(value: MediaExpectations | null | undefined): boolean {
  if (value?.version !== 3) return false;
  const { source, metadata } = value.durations;
  return !!(
    source &&
    metadata &&
    !verifiedDurationCheck(source.seconds, metadata.seconds, 0, metadata.tolerancePercent).accepted
  );
}

export function assertMediaRuntimeCompatible(value: MediaExpectations | null | undefined): void {
  if (value && (value.version === 4 || hasMediaRuntimeConflict(parseMediaExpectations(value))))
    throw new MediaRuntimeConflictError();
}

/** The versioned protocol must be fully valid; corrupt v1 is never legacy. */
export function parseMediaExpectations(value: unknown): MediaExpectations {
  try {
    if (typeof value === "string") {
      if (Buffer.byteLength(value, "utf8") > 4096) throw new MediaExpectationsError();
      value = JSON.parse(value);
    }
    return mediaExpectationsSchema.parse(value);
  } catch {
    // Schema/JSON errors can echo provider payloads and private URLs.
    throw new MediaExpectationsError();
  }
}

export function serializeMediaExpectations(value: MediaExpectations): string {
  return JSON.stringify(parseMediaExpectations(value));
}

/** New producers can declare genuinely unknown facts without inventing defaults. */
export function unknownMediaExpectations(): z.infer<typeof v1Schema> {
  return { version: 1, duration: null, audio: null, resolution: null };
}

/** Only absence denotes legacy compatibility; malformed persisted data fails closed. */
export function readPersistedMediaExpectations(value: unknown): MediaExpectations | null {
  return value === null || value === undefined ? null : parseMediaExpectations(value);
}
