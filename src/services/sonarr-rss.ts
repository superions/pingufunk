import { LRUCache } from "lru-cache";
import { cacheContextEpoch, coalesceMetadata, metadataCacheKey } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { openSonarrSession, mergeSonarrShow, SonarrUnavailableError } from "./sonarr-provider";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { queryContent, searchCacheContext, getConfiguredLanguagePolicy } from "./content-search";
import type { MatchedEpisodeInfo, TvdbData } from "@/types";

interface Snapshot {
  matches: MatchedEpisodeInfo[];
  expiresAt: number;
}
const snapshots = new LRUCache<string, Snapshot>({ max: 16 });
const cursors = new LRUCache<string, number>({ max: 16 });

/** Pagination reuses one 60s snapshot; only a fully successful build advances its cursor. */
export async function getSonarrRssMatches(
  loadBase: (tvdbId: number) => Promise<TvdbData | null>,
  callerBudget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo[]> {
  const session = await openSonarrSession();
  if (!session) return [];
  const epoch = cacheContextEpoch();
  const window = Number((await getSetting("integration.sonarr.windowDays")) ?? "14");
  const tolerance = Number((await getSetting("matching.sonarr.tolerancePercent")) ?? "10");
  const minimum = await getMinDurationSeconds();
  const languagePolicy = await getConfiguredLanguagePolicy();
  const hlsEnabled = (await getSetting("download.enableHLS")) === "true";
  if (
    !Number.isSafeInteger(window) ||
    window < 1 ||
    window > 90 ||
    !Number.isSafeInteger(tolerance) ||
    tolerance < 0 ||
    tolerance > 25
  )
    throw new SonarrUnavailableError();
  const key = metadataCacheKey(
    "sonarr-rss",
    [window, tolerance, minimum, await searchCacheContext()],
    session.cacheIdentity
  );
  const cached = snapshots.get(key);
  if (cached && Date.now() < cached.expiresAt) return structuredClone(cached.matches);
  const buildSnapshot = async () => {
    const budget = callerBudget ?? new HttpRequestBudget();
    const now = Date.now();
    const cutoff = now - window * 86_400_000;
    const inventory = (await session.inventory(budget))
      .filter((series) => series.monitored)
      .sort((a, b) => a.tvdbId - b.tvdbId);
    const start = inventory.length ? (cursors.get(key) ?? 0) % inventory.length : 0;
    const matches: MatchedEpisodeInfo[] = [];
    let examined = 0;
    let episodeCount = 0;
    // Reserve one episode lookup and one source attempt per selected series.
    // A full source page may consume more; its failure aborts the entire snapshot.
    // A foreground RSS owner still needs its bounded five-page source window.
    const available = Math.max(0, budget.remainingAttempts - (callerBudget ? 5 : 0));
    const count = Math.min(5, inventory.length, Math.floor(available / 2));
    for (let index = 0; index < count && episodeCount < 50; index++) {
      const series = inventory[(start + index) % inventory.length];
      const supplemental = await session.episodes(series, budget);
      const episodes = supplemental.episodes
        .filter(
          (episode) =>
            episode.aired && episode.aired.getTime() >= cutoff && episode.aired.getTime() <= now
        )
        .sort(
          (a, b) =>
            b.aired!.getTime() - a.aired!.getTime() ||
            a.seasonNumber - b.seasonNumber ||
            a.episodeNumber - b.episodeNumber
        )
        .slice(0, 50 - episodeCount);
      const show = mergeSonarrShow(await loadBase(series.tvdbId), { ...supplemental, episodes })!;
      examined++;
      episodeCount += episodes.length;
      if (!show.episodes.some((episode) => episode.metadataSource === "sonarr")) continue;
      const candidates = await queryContent(
        [{ fields: ["topic", "title"], query: show.germanName || show.name }],
        5000,
        {
          requestBudget: budget,
          progressiveOnly: !hlsEnabled,
          arteSeries: show,
          deferLanguageSelection: true,
        }
      );
      if (candidates === null) throw new SonarrUnavailableError();
      matches.push(
        ...matchSonarrEpisodes(
          show,
          candidates,
          minimum,
          tolerance,
          languagePolicy,
          hlsEnabled,
          true
        )
      );
    }
    if (Date.now() >= budget.deadlineAt || epoch !== cacheContextEpoch())
      throw new SonarrUnavailableError();
    // No publication, cache write or cursor movement may precede this boundary.
    snapshots.set(key, { matches: structuredClone(matches), expiresAt: Date.now() + 60_000 });
    if (inventory.length) cursors.set(key, (start + examined) % inventory.length);
    return matches;
  };
  // Foreground searches cannot inherit another caller's timeout/attempt counter.
  return structuredClone(
    await (callerBudget ? buildSnapshot() : coalesceMetadata(key, buildSnapshot))
  );
}
