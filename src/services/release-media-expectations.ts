import type { ApiResultItem } from "@/types";
import {
  unknownJobMediaExpectations,
  parseMediaExpectations,
  type NewMediaExpectations,
} from "@/lib/media-expectations";
import { productSettingsContext } from "@/lib/product-settings-context";
import { configuredSetting } from "@/lib/settings-schema";
import { classifyLanguageEdition } from "./language-editions";
import { mediaSourceIdentity } from "./source-audio";
import { renditionDimensions } from "./rendition-quality";
import { youtubeSourceReferenceSchema, youtubeWatchUrl } from "@/lib/youtube-source";
import type { MediathekProgrammeIdentity } from "@/lib/mediathek-programme";

/** Explicit bindings publish only the proved standard German rendition. Cold proof stays pending. */
export function programmeRenditionVerified(item: ApiResultItem, url: string): boolean {
  const edition = classifyLanguageEdition(item);
  return (
    edition.audioEvidence === "german" &&
    !edition.audioDescription &&
    !edition.signLanguage &&
    !edition.clearSpeech &&
    !edition.originalVersion &&
    !!renditionDimensions(item, url)
  );
}

/** Catalogue durations are seconds; verified episode metadata is minutes. */
export function releaseMediaExpectations(
  item: ApiResultItem,
  episodeRuntimeMinutes: number | null = null,
  renditionUrl: string = item.url_video || item.url_video_hd || item.url_video_low,
  mediaKind: NewMediaExpectations["mediaKind"] = "unknown",
  programme?: MediathekProgrammeIdentity
): NewMediaExpectations {
  const expected = unknownJobMediaExpectations();
  const source = item.sourceRef ? youtubeSourceReferenceSchema.parse(item.sourceRef) : null;
  if (source && renditionUrl !== youtubeWatchUrl(source))
    throw Error("Typed source selector mismatch");
  if (programme && (source || !programmeRenditionVerified(item, renditionUrl)))
    throw Error("Programme rendition unverified");
  const programmeFields = programme
    ? {
        version: 6,
        sourceProgramme: {
          ...programme,
          renditionIdentity: mediaSourceIdentity(renditionUrl),
        },
      }
    : {};
  expected.mediaKind = mediaKind;
  const dimensions = renditionDimensions(item, renditionUrl);
  if (dimensions) expected.resolution = { ...dimensions, provenance: "provider_dimensions" };
  const episodeSeconds = episodeRuntimeMinutes === null ? null : episodeRuntimeMinutes * 60;
  if (
    mediaKind === "series" &&
    episodeSeconds !== null &&
    Number.isFinite(episodeSeconds) &&
    episodeSeconds > 0 &&
    episodeSeconds <= Number.MAX_SAFE_INTEGER
  )
    expected.durations.metadata = {
      seconds: episodeSeconds,
      provenance: "episode_metadata",
      tolerancePercent: Number(
        configuredSetting(
          "matching.sonarr.tolerancePercent",
          productSettingsContext.getStore()?.values["matching.sonarr.tolerancePercent"] ?? null
        )
      ),
    };
  if (
    Number.isFinite(item.duration) &&
    item.duration > 0 &&
    item.duration <= Number.MAX_SAFE_INTEGER
  )
    expected.durations.source = {
      seconds: item.duration,
      provenance: "source_catalogue",
      tolerancePercent: 10,
    };
  const edition = classifyLanguageEdition(item);
  if (item.sourceAudioEvidence) {
    // A provider promise is not a container tag. Its separate proof will be
    // revalidated by the worker against the exact URL, without stamping tracks.
    if (
      item.sourceAudioEvidence.mediaIdentity !==
      mediaSourceIdentity(renditionUrl, source ?? undefined)
    )
      throw new Error("Source evidence mismatch");
    return parseMediaExpectations({
      ...expected,
      sourceAudio: item.sourceAudioEvidence,
      ...(source ? { version: 5, sourceRef: source, mediaKind: source.programme.kind } : {}),
      ...programmeFields,
    }) as NewMediaExpectations;
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
  if (source || (item.sourceRef && renditionUrl !== youtubeWatchUrl(item.sourceRef)))
    throw new Error("Typed source requires verified audio");
  return parseMediaExpectations({ ...expected, ...programmeFields }) as NewMediaExpectations;
}

/** Review carries both original references; legacy producers remain unchanged. */
export function tvReviewMediaExpectations(
  item: ApiResultItem,
  runtimeMinutes: number,
  url: string,
  tolerancePercent: number,
  programme?: MediathekProgrammeIdentity
): NewMediaExpectations {
  const facts = releaseMediaExpectations(item, runtimeMinutes, url, "series", programme);
  return parseMediaExpectations({
    ...facts,
    mediaKind: "series",
    durations: {
      source: { seconds: item.duration, provenance: "source_catalogue", tolerancePercent: 10 },
      metadata: { seconds: runtimeMinutes * 60, provenance: "episode_metadata", tolerancePercent },
    },
  }) as NewMediaExpectations;
}
