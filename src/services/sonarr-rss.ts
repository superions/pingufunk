import { LRUCache } from "lru-cache";
import { cacheContextEpoch, coalesceMetadata, metadataCacheKey } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { openSonarrSession, mergeSonarrShow, SonarrUnavailableError } from "./sonarr-provider";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { tvSearchQueries, verifiedRuleTopics } from "./tv-search-terms";
import { getRulesetContext } from "./rulesets";
import { queryContent, searchCacheContext, getConfiguredLanguagePolicy } from "./content-search";
import type { MatchedEpisodeInfo, TvdbData } from "@/types";

interface Snapshot {
  shows: TvdbData[];
  expiresAt: number;
}
const snapshots = new LRUCache<string, Snapshot>({ max: 16 });
const cursors = new LRUCache<string, number>({ max: 16 });

/** Pagination reuses 60s metadata goals, never media URLs/proof. A successful cold build advances its cursor. */
export async function getSonarrRssMatches(
  loadBase: (tvdbId: number) => Promise<TvdbData | null>,
  callerBudget?: HttpRequestBudget
): Promise<MatchedEpisodeInfo[]> {
  const session = await openSonarrSession();
  if (!session) return [];
  const epoch = cacheContextEpoch();
  const rulesContext = getRulesetContext();
  const window = Number(
    configuredSetting(
      "integration.sonarr.windowDays",
      await getSetting("integration.sonarr.windowDays")
    )
  );
  const tolerance = Number(
    configuredSetting(
      "matching.sonarr.tolerancePercent",
      await getSetting("matching.sonarr.tolerancePercent")
    )
  );
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
    [window, tolerance, minimum, await searchCacheContext(), rulesContext],
    session.cacheIdentity
  );
  const cached = snapshots.get(key);
  const buildSnapshot = async () => {
    const budget = callerBudget ?? new HttpRequestBudget();
    const now = Date.now();
    const cutoff = now - window * 86_400_000;
    const reusable = cached && now < cached.expiresAt ? cached : undefined;
    const inventory = reusable
      ? []
      : (await session.inventory(budget))
          .filter((series) => series.monitored)
          .sort((a, b) => a.tvdbId - b.tvdbId);
    const start = inventory.length ? (cursors.get(key) ?? 0) % inventory.length : 0;
    const matches: MatchedEpisodeInfo[] = [];
    const shows: TvdbData[] = [];
    let examined = 0;
    let episodeCount = 0;
    // Reserve one episode lookup and one source attempt per selected series.
    // A full source page may consume more; its failure aborts the entire snapshot.
    // A foreground RSS owner still needs its bounded five-page source window.
    const available = Math.max(0, budget.remainingAttempts - (callerBudget ? 5 : 0));
    const count = reusable
      ? reusable.shows.length
      : Math.min(5, inventory.length, Math.floor(available / 2));
    for (let index = 0; index < count && episodeCount < 50; index++) {
      let show: TvdbData;
      if (reusable) {
        show = structuredClone(reusable.shows[index]);
        show.episodes = show.episodes.filter(
          (episode) =>
            episode.metadataSource !== "sonarr" ||
            (episode.aired && episode.aired.getTime() >= cutoff && episode.aired.getTime() <= now)
        );
      } else {
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
        show = mergeSonarrShow(await loadBase(series.tvdbId), { ...supplemental, episodes })!;
      }
      shows.push(show);
      examined++;
      episodeCount += show.episodes.filter((episode) => episode.metadataSource === "sonarr").length;
      if (!show.episodes.some((episode) => episode.metadataSource === "sonarr")) continue;
      const candidates = [];
      // Reserve the remaining series lookups and primary RSS window. Broader
      // retrieval never resets the ten-attempt budget or starves its cursor.
      const maxQueries = Math.max(
        1,
        budget.remainingAttempts - (callerBudget ? 5 : 0) - (count - index - 1) * (reusable ? 1 : 2)
      );
      for (const query of tvSearchQueries(show).slice(0, maxQueries)) {
        const page = await queryContent([query], 5000, {
          requestBudget: budget,
          progressiveOnly: !hlsEnabled,
          arteSeries: show,
          deferLanguageSelection: true,
        });
        if (page === null) throw new SonarrUnavailableError();
        candidates.push(...page);
      }
      matches.push(
        ...matchSonarrEpisodes(
          show,
          [...new Map(candidates.map((item) => [JSON.stringify(item), item])).values()],
          minimum,
          tolerance,
          languagePolicy,
          hlsEnabled,
          true,
          verifiedRuleTopics(show)
        )
      );
    }
    if (
      Date.now() >= budget.deadlineAt ||
      epoch !== cacheContextEpoch() ||
      rulesContext !== getRulesetContext()
    )
      throw new SonarrUnavailableError();
    // No publication, cache write or cursor movement may precede this boundary.
    if (!reusable)
      snapshots.set(key, { shows: structuredClone(shows), expiresAt: Date.now() + 60_000 });
    if (!reusable && inventory.length) cursors.set(key, (start + examined) % inventory.length);
    return matches;
  };
  // Foreground searches cannot inherit another caller's timeout/attempt counter.
  return structuredClone(
    await (callerBudget ? buildSnapshot() : coalesceMetadata(key, buildSnapshot))
  );
}
