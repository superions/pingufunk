import { parseArrBaseUrl } from "./arr-base-url";
import { isDownloadPathInput } from "./download-path-input";
import { MAX_PROVIDER_RESPONSE_BYTES } from "./bounded-provider-json";
import {
  decodeLanguagePolicy,
  DEFAULT_LANGUAGE_POLICY,
  serializeLanguagePolicy,
} from "./language-policy";

type Definition = {
  defaultValue: string;
  kind: "boolean" | "integer" | "decimal" | "enum" | "path" | "arr-url" | "language-policy";
  unit?: "percent" | "years" | "days" | "seconds" | "MiB";
  min?: number;
  max?: number;
  choices?: readonly string[];
};
const bool = (defaultValue: boolean): Definition => ({
  kind: "boolean",
  defaultValue: String(defaultValue),
});
const integer = (
  defaultValue: number,
  min: number,
  max: number,
  unit: Definition["unit"]
): Definition => ({ kind: "integer", defaultValue: String(defaultValue), min, max, unit });

/** Public, nonsecret product settings. Unknown historical DB keys remain readable only. */
export const SETTING_DEFINITIONS = {
  "download.path": { kind: "path", defaultValue: "/downloads" },
  "download.ytdlpPath": { kind: "path", defaultValue: "" },
  "download.quality": {
    kind: "enum",
    defaultValue: "all",
    choices: ["all", "best", "1080p", "720p", "480p"],
  },
  "download.convertToMkv": bool(true),
  "download.enableHLS": bool(false),
  "provider.mediathekview.enabled": bool(true),
  "provider.orf.enabled": bool(false),
  // Historically SRF is eligible without this row only when credentials and
  // HLS are configured. Its provider still enforces both gates independently.
  "provider.srf.enabled": bool(true),
  "matching.strategy": { kind: "enum", defaultValue: "fuzzy", choices: ["fuzzy", "strict"] },
  "matching.threshold": { kind: "decimal", defaultValue: "0.7", min: 0, max: 1 },
  "matching.minDuration": integer(300, 0, Number.MAX_SAFE_INTEGER, "seconds"),
  "matching.movie.tolerancePercent": integer(10, 0, 25, "percent"),
  "matching.sonarr.tolerancePercent": integer(10, 0, 25, "percent"),
  "matching.movie.yearTolerance": integer(1, 1, 5, "years"),
  "matching.languagePolicy": {
    kind: "language-policy",
    defaultValue: serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY),
  },
  "integration.sonarr.enabled": bool(false),
  "integration.sonarr.url": { kind: "arr-url", defaultValue: "" },
  "integration.sonarr.windowDays": integer(14, 1, 90, "days"),
  "integration.radarr.enabled": bool(false),
  "integration.radarr.url": { kind: "arr-url", defaultValue: "" },
  "integration.radarr.inventoryMaxMiB": integer(
    10,
    1,
    MAX_PROVIDER_RESPONSE_BYTES / (1024 * 1024),
    "MiB"
  ),
  "cache.ttl.search": integer(3600, 0, 86400, "seconds"),
  "cache.ttl.metadata": integer(86400, 0, 604800, "seconds"),
  "system.setupComplete": bool(false),
} satisfies Record<string, Definition>;
export type WritableSettingKey = keyof typeof SETTING_DEFINITIONS;

export function isWritableSettingKey(key: string): key is WritableSettingKey {
  return Object.hasOwn(SETTING_DEFINITIONS, key);
}

export const DEFAULT_PRODUCT_SETTINGS: Record<WritableSettingKey, string> = Object.fromEntries(
  Object.entries(SETTING_DEFINITIONS).map(([key, definition]) => [key, definition.defaultValue])
) as Record<WritableSettingKey, string>;

export class SettingConfigurationError extends Error {
  constructor(key: WritableSettingKey) {
    super(`Invalid stored setting: ${key}`);
  }
}

/** Missing selects the product default; invalid stored values never select a fallback. */
export function configuredSetting(key: WritableSettingKey, value: string | null): string {
  if (value === null) return DEFAULT_PRODUCT_SETTINGS[key];
  const normalized = normalizeSetting(key, value);
  if (normalized === null || normalized === undefined) throw new SettingConfigurationError(key);
  return normalized;
}

/** Undefined denotes another/legacy owner; null rejects a malformed known setting. */
export function normalizeSetting(key: string, value: unknown): string | null | undefined {
  if (!isWritableSettingKey(key)) return undefined;
  if (typeof value !== "string") return null;
  const definition: Definition = SETTING_DEFINITIONS[key];
  switch (definition.kind) {
    case "boolean":
      return value === "true" || value === "false" ? value : null;
    case "enum":
      return definition.choices?.includes(value) ? value : null;
    case "integer": {
      if (!/^\d+$/.test(value)) return null;
      const number = Number(value);
      return Number.isSafeInteger(number) && number >= definition.min! && number <= definition.max!
        ? String(number)
        : null;
    }
    case "decimal": {
      // Comma decimals are a retained historical input contract, not parseFloat prefixes.
      if (!/^\d+(?:[.,]\d+)?$/.test(value)) return null;
      const number = Number(value.replace(",", "."));
      return Number.isFinite(number) && number >= definition.min! && number <= definition.max!
        ? String(number)
        : null;
    }
    case "path":
      return value === "" || isDownloadPathInput(value) ? value : null;
    case "arr-url": {
      if (value.length > 4096) return null;
      if (value.trim() === "") return "";
      try {
        parseArrBaseUrl(value.trim());
        return value.trim();
      } catch {
        return null;
      }
    }
    case "language-policy": {
      const policy = decodeLanguagePolicy(value);
      return policy ? serializeLanguagePolicy(policy) : null;
    }
  }
}

/** Preserve corrupt stored values for explicit repair; never silently persist defaults. */
export function invalidSettingKeys(settings: Record<string, string>): WritableSettingKey[] {
  return Object.keys(settings)
    .filter(isWritableSettingKey)
    .filter((key) => normalizeSetting(key, settings[key]) === null);
}
