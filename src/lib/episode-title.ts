/** A placeholder supplies no title identity, but never overrides a concrete title conflict. */
export function isPlaceholderEpisodeTitle(title: string, episodeNumber?: number): boolean {
  return (
    /^(?:TBA|TBD|To be announced|To be determined)$/i.test(title.trim()) ||
    new RegExp(
      `^(?:Episode|Folge)\\s+${episodeNumber === undefined ? "\\d+" : `0*${episodeNumber}`}$`,
      "i"
    ).test(title.trim())
  );
}

const germanNumbers = [
  "null",
  "eins",
  "zwei",
  "drei",
  "vier",
  "fünf",
  "sechs",
  "sieben",
  "acht",
  "neun",
  "zehn",
  "elf",
  "zwölf",
  "dreizehn",
  "vierzehn",
  "fünfzehn",
  "sechzehn",
  "siebzehn",
  "achtzehn",
  "neunzehn",
  "zwanzig",
];
const leadingArticles = new Set([
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "eines",
  "der",
  "die",
  "das",
]);

/** Orthographic equivalents only, after series/coordinate identity is verified.
 * No similarity threshold, translation, arbitrary missing word or date override.
 */
export function equivalentEpisodeTitles(left: string, right: string): boolean {
  const keys = (title: string) => {
    const words =
      title
        .normalize("NFKC")
        .toLocaleLowerCase("de-DE")
        .replace(/(?<=\p{L})[-\u2010\u2011](?=\p{L})/gu, "")
        .match(/[\p{L}\p{N}]+/gu) ?? [];
    const key = (parts: string[]) =>
      parts
        .map((word) => {
          const number = germanNumbers.indexOf(word);
          return number < 0 ? word : String(number);
        })
        .join(" ");
    return [
      key(words),
      ...(leadingArticles.has(words[0] ?? "") ? [key(words.slice(1))] : []),
    ].filter(Boolean);
  };
  const rightKeys = keys(right);
  return keys(left).some((key) => rightKeys.includes(key));
}
