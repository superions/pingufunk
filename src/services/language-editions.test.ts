import { describe, expect, it } from "vitest";
import { DEFAULT_LANGUAGE_POLICY } from "@/lib/language-policy";
import type { ApiResultItem } from "@/types";
import {
  classifyLanguageEdition,
  isLanguageEditionVisible,
  selectLanguageVariants,
} from "./language-editions";

const base: ApiResultItem = {
  id: "source-1",
  channel: "ARTE.FR",
  topic: "Example",
  title: "Example programme",
  description: "Synthetic source fixture",
  filmlisteTimestamp: 1_700_000_000,
  duration: 1800,
  size: 500_000_000,
  url_website: "https://www.arte.tv/fr/videos/123456-001-A/example/",
  url_video: "https://example.org/example-fr.mp4",
  url_video_low: "",
  url_video_hd: "",
};

describe("language edition evidence", () => {
  it("does not infer audio language from a foreign channel, domain, or locale URL", () => {
    const edition = classifyLanguageEdition(base);

    expect(edition.audioEvidence).toBe("unknown");
    expect(edition.titleTokens).not.toContain("GERMAN");
    expect(isLanguageEditionVisible(edition, DEFAULT_LANGUAGE_POLICY)).toBe(true);
  });

  it("adds GERMAN only for explicit German audio evidence", () => {
    const edition = classifyLanguageEdition({ ...base, audioLanguage: "de-DE" });

    expect(edition.audioEvidence).toBe("german");
    expect(edition.titleTokens).toContain("GERMAN");
  });

  it("keeps an explicitly foreign singleton out of the German feed", () => {
    const edition = classifyLanguageEdition({ ...base, audioLanguage: "fr" });

    expect(edition.audioEvidence).toBe("other");
    expect(edition.titleTokens).not.toContain("GERMAN");
    expect(isLanguageEditionVisible(edition, DEFAULT_LANGUAGE_POLICY)).toBe(false);
  });

  it("treats German subtitles as a separate optional edition, not German audio", () => {
    const item = { ...base, title: "Example (OV, deutsche Untertitel)" };
    const edition = classifyLanguageEdition(item);

    expect(edition.titleTokens).toContain("OV");
    expect(edition.titleTokens).toContain("SUBBED");
    expect(edition.titleTokens).not.toContain("GERMAN");
    expect(isLanguageEditionVisible(edition, DEFAULT_LANGUAGE_POLICY)).toBe(false);
    expect(
      isLanguageEditionVisible(edition, {
        ...DEFAULT_LANGUAGE_POLICY,
        includeGermanSubtitleOnly: true,
      })
    ).toBe(true);
  });

  it("requires proven German audio before exposing accessibility variants", () => {
    const unverified = classifyLanguageEdition({ ...base, title: "Example (Audiodeskription)" });
    const german = classifyLanguageEdition({
      ...base,
      audioLanguage: "de",
      title: "Example (Audiodeskription)",
    });

    expect(unverified.titleTokens).not.toContain("AD");
    expect(isLanguageEditionVisible(unverified, DEFAULT_LANGUAGE_POLICY)).toBe(false);
    expect(german.titleTokens).toEqual(["GERMAN", "AD"]);
    expect(isLanguageEditionVisible(german, DEFAULT_LANGUAGE_POLICY)).toBe(true);
    expect(
      isLanguageEditionVisible(german, {
        ...DEFAULT_LANGUAGE_POLICY,
        includeAudioDescription: false,
      })
    ).toBe(false);
  });

  it.each([
    ["Gebärdensprache", "SIGN", "includeSignLanguage"],
    ["Klare Sprache", "CLEAR", "includeClearSpeech"],
  ] as const)("gates %s as its own proven-German variant", (marker, token, policyKey) => {
    const unknown = classifyLanguageEdition({ ...base, title: `Example (${marker})` });
    const german = classifyLanguageEdition({
      ...base,
      title: `Example (${marker})`,
      audioLanguage: "de",
    });

    expect(unknown.titleTokens).not.toContain(token);
    expect(isLanguageEditionVisible(unknown, DEFAULT_LANGUAGE_POLICY)).toBe(false);
    expect(german.titleTokens).toContain(token);
    expect(isLanguageEditionVisible(german, DEFAULT_LANGUAGE_POLICY)).toBe(true);
    expect(
      isLanguageEditionVisible(german, { ...DEFAULT_LANGUAGE_POLICY, [policyKey]: false })
    ).toBe(false);
  });
});

describe("source variant selection", () => {
  const french = {
    ...base,
    id: "french-variant",
    channel: "ARTE.FR",
    url_video: "https://example.org/example-fr.mp4",
    url_website: "https://www.arte.tv/fr/videos/123456-001-A/example-fr/",
  };
  const german = {
    ...base,
    id: "german-variant",
    channel: "ARTE.DE",
    audioLanguage: "de",
    url_video: "https://example.org/example-de.mp4",
    url_website: "https://www.arte.tv/de/videos/123456-001-A/example-de/",
  };

  it("prefers a proven German edition independent of provider order", () => {
    expect(selectLanguageVariants([french, german], DEFAULT_LANGUAGE_POLICY)).toEqual([german]);
    expect(selectLanguageVariants([german, french], DEFAULT_LANGUAGE_POLICY)).toEqual([german]);
  });

  it("does not lose the German edition when both URLs collide", () => {
    const collidingGerman = { ...german, url_video: french.url_video };

    expect(selectLanguageVariants([french, collidingGerman], DEFAULT_LANGUAGE_POLICY)).toEqual([
      collidingGerman,
    ]);
    expect(selectLanguageVariants([collidingGerman, french], DEFAULT_LANGUAGE_POLICY)).toEqual([
      collidingGerman,
    ]);
  });

  it("keeps a neutral unknown singleton visible without calling it German", () => {
    const [selected] = selectLanguageVariants([french], DEFAULT_LANGUAGE_POLICY);

    expect(selected).toEqual(french);
    expect(classifyLanguageEdition(selected).titleTokens).not.toContain("GERMAN");
  });

  it("does not collapse distinct candidates merely because their standard URL is absent", () => {
    const first = { ...base, url_video: "", url_video_hd: "https://example.org/first-hd.mp4" };
    const second = { ...base, url_video: "", url_video_hd: "https://example.org/second-hd.mp4" };

    expect(selectLanguageVariants([first, second], DEFAULT_LANGUAGE_POLICY)).toEqual([
      first,
      second,
    ]);
  });
});
