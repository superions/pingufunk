import { DEFAULT_PRODUCT_SETTINGS, normalizeSetting } from "./settings-schema";

export const SONARR_DEFAULT_SETTINGS: Record<string, string> = {
  "integration.sonarr.enabled": DEFAULT_PRODUCT_SETTINGS["integration.sonarr.enabled"],
  "integration.sonarr.url": DEFAULT_PRODUCT_SETTINGS["integration.sonarr.url"],
  "integration.sonarr.windowDays": DEFAULT_PRODUCT_SETTINGS["integration.sonarr.windowDays"],
  "matching.sonarr.tolerancePercent": DEFAULT_PRODUCT_SETTINGS["matching.sonarr.tolerancePercent"],
};

/** Null rejects a malformed setting; undefined means another owner handles it. */
export function validateSonarrSetting(key: string, value: unknown): string | null | undefined {
  return Object.hasOwn(SONARR_DEFAULT_SETTINGS, key) || key === "matching.minDuration"
    ? normalizeSetting(key, value)
    : undefined;
}
