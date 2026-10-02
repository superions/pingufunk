/**
 * Versioned user preferences for which non-standard audio/subtitle editions may
 * appear in German feeds. German audio labeling is deliberately not configurable:
 * consumers may tag a release GERMAN only after separate evidence proves its audio.
 */
export const LANGUAGE_POLICY_SETTING_KEY = "matching.languagePolicy";
export const LANGUAGE_POLICY_VERSION = 1 as const;

/** Recognize an explicit German language code/name; source locale is not evidence. */
export function isGermanLanguageCode(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  const normalized = value.trim().replaceAll("_", "-").toLowerCase();
  return (
    /^(?:de|deu|ger)(?:-|$)/.test(normalized) || normalized === "german" || normalized === "deutsch"
  );
}

export interface LanguagePolicy {
  version: typeof LANGUAGE_POLICY_VERSION;
  includeOriginalAudio: boolean;
  includeGermanSubtitleOnly: boolean;
  includeAudioDescription: boolean;
  includeSignLanguage: boolean;
  includeClearSpeech: boolean;
  includeUnverifiedLegacy: boolean;
}

export const DEFAULT_LANGUAGE_POLICY: LanguagePolicy = {
  version: LANGUAGE_POLICY_VERSION,
  includeOriginalAudio: false,
  includeGermanSubtitleOnly: false,
  includeAudioDescription: true,
  includeSignLanguage: true,
  includeClearSpeech: true,
  includeUnverifiedLegacy: true,
};

const POLICY_BOOLEAN_KEYS = [
  "includeOriginalAudio",
  "includeGermanSubtitleOnly",
  "includeAudioDescription",
  "includeSignLanguage",
  "includeClearSpeech",
  "includeUnverifiedLegacy",
] as const;

/** Parse only the exact known schema; unknown versions fail closed at the caller. */
export function decodeLanguagePolicy(value: unknown): LanguagePolicy | null {
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value);
    } catch {
      return null;
    }
  }

  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const record = candidate as Record<string, unknown>;
  const expectedKeys = ["version", ...POLICY_BOOLEAN_KEYS];
  if (
    Object.keys(record).length !== expectedKeys.length ||
    expectedKeys.some((key) => !Object.hasOwn(record, key)) ||
    record.version !== LANGUAGE_POLICY_VERSION ||
    POLICY_BOOLEAN_KEYS.some((key) => typeof record[key] !== "boolean")
  ) {
    return null;
  }

  return {
    version: LANGUAGE_POLICY_VERSION,
    includeOriginalAudio: record.includeOriginalAudio as boolean,
    includeGermanSubtitleOnly: record.includeGermanSubtitleOnly as boolean,
    includeAudioDescription: record.includeAudioDescription as boolean,
    includeSignLanguage: record.includeSignLanguage as boolean,
    includeClearSpeech: record.includeClearSpeech as boolean,
    includeUnverifiedLegacy: record.includeUnverifiedLegacy as boolean,
  };
}

/** Stored corruption or a future policy version must never broaden German results. */
export function readLanguagePolicy(value: unknown): LanguagePolicy {
  return decodeLanguagePolicy(value) ?? DEFAULT_LANGUAGE_POLICY;
}

export function serializeLanguagePolicy(policy: LanguagePolicy): string {
  return JSON.stringify({
    version: LANGUAGE_POLICY_VERSION,
    includeOriginalAudio: policy.includeOriginalAudio,
    includeGermanSubtitleOnly: policy.includeGermanSubtitleOnly,
    includeAudioDescription: policy.includeAudioDescription,
    includeSignLanguage: policy.includeSignLanguage,
    includeClearSpeech: policy.includeClearSpeech,
    includeUnverifiedLegacy: policy.includeUnverifiedLegacy,
  });
}
