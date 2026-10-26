import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { isProbeableMp4, probeMp4MediaFacts, type Mp4MediaFacts } from "@/lib/mp4-audio-language";

import {
  youtubeSourceIdentitySchema,
  youtubeSourceReferenceSchema,
  type YoutubeSourceIdentity,
  type YoutubeSourceReference,
} from "@/lib/youtube-source";
import { resolveYoutubeMedia } from "@/providers/youtube/resolve";
import { youtubeMediaIdentity } from "@/providers/youtube/audio";
export type MediaFactsSource = string | YoutubeSourceIdentity;
function validSource(source: MediaFactsSource): boolean {
  return typeof source === "string"
    ? isProbeableMp4(source)
    : youtubeSourceIdentitySchema.strip().safeParse(source).success;
}
export interface CheckedFacts {
  sourceRef?: YoutubeSourceReference;
  renditions?: YoutubeSourceReference[];
  facts: Mp4MediaFacts;
  fingerprint?: string;
}
interface PendingSource {
  url: MediaFactsSource;
  expiresAt: number;
  refresh?: boolean;
}
export const mediaFactsKey = (source: MediaFactsSource) =>
  createHash("sha256")
    .update(
      typeof source === "string"
        ? source
        : JSON.stringify(youtubeSourceIdentitySchema.strip().parse(source))
    )
    .digest("hex");
const key = mediaFactsKey;

/**
 * Search-only hints bound to the exact public URL, including every selector.
 * A single bounded metadata worker advances cold season searches without any
 * database writes or full media transfers. Approval/transfer owners bypass it.
 */
export class SourceMediaFactsStore {
  private facts = new LRUCache<string, CheckedFacts & { expiresAt: number }>({ max: 512 });
  private cooldown = new LRUCache<string, number>({ max: 512 });
  private pending = new Map<string, PendingSource>();
  private epoch = 0;
  private revision = 0;
  private worker?: Promise<void>;
  private active?: { key: string; controller: AbortController; source: MediaFactsSource };
  private pause?: { timer: ReturnType<typeof setTimeout>; resume: () => void };
  private startTimer?: ReturnType<typeof setTimeout>;
  private batch?: HttpRequestBudget;
  private youtubeCalls: number[] = [];
  private lastFamily: "youtube" | "mediathek" = "youtube";
  private retained = new Map<string, { url: MediaFactsSource; until: number; blocked: boolean }>();
  private retentionTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(url: MediaFactsSource, result?: CheckedFacts) => void>();

  get generation(): number {
    return this.epoch;
  }

  /** Warmed or expired evidence must invalidate previously neutral RSS pages. */
  get contextKey(): string {
    return `${this.epoch}:${this.revision}:${Math.floor(Date.now() / 30_000)}`;
  }

  get(url: MediaFactsSource, minimumFreshMs = 0): CheckedFacts | undefined {
    if (!validSource(url)) return undefined;
    if (this.retained.get(key(url))?.blocked) return undefined;
    const result = this.facts.get(key(url));
    if (!result) return undefined;
    if (result.expiresAt <= Date.now()) {
      this.facts.delete(key(url));
      return undefined;
    }
    if (result.expiresAt <= Date.now() + minimumFreshMs) return undefined;
    return structuredClone({
      facts: result.facts,
      fingerprint: result.fingerprint,
      ...(result.sourceRef ? { sourceRef: result.sourceRef } : {}),
      ...(result.renditions ? { renditions: result.renditions } : {}),
    });
  }

  remember(url: MediaFactsSource, result: CheckedFacts, generation = this.epoch): void {
    if (generation !== this.epoch || !validSource(url)) return;
    if (typeof url !== "string") {
      const source = youtubeSourceReferenceSchema.safeParse(result.sourceRef);
      if (
        !source.success ||
        key(source.data) !== key(url) ||
        result.fingerprint !== youtubeMediaIdentity(source.data) ||
        result.facts.audioLanguage !== source.data.selection.language ||
        result.facts.videoDimensions?.width !== source.data.selection.width ||
        result.facts.videoDimensions?.height !== source.data.selection.height
      )
        return;
      if (
        result.renditions &&
        (result.renditions.length > 5 ||
          result.renditions.some((value) => {
            const parsed = youtubeSourceReferenceSchema.safeParse(value);
            return (
              !parsed.success ||
              key(parsed.data) !== key(url) ||
              parsed.data.selection.audioFormat !== source.data.selection.audioFormat ||
              parsed.data.selection.audioTrack !== source.data.selection.audioTrack ||
              parsed.data.selection.language !== source.data.selection.language ||
              Math.abs(parsed.data.selection.duration - source.data.selection.duration) > 5
            );
          }))
      )
        return;
    }
    if (this.retained.get(key(url))?.blocked) return;
    // An unsupported/unproven asset has a short negative lifetime, never a
    // fabricated language or resolution. Transport failures are not facts.
    // Typed hints hold stable format facts for 15 minutes so a 97-item cold
    // catalogue fits the 12/minute budget; transfer URLs are never cached here.
    this.facts.set(key(url), {
      ...structuredClone(result),
      expiresAt:
        Date.now() +
        (result.sourceRef
          ? 900_000
          : result.fingerprint && (result.facts.audioLanguage || result.facts.videoDimensions)
            ? 300_000
            : 30_000),
    });
    this.revision++;
    const held = this.retained.get(key(url));
    if (held)
      held.blocked = !(
        result.fingerprint &&
        result.facts.audioLanguage &&
        result.facts.videoDimensions
      );
    for (const listener of this.listeners) listener(structuredClone(url), structuredClone(result));
  }

  /** Retain discovery or restore a durable quarantine, never extend proof TTL. */
  retain(urls: readonly MediaFactsSource[], until: number, blocked = false): void {
    const now = Date.now();
    for (const [id, held] of this.retained) if (held.until <= now) this.retained.delete(id);
    for (const url of urls) {
      if (!validSource(url) || until <= now) continue;
      const id = key(url);
      if (!this.retained.has(id) && this.retained.size >= 512) break;
      this.retained.set(id, {
        url: structuredClone(url),
        until: Math.min(until, now + 7_200_000),
        blocked: blocked || (this.retained.get(id)?.blocked ?? false),
      });
      const pending = this.pending.get(id);
      if (pending) {
        pending.expiresAt = this.retained.get(id)!.until;
        pending.refresh = true;
      }
      if (this.retained.get(id)?.blocked) {
        this.pending.delete(id);
        if (this.active?.key === id) this.active.controller.abort();
      }
    }
    this.maintainRetained();
  }

  onChecked(listener: (url: MediaFactsSource, result?: CheckedFacts) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Release only delivery-owned refresh work; keep ordinary short-lived hints. */
  release(urls: readonly MediaFactsSource[]): void {
    for (const url of urls) {
      const id = key(url);
      this.retained.delete(id);
      if (this.pending.get(id)?.refresh) this.pending.delete(id);
    }
    if (!this.retained.size && this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = undefined;
    }
  }

  private maintainRetained(): void {
    const now = Date.now();
    const refresh: MediaFactsSource[] = [];
    for (const [id, held] of this.retained) {
      if (held.until <= now) this.retained.delete(id);
      else if (
        !held.blocked &&
        !this.get(held.url, typeof held.url === "string" ? 90_000 : 120_000)
      )
        refresh.push(held.url);
    }
    this.enqueue(refresh, true);
    if (this.retained.size && !this.retentionTimer) {
      this.retentionTimer = setTimeout(() => {
        this.retentionTimer = undefined;
        this.maintainRetained();
      }, 30_000);
      this.retentionTimer.unref?.();
    }
  }

  isActive(url: MediaFactsSource): boolean {
    return this.active?.key === key(url);
  }

  enqueue(urls: readonly MediaFactsSource[], refresh = false): void {
    const previousSize = this.pending.size;
    const now = Date.now();
    for (const [id, source] of this.pending) if (source.expiresAt <= now) this.pending.delete(id);
    for (const url of urls) {
      if (!validSource(url)) continue;
      const id = key(url);
      if (
        (!refresh && this.get(url)) ||
        this.retained.get(id)?.blocked ||
        (this.cooldown.get(id) ?? 0) > now ||
        this.active?.key === id ||
        this.pending.has(id)
      )
        continue;
      if (this.pending.size >= 128) break;
      this.pending.set(id, {
        url: structuredClone(url),
        expiresAt:
          this.retained.get(id)?.until ?? now + (typeof url === "string" ? 300_000 : 900_000),
        refresh,
      });
    }
    if (this.pending.size > previousSize && this.pause) {
      clearTimeout(this.pause.timer);
      this.pause.resume();
      this.pause = undefined;
    }
    if (!this.pending.size || this.worker || this.startTimer) return;
    const epoch = this.epoch;
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      this.worker = this.run(epoch).finally(() => {
        this.worker = undefined;
        // Invalidation may have queued fresh work while the old probe aborted.
        if (this.pending.size) this.enqueue([]);
      });
    }, 25);
    this.startTimer.unref?.();
  }

  private async wait(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.pause = undefined;
        resolve();
      }, ms);
      timer.unref?.();
      this.pause = { timer, resume: resolve };
    });
  }

  private async run(epoch: number): Promise<void> {
    while (epoch === this.epoch && this.pending.size) {
      const now = Date.now();
      this.youtubeCalls = this.youtubeCalls.filter((at) => at + 60000 > now);
      if (!this.batch || now >= this.batch.deadlineAt) this.batch = new HttpRequestBudget(32);
      const available = [...this.pending.entries()].filter(([, source]) =>
        typeof source.url === "string"
          ? this.batch!.remainingAttempts >= 4
          : this.youtubeCalls.length < 12
      );
      const next =
        available.find(
          ([, source]) =>
            (typeof source.url === "string" ? "mediathek" : "youtube") !== this.lastFamily
        ) ?? available[0];
      if (!next) {
        const deadlines = [...this.pending.values()].map((source) =>
          typeof source.url === "string"
            ? this.batch!.deadlineAt
            : (this.youtubeCalls[0] ?? now) + 60000
        );
        await this.wait(Math.max(1, Math.min(...deadlines) - now));
        continue;
      }
      const [id, source] = next;
      this.pending.delete(id);
      if (source.expiresAt <= now || (!source.refresh && this.get(source.url))) continue;
      this.lastFamily = typeof source.url === "string" ? "mediathek" : "youtube";
      if (typeof source.url === "string")
        for (let window = 0; window < 4; window++) this.batch.takeAttempt();
      else this.youtubeCalls.push(now);
      const controller = new AbortController();
      this.active = { key: id, controller, source: source.url };
      try {
        let result: CheckedFacts;
        if (typeof source.url === "string") {
          let fingerprint: string | undefined;
          const facts = await probeMp4MediaFacts(
            source.url,
            new HttpRequestBudget(4),
            true,
            (value) => {
              fingerprint = value;
            },
            controller.signal
          );
          result = { facts, fingerprint };
        } else {
          const { assertCurrentYoutubeDiscovery } = await import("./youtube-bindings");
          await assertCurrentYoutubeDiscovery(source.url);
          controller.signal.throwIfAborted();
          const resolved = await resolveYoutubeMedia(source.url, controller.signal);
          const sourceRef: YoutubeSourceReference = {
            ...source.url,
            selection: resolved.selection,
          };
          result = {
            facts: {
              audioLanguage: resolved.selection.language,
              videoDimensions: {
                width: resolved.selection.width,
                height: resolved.selection.height,
              },
            },
            fingerprint: youtubeMediaIdentity(sourceRef),
            sourceRef,
            ...(resolved.selections
              ? {
                  renditions: resolved.selections.map((selection) => ({
                    ...(source.url as YoutubeSourceIdentity),
                    selection,
                  })),
                }
              : {}),
          };
        }
        controller.signal.throwIfAborted();
        if (epoch === this.epoch) this.remember(source.url, result);
      } catch {
        // No raw exception, URL or credential enters logs or a cached proof.
        // An unavailable source is not retried automatically by this worker.
        if (epoch === this.epoch) {
          this.cooldown.set(id, Date.now() + 30_000);
          const held = this.retained.get(id);
          if (held) held.blocked = true;
          for (const listener of this.listeners) listener(structuredClone(source.url));
        }
      } finally {
        this.active = undefined;
      }
    }
  }

  /** Source-policy edits stop unaccepted discovery only, preserving Mediathek work and accepted jobs. */
  invalidateYoutube(): void {
    this.revision++;
    for (const [id, value] of this.facts) if (value.sourceRef) this.facts.delete(id);
    for (const [id, value] of this.pending)
      if (typeof value.url !== "string") this.pending.delete(id);
    for (const [id, value] of this.retained)
      if (typeof value.url !== "string") this.retained.delete(id);
    if (this.active && typeof this.active.source !== "string") this.active.controller.abort();
    if (!this.retained.size && this.retentionTimer) {
      clearTimeout(this.retentionTimer);
      this.retentionTimer = undefined;
    }
    if (!this.pending.size && this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = undefined;
    }
    if (this.pause) {
      clearTimeout(this.pause.timer);
      this.pause.resume();
      this.pause = undefined;
    }
  }

  /** Invalidate late responses and release this owner's timers/probe only. */
  clear(): void {
    this.epoch++;
    this.facts.clear();
    this.cooldown.clear();
    this.pending.clear();
    this.retained.clear();
    if (this.retentionTimer) clearTimeout(this.retentionTimer);
    this.retentionTimer = undefined;
    this.active?.controller.abort();
    if (this.startTimer) clearTimeout(this.startTimer);
    this.startTimer = undefined;
    if (this.pause) {
      clearTimeout(this.pause.timer);
      this.pause.resume();
      this.pause = undefined;
    }
  }

  async idle(): Promise<void> {
    if (this.startTimer) await new Promise<void>((resolve) => setTimeout(resolve, 30));
    await this.worker;
  }
}

// Next route bundles must share one worker/cache in the same server process.
const registry = globalThis as typeof globalThis & {
  [key: symbol]: SourceMediaFactsStore | undefined;
};
const owner = Symbol.for("pingufunk.source-media-facts.v1");
export const sourceMediaFacts = (registry[owner] ??= new SourceMediaFactsStore());
