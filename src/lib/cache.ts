import { LRUCache } from "lru-cache";
import { prisma } from "@/lib/db";
import { createHash } from "node:crypto";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CacheValue = Record<string, any>;

// Default TTL values (in seconds)
const DEFAULT_SEARCH_TTL = 3600; // 1 hour
const DEFAULT_METADATA_TTL = 86400; // 24 hours
const MAX_SEARCH_TTL = 86400;
const MAX_METADATA_TTL = 604800;

function boundedTTL(value: string | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? Math.min(parsed, maximum) : fallback;
}

// Cache for TTL settings (short TTL to pick up changes)
let cachedSearchTTL: number | null = null;
let cachedMetadataTTL: number | null = null;
let lastTTLFetch = 0;
const TTL_CACHE_DURATION = 60 * 1000; // 1 minute

async function fetchTTLSettings(): Promise<{ searchTTL: number; metadataTTL: number }> {
  const now = Date.now();
  if (
    cachedSearchTTL !== null &&
    cachedMetadataTTL !== null &&
    now - lastTTLFetch < TTL_CACHE_DURATION
  ) {
    return { searchTTL: cachedSearchTTL, metadataTTL: cachedMetadataTTL };
  }

  try {
    const configs = await prisma.config.findMany({
      where: { key: { in: ["cache.ttl.search", "cache.ttl.metadata"] } },
    });

    const configMap = new Map(configs.map((c) => [c.key, c.value]));

    const searchTTLStr = configMap.get("cache.ttl.search");
    const metadataTTLStr = configMap.get("cache.ttl.metadata");

    cachedSearchTTL = boundedTTL(searchTTLStr, DEFAULT_SEARCH_TTL, MAX_SEARCH_TTL);
    cachedMetadataTTL = boundedTTL(metadataTTLStr, DEFAULT_METADATA_TTL, MAX_METADATA_TTL);

    lastTTLFetch = now;
  } catch {
    // Fallback to defaults on error
    cachedSearchTTL = cachedSearchTTL ?? DEFAULT_SEARCH_TTL;
    cachedMetadataTTL = cachedMetadataTTL ?? DEFAULT_METADATA_TTL;
  }

  return { searchTTL: cachedSearchTTL, metadataTTL: cachedMetadataTTL };
}

// Synchronous TTL getters (use cached values)
export function getSearchTTL(): number {
  return cachedSearchTTL ?? DEFAULT_SEARCH_TTL;
}

export function getMetadataTTL(): number {
  return cachedMetadataTTL ?? DEFAULT_METADATA_TTL;
}

// Initialize TTL settings
export async function initCacheTTL(): Promise<void> {
  await fetchTTLSettings();
}

// Clear TTL cache (call when settings change)
export function clearTTLCache(): void {
  cachedSearchTTL = null;
  cachedMetadataTTL = null;
  lastTTLFetch = 0;
  mediathekCache.clear();
  clearMetadataCaches();
}

// Cache with custom TTL stored per entry
interface CacheEntry {
  value: CacheValue;
  expiresAt: number;
}

class DynamicTTLCache {
  private cache: LRUCache<string, CacheEntry>;
  private getTTL: () => number;

  constructor(max: number, getTTL: () => number) {
    this.cache = new LRUCache<string, CacheEntry>({ max });
    this.getTTL = getTTL;
  }

  get(key: string): CacheValue | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check if expired
    if (Date.now() >= entry.expiresAt) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: CacheValue): void {
    const ttlMs = this.getTTL() * 1000;
    if (ttlMs <= 0) {
      this.cache.delete(key);
      return;
    }
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}

// Cache for Mediathek API results (configurable TTL)
export const mediathekCache = new DynamicTTLCache(500, getSearchTTL);

// Cache for TVDB data (configurable TTL)
export const tvdbCache = new DynamicTTLCache(1000, getMetadataTTL);

// Only definitive provider misses belong here. Authentication/network failures
// remain retryable and never become an empty-success cache entry.
export const metadataMissCache = new LRUCache<string, { expiresAt: number }>({ max: 256 });

export function hasMetadataMiss(key: string): boolean {
  const entry = metadataMissCache.get(key);
  if (!entry) return false;
  if (Date.now() < entry.expiresAt) return true;
  metadataMissCache.delete(key);
  return false;
}

export function cacheMetadataMiss(key: string): void {
  const ttlMs = Math.min(getMetadataTTL() * 1000, 5 * 60 * 1000);
  if (ttlMs > 0) metadataMissCache.set(key, { expiresAt: Date.now() + ttlMs });
}

const metadataInFlight = new Map<string, Promise<unknown>>();
const MAX_METADATA_IN_FLIGHT = 128;
let cacheEpoch = 0;

export class MetadataConcurrencyError extends Error {
  constructor() {
    super("Metadata request capacity exceeded");
  }
}

export function cacheContextEpoch(): number {
  return cacheEpoch;
}

/** Cache keys bind the provider, logical identity, DB instance and credentials. */
export function metadataCacheKey(source: string, identity: unknown, context: unknown): string {
  return createHash("sha256")
    .update(
      JSON.stringify([cacheEpoch, source, identity, process.env.DATABASE_URL ?? null, context])
    )
    .digest("hex");
}

export function coalesceMetadata<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = metadataInFlight.get(key);
  if (pending) return pending as Promise<T>;
  if (metadataInFlight.size >= MAX_METADATA_IN_FLIGHT) {
    return Promise.reject(new MetadataConcurrencyError());
  }
  const promise = load().finally(() => {
    if (metadataInFlight.get(key) === promise) metadataInFlight.delete(key);
  });
  metadataInFlight.set(key, promise);
  return promise;
}

export function clearMetadataCaches(): void {
  cacheEpoch++;
  tvdbCache.clear();
  metadataMissCache.clear();
  // Keep old in-flight entries counted until they settle; their epoch-bound
  // keys can no longer be consumed after this invalidation.
}

// Cache for rulesets (1 hour TTL - not configurable)
export const rulesetsCache = new LRUCache<string, CacheValue>({
  max: 10,
  ttl: 60 * 60 * 1000, // 1 hour
});
