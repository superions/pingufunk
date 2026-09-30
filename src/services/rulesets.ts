import { promises as fs } from "fs";
import path from "path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { fetchWithRetry } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { MatchingStrategy } from "@/types";
import { mediathekCache } from "@/lib/cache";
import type { Ruleset, TvdbData } from "@/types";
import {
  getGeneratedRulesets,
  generateRulesetForShow,
  getGeneratedRulesetByTvdbId,
} from "./ruleset-generator";

// In-memory storage for rulesets indexed by topic
let rulesetsByTopic: Map<string, Ruleset[]> = new Map();
let generatedRulesetsByTopic: Map<string, Ruleset[]> = new Map();
let lastFetchTime: number = 0;
const REFRESH_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const rulesetSchema = z.object({
  id: z.number().int(),
  mediaId: z.number().int(),
  topic: z.string().min(1),
  priority: z.number().int(),
  filters: z.string().refine((value) => {
    try {
      return Array.isArray(JSON.parse(value));
    } catch {
      return false;
    }
  }),
  titleRegexRules: z.string().refine((value) => {
    try {
      return Array.isArray(JSON.parse(value));
    } catch {
      return false;
    }
  }),
  episodeRegex: z.string().nullable(),
  seasonRegex: z.string().nullable(),
  matchingStrategy: z.enum(MatchingStrategy),
  media: z.object({
    media_id: z.number().int(),
    media_name: z.string(),
    media_type: z.string(),
    media_tvdbId: z.number().int().positive().nullable(),
    media_tmdbId: z.number().int().nullable(),
    media_imdbId: z.string().nullable(),
  }),
});
const catalogueSchema = z.array(rulesetSchema).max(10_000);

let activeSource: { kind: "bundled" | "configured"; sha256: string } | null = null;
/** Content fingerprint, never a potentially credential-bearing source URL. */
export function getRulesetSource(): typeof activeSource {
  return activeSource ? { ...activeSource } : null;
}

/** Bind response caches to external and generated rules, including refreshes. */
export function getRulesetContext(): string {
  return createHash("sha256")
    .update(JSON.stringify([activeSource, [...rulesetsByTopic], [...generatedRulesetsByTopic]]))
    .digest("hex");
}

async function fetchFromGitHub(): Promise<Ruleset[] | null> {
  try {
    const configured = process.env.RULESETS_URL;
    if (!configured) return null;
    const url = new URL(configured);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error("Invalid ruleset source");
    const deadlineAt = Date.now() + 15_000;
    const response = await fetchWithRetry(
      url.href,
      {
        headers: { "User-Agent": "RundfunkArr" },
      },
      { deadlineAt }
    );

    if (!response.ok) {
      void response.body?.cancel().catch(() => {});
      console.warn("[Rulesets] Configured source unavailable; using bundled rules");
      return null;
    }

    const rulesets = catalogueSchema.parse(
      await readBoundedProviderJson(response, deadlineAt, 8 * 1024 * 1024)
    );
    activeSource = {
      kind: "configured",
      sha256: createHash("sha256").update(JSON.stringify(rulesets)).digest("hex"),
    };
    return rulesets;
  } catch {
    console.warn("[Rulesets] Configured source unavailable; using bundled rules");
    return null;
  }
}

async function loadFromLocalFile(): Promise<Ruleset[]> {
  const rulesetsPath = path.join(process.cwd(), "data", "rulesets.json");
  const fileContent = await fs.readFile(rulesetsPath, "utf-8");
  const rulesets = catalogueSchema.parse(JSON.parse(fileContent));
  activeSource = {
    kind: "bundled",
    sha256: createHash("sha256").update(JSON.stringify(rulesets)).digest("hex"),
  };
  console.log(`[Rulesets] Loaded ${rulesets.length} rulesets from local file`);
  return rulesets;
}

function indexRulesets(allRulesets: Ruleset[]): void {
  // Clear and rebuild the topic map
  rulesetsByTopic = new Map();

  // Group rulesets by topic and sort by priority
  for (const ruleset of allRulesets) {
    const existing = rulesetsByTopic.get(ruleset.topic) || [];
    existing.push(ruleset);
    rulesetsByTopic.set(ruleset.topic, existing);
  }

  // Sort each topic's rulesets by priority
  for (const [topic, rulesets] of rulesetsByTopic) {
    rulesetsByTopic.set(
      topic,
      rulesets.sort((a, b) => a.priority - b.priority)
    );
  }

  console.log(
    `[Rulesets] Indexed ${allRulesets.length} rulesets for ${rulesetsByTopic.size} topics`
  );
}

let loading: Promise<void> | null = null;
export function loadRulesets(): Promise<void> {
  if (!loading)
    loading = loadRulesetSnapshot().finally(() => {
      loading = null;
    });
  return loading;
}

async function loadRulesetSnapshot(): Promise<void> {
  try {
    // Bundled rules are pinned to the image. Remote updates require explicit opt-in.
    const previousSource = activeSource?.sha256;
    let allRulesets = await fetchFromGitHub();

    if (!allRulesets) {
      console.log("[Rulesets] Falling back to local file");
      allRulesets = await loadFromLocalFile();
    }

    indexRulesets(allRulesets);

    // Also load generated rulesets from database
    await loadGeneratedRulesets();
    if (activeSource?.sha256 !== previousSource) mediathekCache.clear();

    lastFetchTime = Date.now();
  } catch {
    console.error("[Rulesets] Error loading rulesets");
  }
}

async function loadGeneratedRulesets(): Promise<void> {
  try {
    const generated = await getGeneratedRulesets();
    generatedRulesetsByTopic = new Map();

    for (const ruleset of generated) {
      const existing = generatedRulesetsByTopic.get(ruleset.topic) || [];
      existing.push(ruleset);
      generatedRulesetsByTopic.set(ruleset.topic, existing);
    }

    if (generated.length > 0) {
      console.log(
        `[Rulesets] Loaded ${generated.length} generated rulesets for ${generatedRulesetsByTopic.size} topics`
      );
    }
  } catch {
    console.warn("[Rulesets] Error loading generated rulesets");
  }
}

export async function refreshRulesetsIfNeeded(): Promise<void> {
  const now = Date.now();
  if (now - lastFetchTime > REFRESH_INTERVAL_MS) {
    console.log("[Rulesets] Refreshing rulesets (hourly update)");
    await loadRulesets();
  }
}

export function getRulesetsForTopic(topic: string): Ruleset[] {
  // Check generated rulesets first (higher priority for user-specific matches)
  const generated = generatedRulesetsByTopic.get(topic) || [];
  const external = rulesetsByTopic.get(topic) || [];

  // Generated rulesets take priority, then external
  return [...generated, ...external];
}

export function getRulesetsForTopicAndTvdbId(topic: string, tvdbId: number): Ruleset[] {
  const topicRulesets = getRulesetsForTopic(topic);
  const filtered = topicRulesets.filter((r) => r.media?.media_tvdbId === tvdbId);
  return filtered;
}

export function getAllTopics(): string[] {
  // Combine topics from both sources
  const externalTopics = Array.from(rulesetsByTopic.keys());
  const generatedTopics = Array.from(generatedRulesetsByTopic.keys());
  return [...new Set([...externalTopics, ...generatedTopics])];
}

/**
 * Check if we have a ruleset for a TVDB ID (from any source)
 */
export function hasRulesetForTvdbId(tvdbId: number): boolean {
  // Check generated rulesets
  for (const rulesets of generatedRulesetsByTopic.values()) {
    if (rulesets.some((r) => r.media?.media_tvdbId === tvdbId)) {
      return true;
    }
  }

  // Check external rulesets
  for (const rulesets of rulesetsByTopic.values()) {
    if (rulesets.some((r) => r.media?.media_tvdbId === tvdbId)) {
      return true;
    }
  }

  return false;
}

/**
 * Add a generated ruleset to the in-memory cache
 */
export function addGeneratedRuleset(ruleset: Ruleset): void {
  const existing = generatedRulesetsByTopic.get(ruleset.topic) || [];
  existing.push(ruleset);
  generatedRulesetsByTopic.set(ruleset.topic, existing);
  console.log(`[Rulesets] Added generated ruleset for topic "${ruleset.topic}"`);
}

/**
 * Get or generate a ruleset for a show
 * This is the main entry point for auto-generating rulesets
 */
export async function getOrGenerateRulesetForShow(
  tvdbId: number,
  showInfo: TvdbData
): Promise<Ruleset | null> {
  // First check if we already have a ruleset (external or generated)
  if (hasRulesetForTvdbId(tvdbId)) {
    console.log(`[Rulesets] Already have ruleset for TVDB ${tvdbId}`);
    return null; // Return null to indicate existing ruleset should be used
  }

  // Check if we have a generated ruleset in database
  const existingGenerated = await getGeneratedRulesetByTvdbId(tvdbId);
  if (existingGenerated) {
    // Add to cache if not already there
    addGeneratedRuleset(existingGenerated);
    return existingGenerated;
  }

  // Try to auto-generate a new ruleset
  console.log(`[Rulesets] No ruleset found for TVDB ${tvdbId}, attempting auto-generation...`);
  const generated = await generateRulesetForShow(tvdbId, showInfo);

  if (generated) {
    // Add to in-memory cache
    addGeneratedRuleset(generated);
    return generated;
  }

  return null;
}

export function isRulesetsLoaded(): boolean {
  return rulesetsByTopic.size > 0;
}

// Initialize rulesets on first import
let initPromise: Promise<void> | null = null;

export async function ensureRulesetsLoaded(): Promise<void> {
  if (isRulesetsLoaded()) {
    // Check for hourly refresh in background
    refreshRulesetsIfNeeded().catch(() => console.error("Failed to refresh rulesets"));
    return;
  }

  if (!initPromise) {
    initPromise = loadRulesets().finally(() => {
      initPromise = null;
    });
  }

  await initPromise;
}
