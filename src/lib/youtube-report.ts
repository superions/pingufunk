import { z } from "zod";
import { youtubeVideoId } from "./youtube-catalogue";
const coordinate = z.number().int().positive().max(2147483647);
const sourceSchema = z
  .object({
    videoId: youtubeVideoId,
    originalTitle: z.string().min(1).max(500),
    sourceCoordinates: z.object({ season: coordinate, episode: coordinate }).strict().optional(),
    mappingRevision: z.string().regex(/^[a-f0-9]{64}$/),
    availability: z.enum(["listed", "unavailable"]),
  })
  .strict();
export const youtubeReportSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    mappingKey: z.string().min(1).max(160),
    kind: z.enum(["series", "movie"]),
    targetId: coordinate,
    name: z.string().min(1).max(500),
    state: z.enum([
      "ready",
      "metadata_unavailable",
      "metadata_conflict",
      "source_conflict",
      "index_missing",
      "index_outdated",
    ]),
    indexAt: z.number().int().positive().nullable(),
    indexCurrent: z.boolean(),
    order: z.literal("aired").nullable(),
    mediaReady: z.literal(false),
    page: z.number().int().min(0).max(999),
    rowCount: z.number().int().min(0).max(100000),
    extraCount: z.number().int().min(0).max(1000),
    totals: z
      .object({
        mapped: z.number().int().nonnegative(),
        missing: z.number().int().nonnegative(),
        ambiguous: z.number().int().nonnegative(),
        unavailable: z.number().int().nonnegative(),
      })
      .strict(),
    rows: z
      .array(
        z
          .object({
            season: coordinate.nullable(),
            episode: coordinate.nullable(),
            title: z.string().max(500),
            state: z.enum(["mapped", "missing", "ambiguous", "unavailable"]),
            sources: z.array(sourceSchema).max(1000),
          })
          .strict()
          .refine((row) => (row.season === null) === (row.episode === null))
      )
      .max(100),
    extras: z
      .array(
        z
          .object({
            videoId: youtubeVideoId.nullable(),
            title: z.string().max(500).nullable(),
            state: z.enum(["unavailable", "unmatched", "ambiguous"]),
            reason: z.enum([
              "unavailable",
              "title_missing",
              "title_ambiguous",
              "number_conflict",
              "metadata_conflict",
            ]),
          })
          .strict()
      )
      .max(100),
  })
  .strict();
export type YoutubeReport = z.infer<typeof youtubeReportSchema>;
