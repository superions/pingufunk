import { DEFAULT_PRODUCT_SETTINGS, normalizeSetting } from "./settings-schema";

export const RADARR_DEFAULT_SETTINGS: Record<string, string> = {
  "integration.radarr.enabled": DEFAULT_PRODUCT_SETTINGS["integration.radarr.enabled"],
  "integration.radarr.url": DEFAULT_PRODUCT_SETTINGS["integration.radarr.url"],
  "integration.radarr.inventoryMaxMiB":
    DEFAULT_PRODUCT_SETTINGS["integration.radarr.inventoryMaxMiB"],
  "matching.movie.tolerancePercent": DEFAULT_PRODUCT_SETTINGS["matching.movie.tolerancePercent"],
};

/** Credentials are external; only nonsecret integration/matching settings are writable. */
export function validateRadarrSetting(key: string, value: unknown): string | null | undefined {
  return Object.hasOwn(RADARR_DEFAULT_SETTINGS, key) ? normalizeSetting(key, value) : undefined;
}
