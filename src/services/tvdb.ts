import {
  cacheMetadataMiss,
  coalesceMetadata,
  hasMetadataMiss,
  metadataCacheKey,
  tvdbCache,
} from "@/lib/cache";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { getSettings } from "@/lib/settings";
import { buildTvdbLoginPayload } from "@/lib/tvdb-auth";
import type { TvdbData, TvdbEpisode, TvdbAlias } from "@/types";
import { createHash } from "node:crypto";

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

async function getToken(): Promise<string | null> {
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

  return refreshToken(payload, credentialHash);
}

async function refreshToken(
  payload: ReturnType<typeof buildTvdbLoginPayload>,
  credentialHash: string
): Promise<string | null> {
  if (!payload) return null;
  try {
    const response = await fetchWithRetry(`${TVDB_API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.status === "success" && data.data?.token) {
      const token = data.data.token;
      const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Legacy DB token rows are left intact for migration but never reused.
      cachedToken = token;
      tokenExpiry = expiry;
      tokenCredentialHash = credentialHash;

      return token;
    }

    console.error("Failed to get TVDB token");
    return null;
  } catch {
    console.error("Error refreshing TVDB token");
    return null;
  }
}

export async function getShowInfoByTvdbId(tvdbId: number): Promise<TvdbData | null> {
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

  return coalesceMetadata(cacheKey, () => fetchAndCacheSeriesData(tvdbId, cacheKey)).catch(
    () => null
  );
}

async function fetchAndCacheSeriesData(tvdbId: number, cacheKey: string): Promise<TvdbData | null> {
  const token = await getToken();
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
      }
    );

    if (response.status === 404) {
      cacheMetadataMiss(cacheKey);
      return null;
    }
    if (!response.ok) return null;

    const data = await response.json();

    if (!data || data.status !== "success") {
      console.error("Failed to fetch data from TVDB");
      return null;
    }

    const series = data.data;

    // Extract German name from translations
    const germanName = series.nameTranslations?.deu || series.name;

    // Extract German aliases
    const rawAliases = series.aliases || [];
    const germanAliases: TvdbAlias[] = rawAliases
      .filter((alias: { language?: string; name?: string }) => alias.language === "deu")
      .map((alias: { language: string; name: string }) => ({
        language: alias.language,
        name: alias.name,
      }));

    // Map episodes
    const episodes: TvdbEpisode[] = (series.episodes || []).map(
      (ep: {
        name?: string;
        aired?: string;
        runtime?: number;
        seasonNumber: number;
        number: number;
      }) => ({
        name: ep.name || "",
        aired: ep.aired ? new Date(ep.aired) : null,
        runtime: ep.runtime || null,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.number,
      })
    );

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
    return null;
  }
}
