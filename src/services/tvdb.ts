import { prisma } from "@/lib/db";
import { tvdbCache } from "@/lib/cache";
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

  // Check memory cache first
  const cacheKey = `tvdb_${tvdbId}`;
  const cached = tvdbCache.get(cacheKey) as TvdbData | undefined;
  if (cached) {
    return cached;
  }

  // Check database cache
  const dbSeries = await prisma.tvdbSeries.findUnique({
    where: { id: tvdbId },
    include: { episodes: true },
  });

  if (dbSeries && new Date() < dbSeries.expiresAt) {
    const tvdbData: TvdbData = {
      id: dbSeries.id,
      name: dbSeries.name,
      germanName: dbSeries.germanName,
      aliases: dbSeries.aliases ? JSON.parse(dbSeries.aliases) : [],
      episodes: dbSeries.episodes.map((ep) => ({
        name: ep.name || "",
        aired: ep.aired,
        runtime: ep.runtime,
        seasonNumber: ep.seasonNumber,
        episodeNumber: ep.episodeNumber,
      })),
    };

    tvdbCache.set(cacheKey, tvdbData);
    return tvdbData;
  }

  // Fetch from TVDB API
  return fetchAndCacheSeriesData(tvdbId);
}

async function fetchAndCacheSeriesData(tvdbId: number): Promise<TvdbData | null> {
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

    // Calculate cache expiry based on activity
    const now = new Date();
    const lastUpdated = series.lastUpdated ? new Date(series.lastUpdated) : new Date("1970-01-01");
    const nextAired = series.nextAired ? new Date(series.nextAired) : new Date("1970-01-01");
    const lastAired = series.lastAired ? new Date(series.lastAired) : new Date("1970-01-01");

    let cacheExpiry = new Date();
    const daysDiff = (d1: Date, d2: Date) =>
      Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);

    if (
      daysDiff(lastUpdated, now) < 7 ||
      (nextAired.getTime() > 0 && daysDiff(nextAired, now) < 6) ||
      (lastAired.getTime() > 0 && daysDiff(lastAired, now) < 3)
    ) {
      cacheExpiry.setDate(cacheExpiry.getDate() + 2);
    } else {
      cacheExpiry.setDate(cacheExpiry.getDate() + 6);
    }

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

    // Store in database
    await prisma.$transaction(async (tx) => {
      // Delete existing data
      await tx.tvdbEpisode.deleteMany({ where: { seriesId: tvdbId } });
      await tx.tvdbSeries.deleteMany({ where: { id: tvdbId } });

      // Insert series
      await tx.tvdbSeries.create({
        data: {
          id: tvdbId,
          name: series.name,
          germanName: germanName,
          slug: series.slug || null,
          firstAired: series.firstAired ? new Date(series.firstAired) : null,
          aliases: JSON.stringify(germanAliases),
          expiresAt: cacheExpiry,
        },
      });

      // Insert episodes in batch
      const episodesData = (series.episodes || []).map(
        (ep: {
          id: number;
          name?: string;
          aired?: string;
          runtime?: number;
          seasonNumber: number;
          number: number;
        }) => ({
          id: ep.id,
          seriesId: tvdbId,
          name: ep.name || "",
          aired: ep.aired ? new Date(ep.aired) : null,
          runtime: ep.runtime || null,
          seasonNumber: ep.seasonNumber,
          episodeNumber: ep.number,
        })
      );

      if (episodesData.length > 0) {
        await tx.tvdbEpisode.createMany({ data: episodesData });
      }
    });

    const tvdbData: TvdbData = {
      id: tvdbId,
      name: series.name,
      germanName: germanName,
      aliases: germanAliases,
      episodes: episodes,
    };

    // Store in memory cache
    const cacheKey = `tvdb_${tvdbId}`;
    tvdbCache.set(cacheKey, tvdbData);

    return tvdbData;
  } catch {
    console.error("Error fetching TVDB data");
    return null;
  }
}
