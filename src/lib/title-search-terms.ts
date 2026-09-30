/** Retrieval terms are not identity evidence; at most three share the caller budget. */
export function titleSearchTerms(titles: string[]): string[] {
  const terms = [...new Set(titles.map((title) => title.trim()).filter(Boolean))].slice(0, 3);
  for (const title of [...terms]) {
    const folded = title
      .replace(/ä/g, "ae")
      .replace(/ö/g, "oe")
      .replace(/ü/g, "ue")
      .replace(/Ä/g, "Ae")
      .replace(/Ö/g, "Oe")
      .replace(/Ü/g, "Ue")
      .replace(/ß/g, "ss");
    if (terms.length < 3 && !terms.includes(folded)) terms.push(folded);
    const words = title.split(/\s+/).filter((word) => word.length >= 4);
    const distinctive =
      words.length >= 2 && title.split(/\s+/).length > 2
        ? [...words]
            .sort((a, b) => b.length - a.length)
            .slice(0, 2)
            .join(" ")
        : null;
    if (distinctive && terms.length < 3 && !terms.includes(distinctive)) terms.push(distinctive);
  }
  return terms;
}
