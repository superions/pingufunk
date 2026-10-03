import { z } from "zod";
import { LRUCache } from "lru-cache";
import { getSetting } from "@/lib/settings";
import { externalCredential } from "@/lib/credential-settings";
import { cacheContextEpoch, metadataCacheKey } from "@/lib/cache";
import { createReadOnlyArrJsonClient } from "@/lib/read-only-arr-client";
import { RADARR_DEFAULT_SETTINGS, validateRadarrSetting } from "@/lib/radarr-settings";
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
const inventories = new LRUCache<string, { value: TmdbMovieData[]; expiresAt: number }>({ max: 4 });

/** A bounded monitored library supplies RSS goals, not identities for source videos. */
export async function getRadarrMonitoredMovies(
  budget: HttpRequestBudget
): Promise<TmdbMovieData[]> {
  if ((await getSetting("integration.radarr.enabled")) !== "true") return [];
  try {
    const epoch = cacheContextEpoch();
    const url = await getSetting("integration.radarr.url");
    const limitKey = "integration.radarr.inventoryMaxMiB";
    const limit = validateRadarrSetting(
      limitKey,
      (await getSetting(limitKey)) ?? RADARR_DEFAULT_SETTINGS[limitKey]
    );
    if (!limit) throw new RadarrUnavailableError();
    const maximumBytes = Number(limit) * 1024 * 1024;
    const credential = await externalCredential("PINGUFUNK_RADARR_API_KEY");
    if (!url || !credential.configured || !credential.value) throw new RadarrUnavailableError();
    const key = metadataCacheKey("radarr-monitored-inventory", maximumBytes, [
      url,
      credential.value,
    ]);
    const assertCurrent = () => {
      if (epoch !== cacheContextEpoch() || Date.now() >= budget.deadlineAt)
        throw new RadarrUnavailableError();
    };
    assertCurrent();
    const stored = inventories.get(key);
    if (stored && Date.now() < stored.expiresAt) return structuredClone(stored.value);
    const client = createReadOnlyArrJsonClient(url, credential.value);
    const status = z
      .object({ version: z.string().regex(/^6\.\d+\.\d+(?:\.\d+)?$/) })
      .safeParse(await client("api/v3/system/status", undefined, { requestBudget: budget }));
    if (!status.success) throw new RadarrUnavailableError();
    const payload = z
      .array(z.unknown())
      .max(2000)
      // Library responses include cover/overview fields. Bound this larger,
      // explicitly selected response separately; all individual lookups keep 5 MiB.
      .safeParse(await client("api/v3/movie", undefined, { requestBudget: budget }, maximumBytes));
    if (!payload.success) throw new RadarrUnavailableError();
    const seen = new Set<number>();
    const movies: TmdbMovieData[] = [];
    for (const row of payload.data) {
      const monitored = z.object({ monitored: z.boolean() }).safeParse(row);
      if (!monitored.success) throw new RadarrUnavailableError();
      if (!monitored.data.monitored) continue;
      const movie = parseRadarrMovie(row);
      if (seen.has(movie.tmdbId)) throw new RadarrUnavailableError();
      seen.add(movie.tmdbId);
      movies.push(movie);
    }
    assertCurrent();
    inventories.set(key, { value: structuredClone(movies), expiresAt: Date.now() + 60_000 });
    return movies;
  } catch {
    throw new RadarrUnavailableError();
  }
}

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
    // Prefer persisted library metadata: the tmdbId filter is documented by
    // Radarr 6 and does not depend on Skyhook being reachable during a search.
    // A malformed/mismatched local response must not become a remote fallback.
    let payload: unknown;
    if (tmdbId !== null) {
      const local = z
        .array(z.unknown())
        .max(1)
        .safeParse(await client("api/v3/movie", query, { requestBudget: budget }));
      if (!local.success) throw new RadarrUnavailableError();
      payload = local.data[0];
    }
    if (payload === undefined)
      payload = await client(
        tmdbId !== null ? "api/v3/movie/lookup/tmdb" : "api/v3/movie/lookup/imdb",
        query,
        { requestBudget: budget }
      );
    const movie = parseRadarrMovie(payload);
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
