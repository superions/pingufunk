export const GERMAN_MONTHS: Record<string, number> = {
  januar: 0,
  februar: 1,
  märz: 2,
  april: 3,
  mai: 4,
  juni: 5,
  juli: 6,
  august: 7,
  september: 8,
  oktober: 9,
  november: 10,
  dezember: 11,
};

export function parseGermanDate(dateString: string): Date | null {
  // Supported German date formats:
  // - "d. MMMM yyyy" (e.g., "7. Juni 2024")
  // - "dd.MM.yyyy" (e.g., "31.12.2017")
  // - "yyyy-MM-dd" (e.g., "2017-12-01")
  // - "yyyyMMdd" (e.g., "20171201")

  const makeDate = (year: number, month: number, day: number): Date | null => {
    const date = new Date(year, month, day);
    return date.getFullYear() === year && date.getMonth() === month && date.getDate() === day
      ? date
      : null;
  };

  // Try "d. MMMM yyyy" format
  const match1 = dateString.match(/^(\d{1,2})\. (\p{L}+) (\d{4})$/u);
  if (match1) {
    const day = parseInt(match1[1]);
    const month = GERMAN_MONTHS[match1[2].toLowerCase()];
    const year = parseInt(match1[3]);
    if (month !== undefined) {
      return makeDate(year, month, day);
    }
  }

  // Try "dd.MM.yyyy" format
  const match2 = dateString.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (match2) {
    return makeDate(parseInt(match2[3]), parseInt(match2[2]) - 1, parseInt(match2[1]));
  }

  // Try "yyyy-MM-dd" format
  const match3 = dateString.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match3) {
    return makeDate(parseInt(match3[1]), parseInt(match3[2]) - 1, parseInt(match3[3]));
  }

  // Try "yyyyMMdd" format
  const match4 = dateString.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (match4) {
    return makeDate(parseInt(match4[1]), parseInt(match4[2]) - 1, parseInt(match4[3]));
  }

  return null;
}
