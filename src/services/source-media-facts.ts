import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { isProbeableMp4, probeMp4MediaFacts, type Mp4MediaFacts } from "@/lib/mp4-audio-language";

interface CheckedFacts {
  facts: Mp4MediaFacts;
  fingerprint?: string;
}
interface PendingSource {
  url: string;
  expiresAt: number;
  refresh?: boolean;
}
const key = (url: string) => createHash("sha256").update(url).digest("hex");

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
  private active?: { key: string; controller: AbortController };
  private pause?: { timer: ReturnType<typeof setTimeout>; resume: () => void };
  private startTimer?: ReturnType<typeof setTimeout>;
  private batch?: HttpRequestBudget;
  private retained = new Map<string, { url: string; until: number; blocked: boolean }>();
  private retentionTimer?: ReturnType<typeof setTimeout>;
  private listeners = new Set<(url: string, result?: CheckedFacts) => void>();

  get generation(): number {
    return this.epoch;
  }

  /** Warmed or expired evidence must invalidate previously neutral RSS pages. */
  get contextKey(): string {
    return `${this.epoch}:${this.revision}:${Math.floor(Date.now() / 30_000)}`;
  }

  get(url: string, minimumFreshMs = 0): CheckedFacts | undefined {
    if (!isProbeableMp4(url)) return undefined;
    const result = this.facts.get(key(url));
    if (!result) return undefined;
    if (result.expiresAt <= Date.now()) {
      this.facts.delete(key(url));
      return undefined;
    }
    if (result.expiresAt <= Date.now() + minimumFreshMs) return undefined;
    return structuredClone({ facts: result.facts, fingerprint: result.fingerprint });
  }

  remember(url: string, result: CheckedFacts, generation = this.epoch): void {
    if (generation !== this.epoch || !isProbeableMp4(url)) return;
    if (this.retained.get(key(url))?.blocked) return;
    // An unsupported/unproven asset has a short negative lifetime, never a
    // fabricated language or resolution. Transport failures are not facts.
    this.facts.set(key(url), {
      ...structuredClone(result),
      expiresAt:
        Date.now() +
        (result.fingerprint && (result.facts.audioLanguage || result.facts.videoDimensions)
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
    for (const listener of this.listeners) listener(url, structuredClone(result));
  }

  /** Retain discovery or restore a durable quarantine, never extend proof TTL. */
  retain(urls: readonly string[], until: number, blocked = false): void {
    const now = Date.now();
    for (const [id, held] of this.retained) if (held.until <= now) this.retained.delete(id);
    for (const url of urls) {
      if (!isProbeableMp4(url) || until <= now) continue;
      const id = key(url);
      if (!this.retained.has(id) && this.retained.size >= 512) break;
      this.retained.set(id, {
        url,
        until: Math.min(until, now + 7_200_000),
        blocked: blocked || (this.retained.get(id)?.blocked ?? false),
      });
      if (this.retained.get(id)?.blocked) {
        this.pending.delete(id);
        if (this.active?.key === id) this.active.controller.abort();
      }
    }
    this.maintainRetained();
  }

  onChecked(listener: (url: string, result?: CheckedFacts) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Release only delivery-owned refresh work; keep ordinary short-lived hints. */
  release(urls: readonly string[]): void {
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
    const refresh: string[] = [];
    for (const [id, held] of this.retained) {
      if (held.until <= now) this.retained.delete(id);
      else if (!held.blocked && !this.get(held.url, 90_000)) refresh.push(held.url);
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

  isActive(url: string): boolean {
    return this.active?.key === key(url);
  }

  enqueue(urls: readonly string[], refresh = false): void {
    const now = Date.now();
    for (const [id, source] of this.pending) if (source.expiresAt <= now) this.pending.delete(id);
    for (const url of urls) {
      if (!isProbeableMp4(url)) continue;
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
      this.pending.set(id, { url, expiresAt: now + 300_000, refresh });
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
      // Reserve all four possible windows before starting one atomic source.
      // The rate window must not become that source's almost-expired deadline:
      // a healthy response at the batch boundary is not a failed asset.
      if (!this.batch || this.batch.remainingAttempts < 4 || Date.now() >= this.batch.deadlineAt) {
        if (this.batch && Date.now() < this.batch.deadlineAt)
          await this.wait(this.batch.deadlineAt - Date.now());
        if (epoch !== this.epoch) break;
        this.batch = new HttpRequestBudget(32);
      }
      for (let window = 0; window < 4; window++) this.batch.takeAttempt();
      const next = this.pending.entries().next().value;
      if (!next) break;
      const [id, source] = next;
      this.pending.delete(id);
      if (source.expiresAt <= Date.now() || (!source.refresh && this.get(source.url))) continue;
      const controller = new AbortController();
      this.active = { key: id, controller };
      try {
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
        if (epoch === this.epoch) this.remember(source.url, { facts, fingerprint });
      } catch {
        // No raw exception, URL or credential enters logs or a cached proof.
        // An unavailable source is not retried automatically by this worker.
        if (epoch === this.epoch) {
          this.cooldown.set(id, Date.now() + 30_000);
          const held = this.retained.get(id);
          if (held) held.blocked = true;
          for (const listener of this.listeners) listener(source.url);
        }
      } finally {
        this.active = undefined;
      }
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
