import { z } from "zod";

const coordinate = z.number().int().nonnegative().max(10_000);
const episode = z.number().int().positive().max(100_000);
const target = z.object({ season: coordinate, episode }).strict();

/** Public programme identity, never a signed media URL or an installation ID. */
export const mediathekProgrammeBindingSchema = z
  .object({
    website: z
      .url()
      .max(2048)
      .refine((value) => {
        const url = new URL(value);
        return (
          url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash
        );
      }),
    source: z
      .object({
        channel: z.string().min(1).max(100),
        title: z.string().min(1).max(500),
        season: coordinate,
        episode,
      })
      .strict(),
    target,
  })
  .strict();

/** A match adds its verified series context; the selected rendition is frozen later. */
export const mediathekProgrammeIdentitySchema = mediathekProgrammeBindingSchema
  .extend({
    tvdbId: z.number().int().positive().max(2_147_483_647),
    topic: z.string().min(1).max(500),
  })
  .strict();
export const mediathekProgrammeReferenceSchema = mediathekProgrammeIdentitySchema
  .extend({ renditionIdentity: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();

export type MediathekProgrammeBinding = z.infer<typeof mediathekProgrammeBindingSchema>;
export type MediathekProgrammeIdentity = z.infer<typeof mediathekProgrammeIdentitySchema>;
export type MediathekProgrammeReference = z.infer<typeof mediathekProgrammeReferenceSchema>;
