/** Fully anchored codes: an unknown suffix must not manufacture a German track. */
export function parseArteVersion(code: string) {
  const match =
    /^V(O?)(A|F|E\[(?:ANG|ESP|ITA|POL)\]|EU)?(AUD)?(?:-ST(M?)(A|F|E\[(?:ANG|ESP|ITA|POL)\]|EU))?$/.exec(
      code
    );
  if (!match) return null;
  const language = (value: string | undefined) => {
    const languages: Record<string, string> = {
      A: "de",
      F: "fr",
      "E[ANG]": "en",
      "E[ESP]": "es",
      "E[ITA]": "it",
      "E[POL]": "pl",
      EU: "mul",
    };
    return value ? (languages[value] ?? null) : null;
  };
  return {
    audioLanguage: language(match[2]),
    originalVersion: match[1] === "O",
    audioDescription: match[3] === "AUD",
    subtitleLanguage: language(match[5]),
  };
}

/** Explicit HLS language wins; provider version metadata only fills a missing language. */
export function arteHlsAudioMetadata(language: string | undefined, characteristics = "") {
  const version = characteristics
    .split(",")
    .map((value) => value.trim())
    .find((value) => value.startsWith("tv.arte.audio.version."))
    ?.slice("tv.arte.audio.version.".length);
  const parts = version?.split("-") ?? [];
  const complete = parseArteVersion((version ?? "").toUpperCase());
  const mapped = complete ?? parseArteVersion((parts[0] ?? "").toUpperCase());
  const declared = language?.trim();
  return {
    audioLanguage:
      declared && !/^(?:und|unknown)$/i.test(declared)
        ? declared
        : complete?.audioLanguage ||
          (parts.length > 1 ? parts.at(-1) : null) ||
          mapped?.audioLanguage ||
          null,
    originalVersion: mapped?.originalVersion ?? false,
    audioDescription: mapped?.audioDescription ?? false,
  };
}
