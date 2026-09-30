import { arrApiUrl } from "./read-only-arr-client";

export const SONARR_DEFAULT_SETTINGS: Record<string, string> = {
  "integration.sonarr.enabled": "false",
  "integration.sonarr.url": "",
  "integration.sonarr.windowDays": "14",
  "matching.sonarr.tolerancePercent": "10",
};

/** Null rejects a malformed setting; undefined means another owner handles it. */
export function validateSonarrSetting(key: string, value: unknown): string | null | undefined {
  if (key === "integration.sonarr.enabled")
    return typeof value === "string" && ["true", "false"].includes(value) ? value : null;
  if (key === "integration.sonarr.url") {
    if (typeof value !== "string" || value.length > 4096) return null;
    if (value.trim() === "") return "";
    try {
      arrApiUrl(value.trim(), "api/v3/system/status");
      return value.trim();
    } catch {
      return null;
    }
  }
  const bounds =
    key === "integration.sonarr.windowDays"
      ? [1, 90]
      : key === "matching.sonarr.tolerancePercent"
        ? [0, 25]
        : key === "matching.minDuration"
          ? [0, Number.MAX_SAFE_INTEGER]
          : null;
  if (!bounds) return undefined;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= bounds[0] && number <= bounds[1]
    ? String(number)
    : null;
}
