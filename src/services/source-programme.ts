import type { ApiResultItem, MatchedEpisodeInfo, TvdbData } from "@/types";
import { youtubeSourceIdentitySchema } from "@/lib/youtube-source";
import { verifiedDurationCheck } from "@/lib/verified-duration";
import {
  mediathekProgrammeIdentitySchema,
  type MediathekProgrammeIdentity,
} from "@/lib/mediathek-programme";
import { type MediaExpectations, parseMediaExpectations } from "@/lib/media-expectations";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { parseEpisodeFromTitle } from "./newznab";
import { classifyLanguageEdition } from "./language-editions";
import { mediaSourceIdentity } from "./source-audio";

type ProgrammeExpectations = Extract<MediaExpectations, { version: 6 }>;
const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");

/** A registered programme that changes must not fall through to ordinary coordinate matching. */
export function hasMediathekProgrammeBinding(item: ApiResultItem, show: TvdbData): boolean {
  return !!show.mediathekProgrammes?.some((binding) => binding.website === item.url_website);
}

/** Publisher facts prove this exact standard programme; runtime never supplies identity. */
function matchesMediathekProgramme(item: ApiResultItem, binding: MediathekProgrammeIdentity) {
  const parsed = parseEpisodeFromTitle(item.title);
  const edition = classifyLanguageEdition(item);
  return (
    !item.sourceRef &&
    (!item.sourceProviderId || item.sourceProviderId === "mediathekview") &&
    item.url_website === binding.website &&
    normalized(item.channel) === normalized(binding.source.channel) &&
    normalized(item.topic) === normalized(binding.topic) &&
    normalized(parsed.episodeName) === normalized(binding.source.title) &&
    parsed.season === binding.source.season &&
    parsed.episodes.length === 1 &&
    parsed.episodes[0] === binding.source.episode &&
    !edition.audioDescription &&
    !edition.signLanguage &&
    !edition.clearSpeech &&
    !edition.originalVersion &&
    edition.audioEvidence !== "other"
  );
}

function matchMediathekEpisode(
  item: ApiResultItem,
  show: TvdbData,
  minimum: number,
  tolerance: number
): MatchedEpisodeInfo | null {
  if (show.sonarrUnavailable) return null;
  const bindings = show.mediathekProgrammes?.filter(
    (binding) => binding.website === item.url_website
  );
  if (bindings?.length !== 1) return null;
  const topics = [show.name, show.germanName, ...show.aliases.map((alias) => alias.name)];
  if (
    !topics.some(
      (topic) =>
        topic &&
        normalized(topic).toLocaleLowerCase("de-DE") ===
          normalized(item.topic).toLocaleLowerCase("de-DE")
    )
  )
    return null;
  const identity = mediathekProgrammeIdentitySchema.safeParse({
    ...bindings[0],
    tvdbId: show.id,
    topic: item.topic,
  });
  if (!identity.success || !matchesMediathekProgramme(item, identity.data)) return null;
  const target = identity.data.target;
  const coordinate = `${target.season}:${target.episode}`;
  if (show.sonarrBlockedCoordinates?.includes(coordinate)) return null;
  const episodes = show.episodes.filter(
    (episode) =>
      episode.seasonNumber === target.season &&
      episode.episodeNumber === target.episode &&
      (episode.metadataSource === "sonarr" || show.sonarrVerifiedCoordinates?.includes(coordinate))
  );
  if (episodes.length !== 1) return null;
  const episode = episodes[0];
  if (
    !episode.runtime ||
    !verifiedDurationCheck(item.duration, episode.runtime * 60, minimum, tolerance).accepted
  )
    return null;
  return {
    episode,
    item,
    showName: show.germanName || show.name,
    releaseShowName: show.sonarrReleaseName,
    matchedTitle: item.title,
    tvdbId: show.id,
    mediathekProgramme: identity.data,
  };
}

/** Consume explicit canonical intent; publisher coordinates only verify its declared source. */
export function matchBoundSourceEpisode(
  item: ApiResultItem,
  show: TvdbData,
  minimum: number,
  tolerance: number,
  includeRuntimeConflicts = false
): MatchedEpisodeInfo | null {
  if (!item.sourceRef) return matchMediathekEpisode(item, show, minimum, tolerance);
  const parsed = youtubeSourceIdentitySchema.strip().safeParse(item.sourceRef);
  if (!parsed.success) return null;
  const binding = parsed.data.programme;
  if (
    binding.kind !== "series" ||
    binding.targetId !== show.id ||
    show.sonarrBlockedCoordinates?.includes(`${binding.season}:${binding.episode}`)
  )
    return null;
  const episodes = show.episodes.filter(
    (episode) =>
      episode.seasonNumber === binding.season && episode.episodeNumber === binding.episode
  );
  if (episodes.length !== 1) return null;
  const episode = episodes[0];
  const conflict = !verifiedDurationCheck(
    item.duration,
    episode.runtime === null ? null : episode.runtime * 60,
    minimum,
    tolerance
  ).accepted;
  if (
    conflict &&
    !(includeRuntimeConflicts && item.duration > 0 && episode.runtime && episode.runtime > 0)
  )
    return null;
  return {
    episode,
    item,
    showName: show.germanName || show.name,
    releaseShowName: show.sonarrReleaseName,
    matchedTitle: item.title,
    tvdbId: show.id,
    ...(conflict ? { runtimeConflict: true, runtimeTolerancePercent: tolerance } : {}),
  };
}

/** Accepted jobs use this frozen identity, not a later catalogue or Sonarr rewrite. */
export async function revalidateMediathekProgramme(
  url: string,
  value: ProgrammeExpectations,
  budget = new HttpRequestBudget(4),
  signal?: AbortSignal
): Promise<ApiResultItem> {
  const expected = parseMediaExpectations(value);
  if (expected.version !== 6) throw Error("Invalid programme contract");
  const binding = expected.sourceProgramme;
  if (mediaSourceIdentity(url) !== binding.renditionIdentity)
    throw Error("Programme rendition changed");
  signal?.throwIfAborted();
  const { queryMediathekView } = await import("@/lib/mediathek-client");
  const rows = await queryMediathekView(
    [
      { fields: ["topic"], query: binding.topic },
      { fields: ["title"], query: binding.source.title },
    ],
    100,
    { requestBudget: budget, signal }
  );
  signal?.throwIfAborted();
  if (!rows || rows.length >= 100) throw Error("Programme evidence unavailable");
  const candidates = rows.filter(
    (item) =>
      matchesMediathekProgramme(item, binding) &&
      item.duration === expected.durations.source?.seconds &&
      [item.url_video, item.url_video_hd, item.url_video_low].some(
        (candidate) => candidate && mediaSourceIdentity(candidate) === binding.renditionIdentity
      )
  );
  if (candidates.length !== 1) throw Error("Programme source changed");
  return candidates[0];
}

/** Only new admissions recheck the current curated binding and fresh instance target. */
export async function validateMediathekProgrammeAdmission(
  url: string,
  expected: ProgrammeExpectations,
  budget = new HttpRequestBudget(32)
): Promise<void> {
  const item = await revalidateMediathekProgramme(url, expected, budget);
  const { openSonarrSession, mergeSonarrShow } = await import("./sonarr-provider");
  const { getBaseShowInfoByTvdbId } = await import("./shows");
  const { getSetting } = await import("@/lib/settings");
  const { configuredSetting } = await import("@/lib/settings-schema");
  const session = await openSonarrSession();
  const fresh = session ? await session.show(expected.sourceProgramme.tvdbId, budget, true) : null;
  if (!fresh) throw Error("Programme target unavailable");
  const show = mergeSonarrShow(
    await getBaseShowInfoByTvdbId(expected.sourceProgramme.tvdbId, budget),
    fresh
  );
  if (!show) throw Error("Programme target unavailable");
  const tolerance = Number(
    configuredSetting(
      "matching.sonarr.tolerancePercent",
      await getSetting("matching.sonarr.tolerancePercent")
    )
  );
  if (expected.durations.metadata?.tolerancePercent !== tolerance)
    throw Error("Programme policy changed");
  const match = matchMediathekEpisode(item, show, 0, tolerance);
  const { renditionIdentity: _, ...identity } = expected.sourceProgramme;
  if (
    !match?.mediathekProgramme ||
    JSON.stringify(identity) !== JSON.stringify(match.mediathekProgramme) ||
    expected.durations.metadata?.seconds !== match.episode.runtime! * 60
  )
    throw Error("Programme binding changed");
  budget.assertAvailable();
}
