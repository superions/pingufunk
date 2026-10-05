import { z } from "zod";

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
export const mediaExpectationsSchema = z.discriminatedUnion("version", [v1Schema, v2Schema]);
export type SourceAudioEvidence = z.infer<typeof sourceAudioSchema>;
export type MediaExpectations = z.infer<typeof mediaExpectationsSchema>;

export class MediaExpectationsError extends Error {
  constructor() {
    super("Invalid media expectations");
  }
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
