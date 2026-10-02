import { promises as fs } from "fs";
import path from "path";
import { getSetting } from "@/lib/settings";
import type { TvdbData } from "@/types";
import { getShowInfoByTvdbId as getTvdbShow } from "./tvdb";
import { getShowInfoByTvdbId as getTmdbShow } from "./tmdb";
import { mergeSonarrShow, openSonarrSession, SonarrUnavailableError } from "./sonarr-provider";
import type { HttpRequestBudget } from "@/lib/fetch-retry";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { ProviderResponseError, readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { z } from "zod";
import { LRUCache } from "lru-cache";
import { metadataCacheKey } from "@/lib/cache";

// Local shows data
interface LocalShow {
  tvdbId: number;
  name: string;
  germanName: string;
  aliases: string[];
  episodes: Array<{
    name: string;
    seasonNumber: number;
    episodeNumber: number;
    aired: string | null;
    runtime?: number | null;
  }>;
}

let localShows: Map<number, LocalShow> = new Map();
let localShowsLoaded = false;
let lastShowsFetchTime: number = 0;
const SHOWS_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const baseShows = new LRUCache<string, TvdbData>({ max: 256, ttl: 600_000 });

// GitHub raw URL for auto-update
const GITHUB_SHOWS_URL =
  process.env.SHOWS_URL ||
  "https://raw.githubusercontent.com/rundfunkarr/rundfunkarr/main/data/shows.json";

const localShowsSchema = z
  .array(
    z.object({
      tvdbId: z.number().int().positive(),
      name: z.string().min(1).max(500),
      germanName: z.string().max(500),
      aliases: z.array(z.string().max(500)).max(1000),
      episodes: z
        .array(
          z.object({
            name: z.string(),
            seasonNumber: z.number().int().nonnegative(),
            episodeNumber: z.number().int().positive(),
            aired: z.string().nullable(),
            runtime: z.number().finite().nonnegative().nullable().optional(),
          })
        )
        .max(100_000),
    })
  )
  .max(10_000);

async function fetchShowsFromGitHub(budget?: HttpRequestBudget): Promise<LocalShow[] | null> {
  try {
    const url = new URL(GITHUB_SHOWS_URL);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new ProviderResponseError();
    console.log("[Shows] Refreshing show catalogue");
    const response = await fetchWithRetry(
      GITHUB_SHOWS_URL,
      {
        headers: { "User-Agent": "RundfunkArr" },
      },
      { requestBudget: budget }
    );

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.warn(`[Shows] GitHub fetch failed: ${response.status}`);
      return null;
    }

    const shows = localShowsSchema.parse(
      await readBoundedProviderJson(
        response,
        budget?.deadlineAt ?? Date.now() + 15_000,
        8 * 1024 * 1024
      )
    );
    if (new Set(shows.map((show) => show.tvdbId)).size !== shows.length)
      throw new ProviderResponseError();
    console.log(`[Shows] Fetched ${shows.length} shows from GitHub`);
    return shows;
  } catch {
    console.warn("[Shows] Error fetching from GitHub");
    return null;
  }
}

async function loadLocalShows(budget?: HttpRequestBudget): Promise<void> {
  // Check if we need to refresh (hourly)
  const now = Date.now();
  if (localShowsLoaded && now - lastShowsFetchTime < SHOWS_REFRESH_INTERVAL_MS) {
    return;
  }

  try {
    // Try GitHub first, fall back to local file
    let shows = await fetchShowsFromGitHub(budget);
    if (budget && Date.now() >= budget.deadlineAt) throw new ProviderResponseError();

    if (!shows) {
      console.log("[Shows] Falling back to local file");
      const showsPath = path.join(process.cwd(), "data", "shows.json");
      const fileContent = await fs.readFile(showsPath, "utf-8");
      shows = localShowsSchema.parse(JSON.parse(fileContent));
      console.log(`[Shows] Loaded ${shows!.length} shows from local file`);
    }

    localShows = new Map();
    for (const show of shows!) {
      localShows.set(show.tvdbId, show);
    }

    console.log(`[Shows] Indexed ${localShows.size} local shows`);
    localShowsLoaded = true;
    lastShowsFetchTime = now;
  } catch {
    console.error("[Shows] Error loading local shows");
    if (budget) throw new ProviderResponseError();
  }
}

function getLocalShow(tvdbId: number): TvdbData | null {
  const show = localShows.get(tvdbId);
  if (!show) return null;
  return localShowMetadata(show);
}

function localShowMetadata(show: LocalShow): TvdbData {
  return {
    id: show.tvdbId,
    name: show.name,
    germanName: show.germanName,
    aliases: show.aliases.map((name) => ({ language: "deu", name })),
    episodes: show.episodes.map((ep) => ({
      name: ep.name,
      seasonNumber: ep.seasonNumber,
      episodeNumber: ep.episodeNumber,
      aired: ep.aired ? new Date(ep.aired) : null,
      runtime: ep.runtime || null,
    })),
  };
}

/**
 * Get show info by TVDB ID from multiple sources:
 * 1. Local shows.json (always checked first)
 * 2. TVDB API (if api.tvdb.key is configured in settings)
 * 3. TMDB API (if api.tmdb.key is configured in settings)
 */
export async function getBaseShowInfoByTvdbId(
  tvdbId: number,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  if (tvdbId === undefined || tvdbId === null) {
    return null;
  }

  // 1. Check local shows file first (no API needed)
  await loadLocalShows(budget);
  const localShow = getLocalShow(tvdbId);
  if (localShow) {
    console.log(`[Shows] Found "${localShow.name}" in local database`);
    return localShow;
  }

  // 2. Try TVDB if API key is configured
  let providerUnavailable = false;
  const tvdbApiKey = await getSetting("api.tvdb.key");
  if (tvdbApiKey) {
    console.log(`[Shows] Trying TVDB for ID ${tvdbId}`);
    try {
      const tvdbResult = await getTvdbShow(tvdbId, budget);
      if (tvdbResult) return tvdbResult;
    } catch {
      // An independent configured provider may recover, but never on a new budget.
      budget?.assertAvailable();
      providerUnavailable = true;
    }
  }

  // 3. Try TMDB if API key is configured
  const tmdbApiKey = await getSetting("api.tmdb.key");
  if (tmdbApiKey?.startsWith("eyJ")) {
    console.log(`[Shows] Trying TMDB for ID ${tvdbId}`);
    try {
      const tmdbResult = await getTmdbShow(tvdbId, budget);
      if (tmdbResult) return tmdbResult;
    } catch {
      budget?.assertAvailable();
      providerUnavailable = true;
    }
  }

  if (providerUnavailable) throw new ProviderResponseError();

  console.log(`[Shows] No show found for TVDB ID ${tvdbId} in any source`);
  return null;
}

/** Optional supplementation never hides independently usable base metadata. */
export async function getShowInfoByTvdbId(
  tvdbId: number,
  budget?: HttpRequestBudget
): Promise<TvdbData | null> {
  if (!Number.isSafeInteger(tvdbId) || tvdbId < 1) return null;
  let base: TvdbData | null = null;
  let baseUnavailable = false;
  try {
    base = await getBaseShowInfoByTvdbId(tvdbId, budget);
  } catch {
    budget?.assertAvailable();
    baseUnavailable = true;
  }
  if (base) baseShows.set(metadataCacheKey("sonarr-base", tvdbId, null), structuredClone(base));
  try {
    const session = await openSonarrSession();
    if (!session && baseUnavailable) throw new SonarrUnavailableError();
    const supplemental = session ? await session.show(tvdbId, budget) : null;
    if (baseUnavailable && !supplemental) throw new SonarrUnavailableError();
    return session ? mergeSonarrShow(base, supplemental) : base;
  } catch {
    if (base) return { ...base, sonarrUnavailable: true };
    throw new SonarrUnavailableError();
  }
}

/** RSS does not trigger unbounded TVDB/TMDB/library refreshes to supplement Sonarr. */
export async function getBaseShowForSonarrRss(tvdbId: number): Promise<TvdbData | null> {
  const cached = baseShows.get(metadataCacheKey("sonarr-base", tvdbId, null));
  if (cached) return structuredClone(cached);
  const loaded = getLocalShow(tvdbId);
  if (loaded) return loaded;
  const file = await fs.readFile(path.join(process.cwd(), "data", "shows.json"), "utf8");
  const shows = JSON.parse(file) as LocalShow[];
  const show = shows.find((item) => item.tvdbId === tvdbId);
  return show ? localShowMetadata(show) : null;
}
