import { describe, expect, it } from "vitest";
import {
  DEFAULT_LANGUAGE_POLICY,
  decodeLanguagePolicy,
  readLanguagePolicy,
  serializeLanguagePolicy,
} from "./language-policy";

describe("versioned language policy", () => {
  it("defaults uncertain audio and legacy variants off while allowing proven German variants", () => {
    expect(DEFAULT_LANGUAGE_POLICY).toEqual({
      version: 1,
      includeOriginalAudio: false,
      includeGermanSubtitleOnly: false,
      includeAudioDescription: true,
      includeSignLanguage: true,
      includeClearSpeech: true,
      includeUnverifiedLegacy: false,
    });
  });

  it("round-trips the exact known schema", () => {
    expect(decodeLanguagePolicy(serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY))).toEqual(
      DEFAULT_LANGUAGE_POLICY
    );
  });

  it.each([
    "not-json",
    JSON.stringify({ ...DEFAULT_LANGUAGE_POLICY, version: 2 }),
    JSON.stringify({ ...DEFAULT_LANGUAGE_POLICY, includeOriginalAudio: "true" }),
    JSON.stringify({ ...DEFAULT_LANGUAGE_POLICY, labelUnknownAudioAsGerman: true }),
  ])("rejects malformed, future, or unsafe policies: %s", (value) => {
    expect(decodeLanguagePolicy(value)).toBeNull();
    expect(readLanguagePolicy(value)).toEqual(DEFAULT_LANGUAGE_POLICY);
  });
});
