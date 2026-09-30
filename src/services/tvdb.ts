import {
  cacheMetadataMiss,
  coalesceMetadata,
  hasMetadataMiss,
  metadataCacheKey,
  tvdbCache,
} from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import type { HttpRequestBudget } from "@/lib/fetch-retry";
import { ProviderResponseError, readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { getSettings } from "@/lib/settings";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";
import type { TvdbData, TvdbEpisode, TvdbAlias } from "@/types";
import { createHash } from "node:crypto";
import { z } from "zod";

const TVDB_API_URL = "https://api4.thetvdb.com/v4";

// Token management
let cachedToken: string | null = null;
let tokenExpiry: Date | null = null;
let tokenCredentialHash: string | null = null;

export function clearTvdbTokenMemoryCache(): void {
  cachedToken = null;
  tokenExpiry = null;
  tokenCredentialHash = null;
}

export async function clearTvdbTokenCache(): Promise<void> {
  clearTvdbTokenMemoryCache();
}

async function getToken(budget?: HttpRequestBudget): Promise<string | null> {
  const settings = await getSettings(["api.tvdb.key", "api.tvdb.pin"]);
  const apiKey = settings["api.tvdb.key"];
  const pin = settings["api.tvdb.pin"];
  const payload = buildTvdbLoginPayload(apiKey, pin);
  if (!payload) {
    console.error("TVDB API key not configured in settings");
    return null;
  }
  const credentialHash = createHash("sha256")
    .update(JSON.stringify([apiKey, pin]))
    .digest("hex");
  if (credentialHash !== tokenCredentialHash) clearTvdbTokenMemoryCache();
  if (cachedToken && tokenExpiry && new Date() < tokenExpiry) return cachedToken;

  return refreshToken(payload, credentialHash, budget);
}

async function refreshToken(
  payload: ReturnType<typeof buildTvdbLoginPayload>,
  credentialHash: string,
  budget?: HttpRequestBudget
): Promise<string | null> {
  if (!payload) return null;
  try {
    const response = await fetchWithRetry(
      `${TVDB_API_URL}/login`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      { requestBudget: budget }
    );
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderResponseError();
    }
    const data = z
      .object({
        status: z.string(),
        data: z.object({ token: z.string().min(1).max(8192) }).optional(),
      })
      .parse(
        await readBoundedProviderJson(
          response,
          budget?.deadlineAt ?? Date.now() + 15_000,
          64 * 1024
        )
      );

    if (data.status === "success" && data.data?.token) {
      const token = data.data.token;
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Legacy DB token rows are left intact for migration but never reused.
      cachedToken = token;
      tokenExpiry = expiry;
      tokenCredentialHash = credentialHash;

      return token;
    }

    throw new ProviderResponseError();
  } catch {
    console.error("Error refreshing TVDB token");
    if (budget) throw new ProviderResponseError();
    return null;
  }
}

export async function getShowInfoByTvdbId(
  tvdbId: number,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  // Guard against undefined/null tvdbId
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  const settings = await getSettings(["api.tvdb.key", "api.tvdb.pin"]);
  if (!buildTvdbLoginPayload(settings["api.tvdb.key"], settings["api.tvdb.pin"])) return null;
  const cacheKey = metadataCacheKey("tvdb-series", tvdbId, [
    settings["api.tvdb.key"],
    settings["api.tvdb.pin"],
  ]);
  const cached = tvdbCache.get(cacheKey) as TvdbData | undefined;
  if (cached) {
    return cached;
  }

  if (hasMetadataMiss(cacheKey)) return null;

  // Explicit callers retain their own deadline rather than joining another request.
  if (budget) return fetchAndCacheSeriesData(tvdbId, cacheKey, budget);
  return coalesceMetadata(cacheKey, () => fetchAndCacheSeriesData(tvdbId, cacheKey)).catch(
    () => null
  );
}

const seriesResponseSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    id: z.number().int().positive(),
    name: z.string().min(1).max(500),
    nameTranslations: z.union([z.record(z.string(), z.string()), z.array(z.string())]).nullish(),
    aliases: z
      .array(z.object({ language: z.string(), name: z.string().max(500) }))
      .max(1000)
      .nullish(),
    episodes: z
      .array(
        z.object({
          name: z.string().nullable().optional(),
          aired: z.string().nullable().optional(),
          runtime: z.number().finite().nonnegative().nullable().optional(),
          seasonNumber: z.number().int().nonnegative(),
          number: z.number().int().nonnegative(),
        })
      )
      .max(100_000)
      .nullish(),
  }),
});

async function fetchAndCacheSeriesData(
  tvdbId: number,
  cacheKey: string,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  const token = await getToken(budget);
  if (!token) {
    return null;
  }

  try {
    const response = await fetchWithRetry(
      `${TVDB_API_URL}/series/${tvdbId}/extended?meta=episodes&short=true`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
      },
      { requestBudget: budget }
    );

    if (response.status === 404) {
      void response.body?.cancel().catch(() => {});
      cacheMetadataMiss(cacheKey);
      return null;
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      throw new ProviderResponseError();
    }
    const data = seriesResponseSchema.parse(
      await readBoundedProviderJson(
        response,
        budget?.deadlineAt ?? Date.now() + 15_000,
        8 * 1024 * 1024
      )
    );

    const series = data.data;
    if (series.id !== tvdbId) throw new ProviderResponseError();

    // Extract German name from translations
    const germanName = !Array.isArray(series.nameTranslations)
      ? series.nameTranslations?.deu || series.name
      : series.name;

    // Extract German aliases
    const rawAliases = series.aliases || [];
    const germanAliases: TvdbAlias[] = rawAliases
      .filter((alias: { language?: string; name?: string }) => alias.language === "deu")
      .map((alias: { language: string; name: string }) => ({
        language: alias.language,
        name: alias.name,
      }));

    // Map episodes
    const episodes: TvdbEpisode[] = (series.episodes || []).map((ep) => ({
      name: ep.name || "",
      aired: ep.aired ? new Date(ep.aired) : null,
      runtime: ep.runtime || null,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.number,
    }));

    const tvdbData: TvdbData = {
      id: tvdbId,
      name: series.name,
      germanName: germanName,
      aliases: germanAliases,
      episodes: episodes,
    };

    tvdbCache.set(cacheKey, tvdbData);

    return tvdbData;
  } catch {
    console.error("Error fetching TVDB data");
    if (budget) throw new ProviderResponseError();
    return null;
  }
}
