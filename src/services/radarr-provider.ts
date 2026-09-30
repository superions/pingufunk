import { z } from "zod";
import { LRUCache } from "lru-cache";
import { getSetting } from "@/lib/settings";
import { externalCredential } from "@/lib/credential-settings";
import { cacheContextEpoch, metadataCacheKey } from "@/lib/cache";
import { createReadOnlyArrJsonClient } from "@/lib/read-only-arr-client";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import type { TmdbMovieData } from "@/types";

export class RadarrUnavailableError extends Error {
  constructor() {
    super("Optional movie metadata unavailable");
  }
}

const id = z.number().int().positive().max(2_147_483_647);
const movieSchema = z.object({
  tmdbId: id,
  imdbId: z
    .string()
    .regex(/^tt\d{7,10}$/)
    .nullish(),
  title: z.string().trim().min(1).max(500),
  originalTitle: z.string().trim().min(1).max(500),
  year: z.number().int().min(1800).max(2200),
  runtime: z.number().int().nonnegative().max(100_000).nullish(),
  alternateTitles: z
    .array(z.object({ title: z.string().trim().min(1).max(500) }))
    .max(200)
    .optional(),
});

/** Only documented movie metadata; never paths, credentials or library state. */
export function parseRadarrMovie(payload: unknown): TmdbMovieData {
  const parsed = movieSchema.safeParse(payload);
  if (!parsed.success) throw new RadarrUnavailableError();
  const movie = parsed.data;
  return {
    tmdbId: movie.tmdbId,
    imdbId: movie.imdbId ?? null,
    title: movie.originalTitle,
    germanTitle: movie.title,
    aliases: [...new Set(movie.alternateTitles?.map((alias) => alias.title) ?? [])],
    runtime: movie.runtime || null,
    productionYear: movie.year,
    // Radarr provides a year, not a synthetic January 1 release date.
    releaseDate: null,
  };
}

const cache = new LRUCache<string, { value: TmdbMovieData; expiresAt: number }>({ max: 256 });

/** Disabled means no secret I/O or HTTP. Enabled failures cannot become empty success. */
export async function getRadarrMovie(
  tmdbId: number | null,
  imdbId: string | null,
  budget: HttpRequestBudget
): Promise<TmdbMovieData | null> {
  if ((await getSetting("integration.radarr.enabled")) !== "true") return null;
  try {
    if (
      (tmdbId === null && imdbId === null) ||
      (tmdbId !== null && !id.safeParse(tmdbId).success) ||
      (imdbId !== null && !/^tt\d{7,10}$/.test(imdbId))
    )
      throw new RadarrUnavailableError();
    const epoch = cacheContextEpoch();
    const baseUrl = await getSetting("integration.radarr.url");
    const credential = await externalCredential("PINGUFUNK_RADARR_API_KEY");
    if (!baseUrl || !credential.configured || !credential.value) throw new RadarrUnavailableError();
    const key = metadataCacheKey("radarr-movie", [tmdbId, imdbId], [baseUrl, credential.value]);
    const assertCurrent = () => {
      if (epoch !== cacheContextEpoch() || Date.now() >= budget.deadlineAt)
        throw new RadarrUnavailableError();
    };
    assertCurrent();
    const stored = cache.get(key);
    if (stored && Date.now() < stored.expiresAt) return structuredClone(stored.value);
    const client = createReadOnlyArrJsonClient(baseUrl, credential.value);
    const status = z
      .object({ version: z.string().regex(/^6\.\d+\.\d+(?:\.\d+)?$/) })
      .safeParse(await client("api/v3/system/status", undefined, { requestBudget: budget }));
    if (!status.success) throw new RadarrUnavailableError();
    const query = new URLSearchParams(
      tmdbId !== null ? { tmdbId: String(tmdbId) } : { imdbId: imdbId! }
    );
    const movie = parseRadarrMovie(
      await client(
        tmdbId !== null ? "api/v3/movie/lookup/tmdb" : "api/v3/movie/lookup/imdb",
        query,
        { requestBudget: budget }
      )
    );
    if (
      (tmdbId !== null && movie.tmdbId !== tmdbId) ||
      (imdbId !== null && movie.imdbId !== imdbId)
    )
      throw new RadarrUnavailableError();
    assertCurrent();
    cache.set(key, { value: structuredClone(movie), expiresAt: Date.now() + 600_000 });
    return movie;
  } catch {
    throw new RadarrUnavailableError();
  }
}
