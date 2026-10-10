import type { ApiResultItem } from "@/types";
import {
  unknownMediaExpectations,
  parseMediaExpectations,
  type LegacyMediaExpectations,
  type NewMediaExpectations,
} from "@/lib/media-expectations";
import { classifyLanguageEdition } from "./language-editions";
import { mediaSourceIdentity } from "./source-audio";
import { renditionDimensions } from "./rendition-quality";

/** Catalogue durations are seconds; verified episode metadata is minutes. */
export function releaseMediaExpectations(
  item: ApiResultItem,
  episodeRuntimeMinutes: number | null = null,
  renditionUrl: string = item.url_video || item.url_video_hd || item.url_video_low
): LegacyMediaExpectations {
  const expected = unknownMediaExpectations();
  const dimensions = renditionDimensions(item, renditionUrl);
  if (dimensions) expected.resolution = { ...dimensions, provenance: "provider_dimensions" };
  const episodeSeconds = episodeRuntimeMinutes === null ? null : episodeRuntimeMinutes * 60;
  if (
    episodeSeconds !== null &&
    Number.isFinite(episodeSeconds) &&
    episodeSeconds > 0 &&
    episodeSeconds <= Number.MAX_SAFE_INTEGER
  )
    expected.duration = { seconds: episodeSeconds, provenance: "episode_metadata" };
  else if (
    Number.isFinite(item.duration) &&
    item.duration > 0 &&
    item.duration <= Number.MAX_SAFE_INTEGER
  )
    expected.duration = { seconds: item.duration, provenance: "source_catalogue" };
  const edition = classifyLanguageEdition(item);
  if (item.sourceAudioEvidence) {
    // A provider promise is not a container tag. Its separate v2 proof will be
    // revalidated by the worker against the exact URL, without stamping tracks.
    if (item.sourceAudioEvidence.mediaIdentity !== mediaSourceIdentity(renditionUrl))
      throw new Error("Source evidence mismatch");
    return parseMediaExpectations({
      ...expected,
      version: 2,
      sourceAudio: item.sourceAudioEvidence,
    }) as LegacyMediaExpectations;
  }
  if (edition.audioEvidence === "german")
    expected.audio = { language: "de", provenance: "provider_audio" };
  else if (edition.audioLanguage) {
    try {
      const language = new Intl.Locale(edition.audioLanguage).language;
      if (typeof language === "string" && !["und", "mul", "zxx"].includes(language))
        expected.audio = { language, provenance: "provider_audio" };
    } catch {
      // Unrecognized source text is not an audio-language fact.
    }
  }
  // Only exact-URL evidence above supplies dimensions, never a quality label.
  return parseMediaExpectations(expected) as LegacyMediaExpectations;
}

/** Review carries both original references; legacy producers remain unchanged. */
export function tvReviewMediaExpectations(
  item: ApiResultItem,
  runtimeMinutes: number,
  url: string,
  tolerancePercent: number
): NewMediaExpectations {
  const facts = releaseMediaExpectations(item, null, url);
  return parseMediaExpectations({
    version: 3,
    mediaKind: "series",
    durations: {
      source: { seconds: item.duration, provenance: "source_catalogue", tolerancePercent: 10 },
      metadata: { seconds: runtimeMinutes * 60, provenance: "episode_metadata", tolerancePercent },
    },
    audio: facts.audio,
    sourceAudio: facts.version === 2 ? facts.sourceAudio : null,
    resolution: facts.resolution,
  }) as NewMediaExpectations;
}
