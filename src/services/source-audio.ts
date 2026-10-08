import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApiResultItem, MatchedEpisodeInfo } from "@/types";
import type { LanguagePolicy } from "@/lib/language-policy";
import { selectRenditions, type QualityPreference } from "./rendition-quality";
import { ardVideoId, getArdMedia, getArdSource, ardEdition } from "./ard-source-audio";
import type { SourceAudioEvidence } from "@/lib/media-expectations";
import { fetchWithRetry, type HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { isProbeableMp4, probeMp4MediaFacts, type Mp4MediaFacts } from "@/lib/mp4-audio-language";
import { arteVideoId, parseArteVersion, progressiveUrl } from "./arte-editions";
import { recordDecision, decisionFailure } from "@/server/decision-diagnostics";
import { productSettingsContext } from "@/lib/product-settings-context";
import { cacheContextEpoch } from "@/lib/cache";
import { searchCacheContext } from "./content-search";
import {
  classifyLanguageEdition,
  selectLanguageVariants,
  stableUrlIdentity,
} from "./language-editions";

const streamsSchema = z.object({
  videoStreams: z
    .array(
      z.object({
        programId: z.string().max(100),
        url: z.string().max(16_384),
        audioCode: z.string().max(100),
        width: z.unknown().optional(),
        height: z.unknown().optional(),
      })
    )
    .max(200),
});
type ArteStreams = z.infer<typeof streamsSchema>["videoStreams"];

export function mediaSourceIdentity(url: string): string {
  return createHash("sha256").update(stableUrlIdentity(url)).digest("hex");
}

async function getArteStreams(
  videoId: string,
  budget: HttpRequestBudget,
  signal?: AbortSignal
): Promise<ArteStreams> {
  if (!/^\d{6}-\d{3}-[AF]$/.test(videoId))
    throw decisionFailure("identity", "identity_missing", "missing");
  const response = await fetchWithRetry(
    `https://www.arte.tv/hbbtvv2/services/web/index.php/OPA/v3/streams/${videoId}/SHOW/de`,
    { headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) },
    { requestBudget: budget, maxRetries: 0 }
  );
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    return [];
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw decisionFailure("language", "source_failed", "unavailable");
  }
  try {
    return streamsSchema.parse(
      await readBoundedProviderJson(response, budget.deadlineAt, 1024 * 1024, signal)
    ).videoStreams;
  } catch {
    throw decisionFailure("language", "source_failed", "unavailable");
  }
}

function arteEdition(streams: ArteStreams, videoId: string, url: string) {
  if (!progressiveUrl(url)) return null;
  // The crawler upgrades the API's HTTP spelling to HTTPS. Nothing else is
  // rewritten: same program, exact path and every selector/signature must match.
  const matches = streams.filter(
    (stream) => stream.programId === videoId && stream.url.replace(/^http:/, "https:") === url
  );
  const editions = matches.map((stream) => parseArteVersion(stream.audioCode));
  if (
    !editions.length ||
    editions.some(
      (edition) =>
        !edition?.audioLanguage || JSON.stringify(edition) !== JSON.stringify(editions[0])
    )
  )
    return null;
  return editions[0];
}

/** Worker revalidation binds the persisted promise to the URL actually downloaded. */
export async function verifyArteSourceAudio(
  expected: SourceAudioEvidence,
  url: string,
  budget: HttpRequestBudget,
  signal?: AbortSignal
): Promise<SourceAudioEvidence> {
  if (expected.provider !== "arte_hbbtv")
    throw decisionFailure("language", "source_evidence_mismatch", "conflicting");
  if (!progressiveUrl(url) || mediaSourceIdentity(url) !== expected.mediaIdentity)
    throw decisionFailure("language", "source_evidence_mismatch", "conflicting");
  const edition = arteEdition(
    await getArteStreams(expected.videoId, budget, signal),
    expected.videoId,
    url
  );
  if (!edition || edition.audioLanguage !== expected.language)
    throw decisionFailure("language", "source_evidence_mismatch", "conflicting");
  return expected;
}

/** Provider promises survive unknown track tags only after fresh exact-URL revalidation. */
export async function verifySourceAudio(
  expected: SourceAudioEvidence,
  url: string,
  budget: HttpRequestBudget,
  signal?: AbortSignal
): Promise<SourceAudioEvidence> {
  signal?.throwIfAborted();
  if (expected.provider === "arte_hbbtv")
    return verifyArteSourceAudio(expected, url, budget, signal);
  if (
    !isProbeableMp4(url) ||
    new URL(url).hostname !== "ctv-videos.daserste.de" ||
    mediaSourceIdentity(url) !== expected.mediaIdentity
  )
    throw decisionFailure("language", "source_evidence_mismatch", "conflicting");
  const edition = ardEdition(await getArdMedia(expected.videoId, budget, signal), url);
  if (!edition || edition.audioLanguage !== expected.language)
    throw decisionFailure("language", "source_evidence_mismatch", "conflicting");
  return expected;
}

/**
 * Enrich only indexed progressive renditions, never discover arbitrary media or
 * infer the requested language. Each split row owns exactly one concrete URL.
 * RSS/film enrichment permits four identities; explicit TV searches permit
 * sixteen. Both obey the caller's shared attempts and 15-second deadline.
 * Unprobed renditions remain honestly unknown.
 */
export async function enrichSourceAudio(
  items: ApiResultItem[],
  budget: HttpRequestBudget,
  maxIdentities: 4 | 16 = 4
): Promise<Map<ApiResultItem, ApiResultItem[]>> {
  const arte = new Map<string, ArteStreams>();
  const ard = new Map<string, Awaited<ReturnType<typeof getArdSource>>>();
  const mp4 = new Map<string, Mp4MediaFacts>();
  const snapshot = productSettingsContext.getStore();
  const epoch = cacheContextEpoch();
  // Only a server-owned settings snapshot may enable cross-request proof reuse.
  // Worker revalidation has no context and always performs its fresh lookup.
  const proofContext = snapshot
    ? {
        fingerprint: await searchCacheContext(),
        isCurrent: () => snapshot.isCurrent() && epoch === cacheContextEpoch(),
      }
    : undefined;
  const output = new Map<ApiResultItem, ApiResultItem[]>();
  let probes = 0;
  const ordered = [...items].sort(
    (a, b) => a.url_website.localeCompare(b.url_website) || a.url_video.localeCompare(b.url_video)
  );
  const pending: ApiResultItem[] = [];
  for (const item of ordered) {
    if (output.has(item)) continue;
    const renditions: ApiResultItem[] = [];
    output.set(item, renditions);
    if (classifyLanguageEdition(item).audioLanguage) {
      recordDecision("language", "language_verified", "proven");
      // Earlier verified adapters already bound their audio to these renditions.
      // Do not spend the caller's budget re-proving the same provider response.
      renditions.push(item);
      continue;
    }
    const videoId = arteVideoId(item.url_website);
    const fields = ["url_video_hd", "url_video", "url_video_low"] as const;
    if (
      !fields.some(
        (field) =>
          item[field] && ((videoId && progressiveUrl(item[field])) || isProbeableMp4(item[field]))
      )
    ) {
      recordDecision("language", "language_unknown", "missing");
      renditions.push(item);
      continue;
    }
    pending.push(item);
  }
  // Breadth-first renditions: a season must not spend its complete evidence
  // budget on low-quality alternatives of the first few episodes.
  for (const field of ["url_video_hd", "url_video", "url_video_low"] as const) {
    for (const item of pending) {
      const renditions = output.get(item)!;
      const videoId = arteVideoId(item.url_website);
      const ardId = ardVideoId(item.url_website);
      const url = item[field];
      if (!url) continue;
      const split: ApiResultItem = {
        ...item,
        url_video: "",
        url_video_hd: "",
        url_video_low: "",
        [field]: url,
      };
      let edition: ReturnType<typeof parseArteVersion> | ReturnType<typeof ardEdition> = null;
      let language: string | null = null;
      if (videoId && progressiveUrl(url)) {
        if (!arte.has(videoId) && probes < maxIdentities && budget.remainingAttempts > 0) {
          probes++;
          arte.set(videoId, await getArteStreams(videoId, budget));
        }
        edition = arteEdition(arte.get(videoId) ?? [], videoId, url);
        const matches = (arte.get(videoId) ?? []).filter(
          (stream) => stream.programId === videoId && stream.url.replace(/^http:/, "https:") === url
        );
        // Preserve every exact-URL declaration: the quality owner rejects a
        // disagreement or missing dimensions instead of choosing a convenient row.
        split.sourceVideoDimensions = matches.map((stream) => ({
          url,
          width: typeof stream.width === "number" ? stream.width : 0,
          height: typeof stream.height === "number" ? stream.height : 0,
        }));
        language = edition?.audioLanguage ?? null;
        if (language)
          split.sourceAudioEvidence = {
            provider: "arte_hbbtv",
            videoId,
            mediaIdentity: mediaSourceIdentity(url),
            language,
          };
      } else if (
        ardId &&
        isProbeableMp4(url) &&
        new URL(url).hostname === "ctv-videos.daserste.de"
      ) {
        if (!ard.has(ardId) && probes < maxIdentities && budget.remainingAttempts > 0) {
          probes++;
          ard.set(ardId, await getArdSource(ardId, budget));
        }
        const source = ard.get(ardId);
        const media = source?.media ?? [];
        if (source) split.sourceAvailability = source.availability;
        edition = ardEdition(media, url);
        language = edition?.audioLanguage ?? null;
        split.sourceVideoDimensions = media
          .filter((entry) => entry.url === url)
          .map((entry) => ({
            url,
            width: typeof entry.maxHResolutionPx === "number" ? entry.maxHResolutionPx : 0,
            height: typeof entry.maxVResolutionPx === "number" ? entry.maxVResolutionPx : 0,
          }));
        if (language)
          split.sourceAudioEvidence = {
            provider: "ard_media",
            videoId: ardId,
            mediaIdentity: mediaSourceIdentity(url),
            language,
          };
      } else if (isProbeableMp4(url)) {
        if (!mp4.has(url) && probes < maxIdentities && budget.remainingAttempts > 0) {
          probes++;
          mp4.set(url, await probeMp4MediaFacts(url, budget, true, proofContext));
        }
        const facts = mp4.get(url);
        language = facts?.audioLanguage ?? null;
        if (facts?.videoDimensions)
          split.sourceVideoDimensions = [{ url, ...facts.videoDimensions }];
      }
      if (language) {
        split.releaseVariantKey =
          item.releaseVariantKey ?? classifyLanguageEdition(item).variantKey;
        split.audioLanguage = language;
        if (edition) Object.assign(split, edition);
      }
      recordDecision(
        "language",
        language ? "language_verified" : "language_unknown",
        language ? "proven" : "missing"
      );
      renditions.push(split);
    }
  }
  if (Date.now() >= budget.deadlineAt) throw new Error("Source evidence unavailable");
  return output;
}

/** One enrichment owner for exact/season/ruleset/RSS TV releases, before pagination. */
export async function enrichTvCandidates(
  items: ApiResultItem[],
  budget: HttpRequestBudget,
  policy: LanguagePolicy,
  quality: QualityPreference,
  hlsEnabled: boolean
): Promise<ApiResultItem[]> {
  const owners = new Map<ApiResultItem, ApiResultItem>();
  const enriched = await enrichSourceAudio(items, budget, 16);
  for (const [item, renditions] of enriched)
    for (const rendition of renditions) owners.set(rendition, item);
  const selected = selectLanguageVariants([...owners.keys()], policy);
  if (quality !== "best") return selected;
  const best = new Map<ApiResultItem, ApiResultItem>();
  for (const item of selected) {
    const owner = owners.get(item)!;
    const previous = best.get(owner);
    if (!previous || renditionRank(item, hlsEnabled) > renditionRank(previous, hlsEnabled))
      best.set(owner, item);
  }
  return [...best.values()];
}

function renditionRank(item: ApiResultItem, hlsEnabled: boolean): number {
  const rendition = selectRenditions(item, "best", hlsEnabled)[0];
  return rendition
    ? (rendition.quality === "UNKNOWN" ? 0 : rendition.dimensions!.height) * 10 +
        (rendition.field === "url_video_hd" ? 3 : rendition.field === "url_video" ? 2 : 1)
    : -1;
}

/** One final language/quality policy for verified exact/season/ruleset/RSS TV releases. */
export async function enrichTvMatches(
  matches: MatchedEpisodeInfo[],
  budget: HttpRequestBudget,
  policy: LanguagePolicy,
  quality: QualityPreference,
  hlsEnabled: boolean,
  foreground = true
): Promise<MatchedEpisodeInfo[]> {
  const owners = new Map<ApiResultItem, MatchedEpisodeInfo[]>();
  for (const match of matches) owners.set(match.item, [...(owners.get(match.item) ?? []), match]);
  const editions = await enrichSourceAudio([...owners.keys()], budget, foreground ? 16 : 4);
  const enriched = new Map<ApiResultItem, MatchedEpisodeInfo[]>();
  for (const [item, renditions] of editions)
    for (const rendition of renditions)
      enriched.set(
        rendition,
        owners.get(item)!.map((match) => ({ ...match, item: rendition }))
      );
  const selected = selectLanguageVariants([...enriched.keys()], policy).flatMap(
    (item) => enriched.get(item)!
  );
  if (quality !== "best") return selected;
  // Splitting one row into URL-bound proofs must not turn "best" into "all".
  const best = new Map<string, MatchedEpisodeInfo>();
  for (const match of selected) {
    const key = JSON.stringify([
      match.tvdbId,
      match.episode.seasonNumber,
      match.episode.episodeNumber,
      classifyLanguageEdition(match.item).variantKey,
    ]);
    const previous = best.get(key);
    if (
      !previous ||
      renditionRank(match.item, hlsEnabled) > renditionRank(previous.item, hlsEnabled)
    )
      best.set(key, match);
  }
  return [...best.values()];
}
