import { prisma } from "@/lib/db";
import { credentialOverride } from "@/lib/credential-settings";

interface SettingEntry {
  value: string | null;
  expiry: number;
}

const settingsCache = new Map<string, SettingEntry>();
const inFlight = new Map<string, Promise<string | null>>();
const MAX_SETTINGS_CACHE = 256;
const POSITIVE_TTL_MS = 60_000;
const NEGATIVE_TTL_MS = 5_000;
const DEFAULT_MIN_DURATION_SECONDS = 300;
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
  const setting = await getSetting("matching.minDuration");
  if (setting) {
    const parsed = parseInt(setting, 10);
    if (!isNaN(parsed) && parsed >= 0) return parsed;
  }
  return DEFAULT_MIN_DURATION_SECONDS;
}

export async function isMkvConversionEnabled(): Promise<boolean> {
  return (await getSetting("download.convertToMkv")) !== "false";
}

export function clearSettingsCache(): void {
  cacheEpoch++;
  settingsCache.clear();
  inFlight.clear();
}
