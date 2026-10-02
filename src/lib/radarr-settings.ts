import { arrApiUrl } from "./read-only-arr-client";

export const RADARR_DEFAULT_SETTINGS: Record<string, string> = {
  "integration.radarr.enabled": "false",
  "integration.radarr.url": "",
  "matching.movie.tolerancePercent": "10",
};

/** Credentials are external; the settings API only accepts activation and routing. */
export function validateRadarrSetting(key: string, value: unknown): string | null | undefined {
  if (key === "integration.radarr.enabled")
    return typeof value === "string" && ["true", "false"].includes(value) ? value : null;
  if (key === "integration.radarr.url") {
    if (typeof value !== "string" || value.length > 4096) return null;
    if (!value.trim()) return "";
    try {
      arrApiUrl(value.trim(), "api/v3/system/status");
      return value.trim();
    } catch {
      return null;
    }
  }
  if (key === "matching.movie.tolerancePercent") {
    if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number <= 25 ? String(number) : null;
  }
  return undefined;
}
