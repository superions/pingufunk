import { prisma } from "@/lib/db";
import { credentialOverride } from "@/lib/credential-settings";
import {
  DEFAULT_PRODUCT_SETTINGS,
  configuredSetting,
  isWritableSettingKey,
} from "./settings-schema";
import { productSettingsContext } from "./product-settings-context";

interface SettingEntry {
  value: string | null;
  expiry: number;
}

const settingsCache = new Map<string, SettingEntry>();
const inFlight = new Map<string, Promise<string | null>>();
const MAX_SETTINGS_CACHE = 256;
const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 5_000;
let cacheEpoch = 0;

function cachedSetting(key: string): SettingEntry | undefined {
  const entry = settingsCache.get(key);
  if (!entry) return undefined;
  if (Date.now() >= entry.expiry) {
    settingsCache.delete(key);
    return undefined;
  }
  settingsCache.delete(key);
  settingsCache.set(key, entry);
  return entry;
}

function putSetting(key: string, value: string | null): void {
  settingsCache.delete(key);
  settingsCache.set(key, {
    value,
    expiry: Date.now() + (value === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS),
  });
  if (settingsCache.size > MAX_SETTINGS_CACHE) {
    settingsCache.delete(settingsCache.keys().next().value!);
  }
}

/** Coalesce lookups and keep misses short-lived; invalidation beats late reads. */
export async function getSetting(key: string): Promise<string | null> {
  const snapshot = productSettingsContext.getStore();
  if (snapshot && isWritableSettingKey(key)) return snapshot.values[key];
  const external = await credentialOverride(key);
  if (external.configured) return external.value;
  const cached = cachedSetting(key);
  if (cached) return cached.value;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const epoch = cacheEpoch;
  let lookup!: Promise<string | null>;
  lookup = (async () => {
    try {
      const config = await prisma.config.findUnique({ where: { key } });
      const value = config?.value ?? null;
      if (epoch === cacheEpoch) putSetting(key, value);
      return value;
    } finally {
      if (inFlight.get(key) === lookup) inFlight.delete(key);
    }
  })();
  inFlight.set(key, lookup);
  return lookup;
}

export async function getSettings(keys: string[]): Promise<Record<string, string | null>> {
  const entries = await Promise.all(
    [...new Set(keys)].map(async (key) => [key, await getSetting(key)])
  );
  return Object.fromEntries(entries);
}

export async function getMinDurationSeconds(): Promise<number> {
  return Number(
    configuredSetting("matching.minDuration", await getSetting("matching.minDuration"))
  );
}

/** One database statement captures the nonsecret policy for an entire search.
 * Nested owners reuse it; old operations cannot publish after invalidation.
 * Credentials stay with their existing server-only owners, outside this scope.
 */
export async function withSettingsSnapshot<T>(operation: () => Promise<T>): Promise<T> {
  if (productSettingsContext.getStore()) return operation();
  const epoch = cacheEpoch;
  const rows = await prisma.config.findMany({
    where: { key: { in: Object.keys(DEFAULT_PRODUCT_SETTINGS) } },
    select: { key: true, value: true },
  });
  const values = { ...DEFAULT_PRODUCT_SETTINGS };
  for (const row of rows) {
    if (!isWritableSettingKey(row.key)) continue;
    // Search never treats malformed matching, rendition or provider settings as
    // implicit defaults. Paths remain owned by download enqueue validation.
    values[row.key] =
      (row.key.startsWith("download.") && row.key.endsWith("Path")) || row.key === "download.path"
        ? row.value
        : configuredSetting(row.key, row.value);
  }
  const isCurrent = () => epoch === cacheEpoch;
  if (!isCurrent()) throw new Error("Settings changed during search");
  return productSettingsContext.run({ values: Object.freeze(values), isCurrent }, async () => {
    const result = await operation();
    if (!isCurrent()) throw new Error("Settings changed during search");
    return result;
  });
}

export async function isMkvConversionEnabled(): Promise<boolean> {
  return (await getSetting("download.convertToMkv")) !== "false";
}

export function clearSettingsCache(): void {
  cacheEpoch++;
  settingsCache.clear();
  inFlight.clear();
}
