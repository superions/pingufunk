import type { ApiResultItem } from "@/types";
import {
  unknownMediaExpectations,
  parseMediaExpectations,
  type MediaExpectations,
} from "@/lib/media-expectations";
import { classifyLanguageEdition } from "./language-editions";

/** Catalogue durations are seconds; verified episode metadata is minutes. */
export function releaseMediaExpectations(
  item: ApiResultItem,
  episodeRuntimeMinutes: number | null = null
): MediaExpectations {
  const expected = unknownMediaExpectations();
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
  // Quality labels/rendition selectors do not prove actual width/height.
  return parseMediaExpectations(expected);
}
