import type { ApiResultItem } from "@/types";
import { isGermanLanguageCode, type LanguagePolicy } from "@/lib/language-policy";

export type AudioEvidence = "german" | "other" | "unknown";

export interface LanguageEdition {
  audioEvidence: AudioEvidence;
  audioLanguage: string | null;
  originalVersion: boolean;
  germanSubtitles: boolean;
  audioDescription: boolean;
  signLanguage: boolean;
  clearSpeech: boolean;
  variantKey: string;
  titleTokens: string[];
}

function normalizedLanguageCode(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return value.trim().replaceAll("_", "-").toLowerCase();
}

const SHORT_LIVED_MEDIA_QUERY_KEYS = new Set([
  "access_token",
  "auth",
  "authorization",
  "expires",
  "expires_at",
  "expiry",
  "hdnea",
  "hdnts",
  "key-pair-id",
  "policy",
  "sig",
  "signature",
  "token",
]);

/**
 * MediathekViewWeb exposes separate video URL fields for the source renditions, while
 * its own result `id` is a hash of the entire Filmliste row. Keep the media path and
 * unrecognized query selectors as identity, but ignore known expiring access keys.
 */
export function stableUrlIdentity(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.username = "";
    url.password = "";
    url.hash = "";

    for (const key of new Set(url.searchParams.keys())) {
      if (SHORT_LIVED_MEDIA_QUERY_KEYS.has(key.toLowerCase())) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return rawUrl.split("#", 1)[0];
  }
}

function hasOriginalVersionMarker(title: string): boolean {
  return (
    /\b(?:originalversion|originalfassung|originalton)\b/i.test(title) ||
    /(?:^|[\s([{._-])(?:OV|OmU|OmdU)(?=$|[\s)\]},._:-])/i.test(title)
  );
}

function hasGermanSubtitleEvidence(item: ApiResultItem): boolean {
  return (
    isGermanLanguageCode(item.subtitleLanguage) ||
    /\b(?:deutsche[nrs]?|german)\s+untertitel\b|\buntertitel\s+(?:auf\s+)?deutsch\b/i.test(
      item.title
    )
  );
}

function hasAudioDescriptionEvidence(item: ApiResultItem): boolean {
  return (
    item.audioDescription === true ||
    /\b(?:audiodeskription|hörfassung|hoerfassung)\b/i.test(item.title)
  );
}

function hasSignLanguageEvidence(item: ApiResultItem): boolean {
  return item.signLanguage === true || /\bgebärdensprache\b/i.test(item.title);
}

function hasClearSpeechEvidence(item: ApiResultItem): boolean {
  return item.clearSpeech === true || /\bklare\s+sprache\b/i.test(item.title);
}

/**
 * Derive edition evidence before title cleanup. Channel names, broadcaster domains,
 * and locale path segments are intentionally excluded as audio-language evidence.
 */
export function classifyLanguageEdition(item: ApiResultItem): LanguageEdition {
  const audioLanguage = normalizedLanguageCode(item.audioLanguage);
  const audioEvidence: AudioEvidence =
    audioLanguage === null ? "unknown" : isGermanLanguageCode(audioLanguage) ? "german" : "other";
  const originalVersion = item.originalVersion === true || hasOriginalVersionMarker(item.title);
  const germanSubtitles = hasGermanSubtitleEvidence(item);
  const audioDescription = hasAudioDescriptionEvidence(item);
  const signLanguage = hasSignLanguageEvidence(item);
  const clearSpeech = hasClearSpeechEvidence(item);

  const featureTokens = [
    ...(audioDescription ? ["AD"] : []),
    ...(signLanguage ? ["SIGN"] : []),
    ...(clearSpeech ? ["CLEAR"] : []),
  ];
  const titleTokens = [
    ...(audioEvidence === "german" ? ["GERMAN"] : []),
    ...(originalVersion ? ["OV"] : []),
    ...(germanSubtitles ? ["SUBBED"] : []),
    ...(audioEvidence === "german" ? featureTokens : []),
  ];
  const variantKey = [
    audioEvidence === "german" ? "de" : (audioLanguage ?? "unknown-audio"),
    originalVersion ? "original" : "not-original",
    germanSubtitles ? "de-subtitles" : "no-de-subtitles",
    ...featureTokens,
  ].join("+");

  return {
    audioEvidence,
    audioLanguage,
    originalVersion,
    germanSubtitles,
    audioDescription,
    signLanguage,
    clearSpeech,
    variantKey,
    titleTokens,
  };
}

export function isLanguageEditionVisible(
  edition: LanguageEdition,
  policy: LanguagePolicy
): boolean {
  const hasAccessibilityVariant =
    edition.audioDescription || edition.signLanguage || edition.clearSpeech;

  if (hasAccessibilityVariant) {
    return (
      edition.audioEvidence === "german" &&
      (!edition.audioDescription || policy.includeAudioDescription) &&
      (!edition.signLanguage || policy.includeSignLanguage) &&
      (!edition.clearSpeech || policy.includeClearSpeech)
    );
  }

  if (edition.originalVersion && edition.audioEvidence !== "german") {
    return edition.germanSubtitles ? policy.includeGermanSubtitleOnly : policy.includeOriginalAudio;
  }
  if (edition.germanSubtitles && edition.audioEvidence !== "german") {
    return policy.includeGermanSubtitleOnly;
  }
  if (edition.audioEvidence === "german") return true;
  if (edition.audioEvidence === "other") return false;
  return policy.includeUnverifiedLegacy;
}

function sourceIdentity(item: ApiResultItem): string {
  const sourceId = typeof item.id === "string" ? item.id.trim() : "";
  try {
    const website = new URL(item.url_website);
    const arteVideo = website.pathname.match(/^\/(?:[a-z]{2})\/videos\/([^/]+)/i);
    if ((website.hostname === "arte.tv" || website.hostname.endsWith(".arte.tv")) && arteVideo) {
      return `arte:${arteVideo[1].toLowerCase()}`;
    }
    const path = website.pathname.replace(/\/$/, "");
    const stableWebsite = new URL(stableUrlIdentity(item.url_website));
    if (path) return `website:${stableWebsite.host.toLowerCase()}${path}${stableWebsite.search}`;
    if (stableWebsite.search)
      return `website:${stableWebsite.host.toLowerCase()}/${stableWebsite.search}`;
  } catch {
    // Fall through to the stable media URL. Provider row IDs may include the URL.
  }

  if (item.url_video) return `video:${stableUrlIdentity(item.url_video)}`;
  if (sourceId) return `source:${sourceId}`;
  return "source:unknown";
}

function editionFamily(edition: LanguageEdition): string {
  if (edition.audioDescription || edition.signLanguage || edition.clearSpeech) {
    return [
      edition.audioDescription ? "ad" : "",
      edition.signLanguage ? "sign" : "",
      edition.clearSpeech ? "clear" : "",
    ]
      .filter(Boolean)
      .join("+");
  }
  return edition.originalVersion ? "original" : edition.germanSubtitles ? "subtitles" : "standard";
}

function evidenceRank(edition: LanguageEdition): number {
  return edition.audioEvidence === "german" ? 2 : edition.audioEvidence === "unknown" ? 1 : 0;
}

/** Select language variants before URL deduplication and pagination. */
export function selectLanguageVariants(
  items: ApiResultItem[],
  policy: LanguagePolicy
): ApiResultItem[] {
  const groups = new Map<
    string,
    Array<{ item: ApiResultItem; edition: LanguageEdition; identity: string }>
  >();

  for (const item of items) {
    const edition = classifyLanguageEdition(item);
    if (!isLanguageEditionVisible(edition, policy)) continue;

    const identity = sourceIdentity(item);
    const key = `${identity}\u0000${editionFamily(edition)}`;
    const group = groups.get(key) ?? [];
    group.push({ item, edition, identity });
    groups.set(key, group);
  }

  const selected: Array<{ item: ApiResultItem; edition: LanguageEdition; identity: string }> = [];
  for (const group of groups.values()) {
    const topRank = Math.max(...group.map(({ edition }) => evidenceRank(edition)));
    const keepOriginalAlternatives =
      group[0].edition.originalVersion && policy.includeOriginalAudio;
    selected.push(
      ...group.filter(
        ({ edition }) => keepOriginalAlternatives || evidenceRank(edition) === topRank
      )
    );
  }

  // Keep feed order chronological except that a proven German edition must win
  // an identical media-URL collision regardless of provider order.
  selected.sort((a, b) => {
    if (a.item.url_video === b.item.url_video) {
      const rankDiff = evidenceRank(b.edition) - evidenceRank(a.edition);
      if (rankDiff !== 0) return rankDiff;
    }
    const dateDiff = b.item.filmlisteTimestamp - a.item.filmlisteTimestamp;
    if (dateDiff !== 0) return dateDiff;
    const stableKey = (entry: (typeof selected)[number]) =>
      [
        entry.identity,
        entry.edition.variantKey,
        entry.item.url_video,
        entry.item.channel,
        entry.item.topic,
        entry.item.title,
        entry.item.duration,
        entry.item.size,
        entry.item.id ?? "",
      ].join("\u0000");
    const firstKey = stableKey(a);
    const secondKey = stableKey(b);
    return firstKey < secondKey ? -1 : firstKey > secondKey ? 1 : 0;
  });

  const seenVideoUrls = new Set<string>();
  return selected.flatMap(({ item }) => {
    if (!item.url_video) return [item];
    if (seenVideoUrls.has(item.url_video)) return [];
    seenVideoUrls.add(item.url_video);
    return [item];
  });
}

export function getLanguageSourceIdentity(item: ApiResultItem): string {
  return sourceIdentity(item);
}
