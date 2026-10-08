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

/** Catalogue durations are seconds; verified episode metadata is minutes. */
export function releaseMediaExpectations(
  item: ApiResultItem,
  episodeRuntimeMinutes: number | null = null,
  renditionUrl: string = item.url_video || item.url_video_hd || item.url_video_low,
  mediaKind: NewMediaExpectations["mediaKind"] = "unknown"
): NewMediaExpectations {
  const expected = unknownJobMediaExpectations();
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
    if (item.sourceAudioEvidence.mediaIdentity !== mediaSourceIdentity(renditionUrl))
      throw new Error("Source evidence mismatch");
    return parseMediaExpectations({
      ...expected,
      sourceAudio: item.sourceAudioEvidence,
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
  return parseMediaExpectations(expected) as NewMediaExpectations;
}
