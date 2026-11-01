import type { ApiResultItem, MatchedEpisodeInfo, TvdbData } from "@/types";
import { youtubeSourceIdentitySchema } from "@/lib/youtube-source";
import { verifiedDurationCheck } from "@/lib/verified-duration";
import {
  mediathekProgrammeIdentitySchema,
  mediathekProgrammePairIdentitySchema,
  type MediathekProgrammeMatch,
} from "@/lib/mediathek-programme";
import { type MediaExpectations, parseMediaExpectations } from "@/lib/media-expectations";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { parseEpisodeFromTitle } from "./newznab";
import { classifyLanguageEdition } from "./language-editions";
import { mediaSourceIdentity } from "./source-audio";

type ProgrammeExpectations = Extract<MediaExpectations, { version: 6 | 7 }>;
const normalized = (value: string) => value.normalize("NFC").trim().replace(/\s+/g, " ");

/** A registered programme that changes must not fall through to ordinary coordinate matching. */
export function hasMediathekProgrammeBinding(item: ApiResultItem, show: TvdbData): boolean {
  return !!show.mediathekProgrammes?.some((binding) => binding.website === item.url_website);
}

/** Publisher facts prove this exact standard programme; runtime never supplies identity. */
function matchesMediathekProgramme(item: ApiResultItem, binding: MediathekProgrammeMatch) {
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
  if (!bindings || ![1, 2].includes(bindings.length)) return null;
  // Preserve the shipped catalogue shape: two rows name one source and two
  // distinct targets. Old single-target readers reject this ambiguity safely.
  if (
    bindings.some(
      (binding) => JSON.stringify(binding.source) !== JSON.stringify(bindings[0].source)
    )
  )
    return null;
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
  const { target: _, ...source } = bindings[0];
  const context = { ...source, tvdbId: show.id, topic: item.topic };
  const identity =
    bindings.length === 1
      ? mediathekProgrammeIdentitySchema.safeParse({ ...context, target: bindings[0].target })
      : mediathekProgrammePairIdentitySchema.safeParse({
          ...context,
          targets: bindings
            .map((binding) => binding.target)
            .sort((a, b) => a.season - b.season || a.episode - b.episode),
        });
  if (!identity.success || !matchesMediathekProgramme(item, identity.data)) return null;
  const targets = "targets" in identity.data ? identity.data.targets : [identity.data.target];
  const episodes = targets.flatMap((target) => {
    const coordinate = `${target.season}:${target.episode}`;
    if (show.sonarrBlockedCoordinates?.includes(coordinate)) return [];
    const found = show.episodes.filter(
      (episode) =>
        episode.seasonNumber === target.season &&
        episode.episodeNumber === target.episode &&
        (episode.metadataSource === "sonarr" ||
          show.sonarrVerifiedCoordinates?.includes(coordinate))
    );
    return found.length === 1 &&
      found[0].runtime &&
      Number.isFinite(found[0].runtime) &&
      found[0].runtime > 0
      ? found
      : [];
  });
  if (episodes.length !== targets.length) return null;
  const episode = episodes[0];
  if (
    !verifiedDurationCheck(
      item.duration,
      episodes.reduce((total, part) => total + part.runtime! * 60, 0),
      minimum,
      tolerance
    ).accepted
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
    ...(episodes.length === 2
      ? { pairedEpisodes: [episodes[0], episodes[1]] as [typeof episode, typeof episode] }
      : {}),
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
  if (!item.sourceRef) {
    return matchMediathekEpisode(item, show, minimum, tolerance);
  }
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
  if (expected.version !== 6 && expected.version !== 7) throw Error("Invalid programme contract");
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
  const metadataSeconds = match?.pairedEpisodes
    ? match.pairedEpisodes.reduce((sum, part) => sum + part.runtime! * 60, 0)
    : match?.episode.runtime! * 60;
  if (
    !match?.mediathekProgramme ||
    JSON.stringify(identity) !== JSON.stringify(match.mediathekProgramme) ||
    expected.durations.metadata?.seconds !== metadataSeconds ||
    (expected.version === 7 &&
      (!match.pairedEpisodes ||
        expected.episodeDurations.some(
          (duration, i) => duration.seconds !== match.pairedEpisodes![i].runtime! * 60
        )))
  )
    throw Error("Programme binding changed");
  budget.assertAvailable();
}
