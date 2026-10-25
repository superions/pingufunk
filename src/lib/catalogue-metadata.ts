import type { ApiResultItem } from "@/types";
import { sourceDay, sourceEpoch, type ContentDates } from "./content-dates";

/** Optional catalogue facts only; rendition proofs and download identities are never projected. */
export type CatalogueMetadata = Pick<
  ApiResultItem,
  | "url_subtitle"
  | "productionYear"
  | "audioLanguage"
  | "subtitleLanguage"
  | "originalVersion"
  | "audioDescription"
  | "signLanguage"
  | "clearSpeech"
  | "contentDates"
>;

/** Preserve exact signed URLs without accepting executable schemes or embedded credentials. */
function subtitleUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value))
    return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Only trusted adapters may pass language/edition facts; raw clients must explicitly whitelist inputs. */
export function catalogueMetadata(
  value: Partial<Record<keyof CatalogueMetadata, unknown>>
): CatalogueMetadata {
  const result: CatalogueMetadata = {};
  const subtitle = subtitleUrl(value.url_subtitle);
  if (subtitle) result.url_subtitle = subtitle;
  if (
    typeof value.productionYear === "number" &&
    Number.isSafeInteger(value.productionYear) &&
    value.productionYear >= 1800 &&
    value.productionYear <= 2199
  )
    result.productionYear = value.productionYear;
  for (const key of ["audioLanguage", "subtitleLanguage"] as const) {
    const language = value[key];
    if (language === null) result[key] = null;
    else if (
      typeof language === "string" &&
      language.trim() &&
      language.length <= 64 &&
      !/[\x00-\x1f\x7f]/.test(language)
    )
      result[key] = language.trim();
  }
  for (const key of ["originalVersion", "audioDescription", "signLanguage", "clearSpeech"] as const)
    if (typeof value[key] === "boolean") result[key] = value[key];

  const rawDates = value.contentDates;
  if (rawDates && typeof rawDates === "object" && !Array.isArray(rawDates)) {
    const dates: ContentDates = {};
    for (const key of ["catalogueUpdatedAt", "broadcastAt", "providerDate"] as const) {
      const epoch = sourceEpoch(Reflect.get(rawDates, key));
      if (epoch !== undefined) dates[key] = epoch;
    }
    const day = sourceDay(Reflect.get(rawDates, "providerDay"));
    if (day) dates.providerDay = day;
    if (Object.keys(dates).length) result.contentDates = dates;
  }
  return result;
}
