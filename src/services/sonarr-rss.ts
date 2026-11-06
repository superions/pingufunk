import { LRUCache } from "lru-cache";
import { cacheContextEpoch, coalesceMetadata, metadataCacheKey } from "@/lib/cache";
import { getMinDurationSeconds, getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { openSonarrSession, mergeSonarrShow, SonarrUnavailableError } from "./sonarr-provider";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { tvSearchQueries, verifiedRuleTopics } from "./tv-search-terms";
import { getRulesetContext } from "./rulesets";
import { registerTvSearchDelivery } from "./tv-search-delivery";
import {
  queryContent,
  searchCacheContext,
  getConfiguredLanguagePolicy,
  RSS_SOURCE_WINDOW_ATTEMPTS,
} from "./content-search";
import type { MatchedEpisodeInfo, TvdbData } from "@/types";

interface Snapshot {
  shows: Array<{
    recent: TvdbData;
    complete: TvdbData;
    missingAirings: Array<{ coordinate: string; aired: Date }>;
  }>;
  expiresAt: number;
}
const snapshots = new LRUCache<string, Snapshot>({ max: 16 });
const cursors = new LRUCache<string, number>({ max: 16 });
const historicalCursors = new LRUCache<string, number>({ max: 256 });
const historicalOwners = new LRUCache<string, number>({ max: 16 });
const HISTORICAL_DISCOVERY_BATCH = 16;

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
  const hlsEnabled = true;
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
    const shows: Snapshot["shows"] = [];
    const pendingHistorical: Array<{
      key: string;
      show: TvdbData;
      batch: MatchedEpisodeInfo[];
      next: number;
    }> = [];
    let examined = 0;
    let episodeCount = 0;
    // Reserve one episode lookup and one source attempt per selected series.
    // A full source page may consume more; its failure aborts the entire snapshot.
    const reserved = callerBudget ? RSS_SOURCE_WINDOW_ATTEMPTS : 0;
    // Account for the actual paginated primary window, not a historical page count.
    const available = Math.max(0, budget.remainingAttempts - reserved);
    const count = reusable
      ? reusable.shows.length
      : Math.min(5, inventory.length, Math.floor(available / 2));
    for (let index = 0; index < count && episodeCount < 50; index++) {
      let show: TvdbData;
      let complete: TvdbData;
      let missingAirings: Snapshot["shows"][number]["missingAirings"];
      if (reusable) {
        ({ recent: show, complete, missingAirings } = structuredClone(reusable.shows[index]));
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
        const base = await loadBase(series.tvdbId);
        show = mergeSonarrShow(base, { ...supplemental, episodes })!;
        complete = mergeSonarrShow(base, supplemental)!;
        missingAirings = supplemental.episodes.flatMap((episode) =>
          episode.monitored && !episode.hasFile && episode.aired
            ? [
                {
                  coordinate: `${episode.seasonNumber}:${episode.episodeNumber}`,
                  aired: episode.aired,
                },
              ]
            : []
        );
      }
      shows.push({ recent: show, complete, missingAirings });
      examined++;
      episodeCount += show.episodes.filter((episode) => episode.metadataSource === "sonarr").length;
      const historicalCoordinates = new Set(
        missingAirings
          .filter(({ aired }) => aired.getTime() < cutoff)
          .map(({ coordinate }) => coordinate)
      );
      const oldMissing = historicalCoordinates.size > 0;
      if (!show.episodes.some((episode) => episode.metadataSource === "sonarr") && !oldMissing)
        continue;
      const candidates = [];
      // Reserve the remaining series lookups and primary RSS window. Broader
      // retrieval never resets the ten-attempt budget or starves its cursor.
      const maxQueries = Math.max(
        1,
        budget.remainingAttempts - reserved - (count - index - 1) * (reusable ? 1 : 2)
      );
      for (const query of tvSearchQueries(show).slice(0, maxQueries)) {
        // One logical query can consume several pages. Bound its candidate
        // window before fetching, rather than lending it the primary owner's slots.
        const pages = budget.remainingAttempts - reserved - (count - index - 1) * 2;
        if (pages < 1) break;
        const page = await queryContent([query], 5000, {
          requestBudget: budget,
          progressiveOnly: !hlsEnabled,
          arteSeries: show,
          deferLanguageSelection: true,
          maxCandidatePages: Math.min(5, pages),
        });
        if (page === null) throw new SonarrUnavailableError();
        candidates.push(...page);
      }
      const uniqueCandidates = [
        ...new Map(candidates.map((item) => [JSON.stringify(item), item])).values(),
      ];
      matches.push(
        ...matchSonarrEpisodes(
          show,
          uniqueCandidates,
          minimum,
          tolerance,
          languagePolicy,
          hlsEnabled,
          true,
          verifiedRuleTopics(show)
        )
      );
      if (oldMissing && budget.remainingAttempts > 0) {
        // Match against the complete series before selecting missing episodes:
        // a repeated title elsewhere must remain ambiguous, even if it has a file.
        const historical = matchSonarrEpisodes(
          complete,
          uniqueCandidates,
          minimum,
          tolerance,
          languagePolicy,
          hlsEnabled,
          true,
          verifiedRuleTopics(complete)
        ).filter((match) =>
          historicalCoordinates.has(`${match.episode.seasonNumber}:${match.episode.episodeNumber}`)
        );
        if (historical.length) {
          const cursorKey = JSON.stringify([key, complete.id]);
          const start = (historicalCursors.get(cursorKey) ?? 0) % historical.length;
          const batch = [...historical.slice(start), ...historical.slice(0, start)].slice(
            0,
            HISTORICAL_DISCOVERY_BATCH
          );
          pendingHistorical.push({
            key: cursorKey,
            show: complete,
            batch,
            next: (start + batch.length) % historical.length,
          });
        }
      }
    }
    if (
      Date.now() >= budget.deadlineAt ||
      epoch !== cacheContextEpoch() ||
      rulesContext !== getRulesetContext()
    )
      throw new SonarrUnavailableError();
    // Register one owner atomically only after every source succeeded; failed
    // batches retain their cursor and are retried by a later RSS poll.
    if (pendingHistorical.length) {
      const owner = (historicalOwners.get(key) ?? 0) % pendingHistorical.length;
      const selected = pendingHistorical[owner];
      await registerTvSearchDelivery(selected.show, selected.batch, budget);
      historicalCursors.set(selected.key, selected.next);
      historicalOwners.set(key, (owner + 1) % pendingHistorical.length);
    }
    // No response snapshot or series cursor movement precedes this boundary.
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
