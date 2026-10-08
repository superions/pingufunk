import { readBoundedProviderBytes } from "./bounded-provider-json";
import { FetchBudgetError, fetchWithRetry, type HttpRequestBudget } from "./fetch-retry";
import { recordDecision } from "@/server/decision-diagnostics";
import { createHash } from "node:crypto";
import { LRUCache } from "lru-cache";
import { getSearchTTL } from "./cache";

const MAX_BYTES = 1024 * 1024;
const hosts = new Set([
  "rodlzdf-a.akamaihd.net",
  "nrodlzdf-a.akamaihd.net",
  "ctv-videos.daserste.de",
]);

/** Only known public progressive CDNs; no arbitrary URL, redirect or credentials. */
export function isProbeableMp4(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.port &&
      !url.username &&
      !url.password &&
      hosts.has(url.hostname) &&
      /\.mp4$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function box(data: Buffer, offset: number) {
  if (offset < 0 || offset + 8 > data.length) return null;
  let size = data.readUInt32BE(offset);
  let header = 8;
  if (size === 1) {
    if (offset + 16 > data.length) return null;
    const extended = data.readBigUInt64BE(offset + 8);
    if (extended > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(extended);
    header = 16;
  }
  if (size < header) return null;
  return { size, header, type: data.toString("ascii", offset + 4, offset + 8) };
}

function children(data: Buffer): Array<{ type: string; payload: Buffer }> {
  const result = [];
  for (let offset = 0; offset < data.length; ) {
    const current = box(data, offset);
    if (!current || current.size > data.length - offset || result.length >= 4096)
      throw new Error("Invalid MP4 metadata");
    result.push({
      type: current.type,
      payload: data.subarray(offset + current.header, offset + current.size),
    });
    offset += current.size;
  }
  return result;
}

/** ISO-BMFF mdhd packed language on sound tracks, not a title/channel inference. */
export function readMp4AudioLanguage(moov: Buffer): string | null {
  try {
    const languages: Array<string | null> = [];
    for (const track of children(moov).filter((b) => b.type === "trak")) {
      const media = children(track.payload).filter((b) => b.type === "mdia");
      if (media.length !== 1) return null;
      const fields = children(media[0].payload);
      const handlers = fields.filter((b) => b.type === "hdlr");
      if (handlers.length !== 1 || handlers[0].payload.length < 12) return null;
      if (handlers[0].payload.toString("ascii", 8, 12) !== "soun") continue;
      const headers = fields.filter((b) => b.type === "mdhd");
      if (headers.length !== 1) return null;
      const header = headers[0].payload;
      const offset = header[0] === 0 ? 20 : header[0] === 1 ? 32 : -1;
      if (offset < 0 || header.length < offset + 4) return null;
      const packed = header.readUInt16BE(offset);
      if (packed & 0x8000) return null;
      const letters = [10, 5, 0].map((shift) => (packed >> shift) & 31);
      if (letters.some((letter) => letter < 1 || letter > 26)) return null;
      const code = String.fromCharCode(...letters.map((letter) => letter + 96));
      const language = ["und", "mul", "zxx"].includes(code) ? null : new Intl.Locale(code).language;
      languages.push(language);
    }
    // Mixed or untagged tracks cannot prove one coherent rendition language.
    return languages.length && languages.every((code) => code && code === languages[0])
      ? languages[0]
      : null;
  } catch {
    return null;
  }
}

class UnsupportedMetadata extends Error {}
class AssetVersionChanged extends Error {}

export interface Mp4MediaFacts {
  audioLanguage: string | null;
  videoDimensions: { width: number; height: number } | null;
}
const unknownFacts = (): Mp4MediaFacts => {
  recordDecision("language", "language_unknown", "missing");
  recordDecision("rendition", "rendition_unverified", "missing");
  return { audioLanguage: null, videoDimensions: null };
};

/** Server-owned fingerprint includes provider/credentials, instance and parser generation. */
export interface Mp4ProofContext {
  fingerprint: string;
  isCurrent: () => boolean;
}
interface AssetProof {
  facts: Mp4MediaFacts;
  validator: string;
  total: number;
  expiresAt: number;
}
interface ProbeFlight {
  promise: Promise<Mp4MediaFacts>;
  attempts: number;
  budget: HttpRequestBudget;
  charged: WeakSet<HttpRequestBudget>;
}
const proofs = new LRUCache<string, AssetProof>({ max: 256 });
const flights = new Map<string, ProbeFlight>();
const PARSER_VERSION = "mp4-tracks-v2";

function strongEtag(value: string | null): string | null {
  // Last-Modified alone is not a strong validator: shared CDN clock provenance
  // is unavailable. Do not combine ranges on a weak tag or a guessed date.
  return value !== null && value.length <= 256 && /^"[\x21\x23-\x7e]*"$/.test(value) ? value : null;
}

/** Coalesced consumers keep their own deadline and pay the actual range count. */
async function consumeFlight(
  flight: ProbeFlight,
  budget: HttpRequestBudget
): Promise<Mp4MediaFacts> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    budget.assertAvailable();
    const facts = await Promise.race([
      flight.promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new FetchBudgetError()),
          Math.max(0, budget.deadlineAt - Date.now())
        );
      }),
    ]);
    if (Date.now() >= budget.deadlineAt) throw new FetchBudgetError();
    return structuredClone(facts);
  } finally {
    if (timer) clearTimeout(timer);
    if (!flight.charged.has(budget)) {
      for (let attempt = 0; attempt < flight.attempts; attempt++) budget.takeAttempt();
      flight.charged.add(budget);
    }
  }
}

export async function probeMp4MediaFacts(
  url: string,
  budget: HttpRequestBudget,
  includeDimensions = true,
  context?: Mp4ProofContext
): Promise<Mp4MediaFacts> {
  if (!isProbeableMp4(url) || context?.isCurrent() === false) return unknownFacts();
  if (!context) return readMp4MediaFacts(url, budget, includeDimensions);
  const key = createHash("sha256")
    .update(JSON.stringify([PARSER_VERSION, context.fingerprint, url, includeDimensions]))
    .digest("hex");
  const pending = flights.get(key);
  if (pending) {
    const facts = await consumeFlight(pending, budget);
    return context.isCurrent() ? facts : unknownFacts();
  }
  if (flights.size >= 128) return unknownFacts();
  const flight: ProbeFlight = {
    promise: Promise.resolve({ audioLanguage: null, videoDimensions: null }),
    attempts: 0,
    budget,
    charged: new WeakSet([budget]),
  };
  flight.promise = readMp4MediaFacts(url, budget, includeDimensions, key, context, () => {
    flight.attempts++;
  }).finally(() => {
    if (flights.get(key) === flight) flights.delete(key);
  });
  flights.set(key, flight);
  return flight.promise;
}

/**
 * Four 1-MiB windows, seeking only by bounded, declared ISO-BMFF box sizes.
 * Sample tables can make moov/trak many MiB long: they are not language evidence
 * and need not be fetched. Every track header still has to be inspected, so a
 * fifth required window or an incomplete/conflicting track stays unknown.
 */
async function readMp4MediaFacts(
  url: string,
  budget: HttpRequestBudget,
  includeDimensions = true,
  key?: string,
  context?: Mp4ProofContext,
  onAttempt?: () => void
): Promise<Mp4MediaFacts> {
  if (!isProbeableMp4(url)) return unknownFacts();
  let total: number | undefined;
  let validator: string | null = null;
  const windows: Array<{ start: number; data: Buffer }> = [];
  let requests = 0;
  let boxes = 0;
  async function read(start: number, size: number): Promise<Buffer> {
    if (Date.now() >= budget.deadlineAt) throw new FetchBudgetError();
    if (!Number.isSafeInteger(start) || start < 0 || size < 1 || size > MAX_BYTES)
      throw new UnsupportedMetadata();
    const cached = windows.find(
      (window) => start >= window.start && start + size <= window.start + window.data.length
    );
    if (cached) return cached.data.subarray(start - cached.start, start - cached.start + size);
    if (
      requests >= 4 ||
      budget.remainingAttempts === 0 ||
      (total !== undefined && start + size > total)
    )
      throw new UnsupportedMetadata();
    if (requests > 0 && !validator) throw new AssetVersionChanged();
    requests++;
    onAttempt?.();
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          Range: `bytes=${start}-${start + MAX_BYTES - 1}`,
          "Accept-Encoding": "identity",
          ...(requests > 1 && validator ? { "If-Range": validator } : {}),
        },
      },
      { requestBudget: budget, maxRetries: 0 }
    );
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    const encoding = response.headers.get("content-encoding");
    const currentValidator = strongEtag(response.headers.get("etag"));
    if (
      response.status !== 206 ||
      !range ||
      (encoding && encoding !== "identity") ||
      (requests > 1 && (!validator || currentValidator !== validator))
    ) {
      void response.body?.cancel().catch(() => {});
      throw new AssetVersionChanged();
    }
    const [from, end, length] = range.slice(1).map(Number);
    if (
      ![from, end, length].every(Number.isSafeInteger) ||
      from !== start ||
      end < from ||
      end >= length ||
      end - from + 1 > MAX_BYTES ||
      (total !== undefined && length !== total)
    ) {
      void response.body?.cancel().catch(() => {});
      throw new AssetVersionChanged();
    }
    total = length;
    if (requests === 1) validator = currentValidator;
    const data = await readBoundedProviderBytes(response, budget.deadlineAt, MAX_BYTES);
    if (data.length !== end - from + 1 || data.length < size) throw new UnsupportedMetadata();
    windows.push({ start, data });
    return data.subarray(0, size);
  }

  async function headerAt(start: number, parentEnd: number) {
    if (++boxes > 4096 || parentEnd - start < 8) throw new UnsupportedMetadata();
    const data = await read(start, 8);
    let size = data.readUInt32BE(0);
    let header = 8;
    if (size === 1) {
      if (parentEnd - start < 16) throw new UnsupportedMetadata();
      const extended = (await read(start + 8, 8)).readBigUInt64BE(0);
      if (extended > BigInt(Number.MAX_SAFE_INTEGER)) throw new UnsupportedMetadata();
      size = Number(extended);
      header = 16;
    }
    if (size < header || size > parentEnd - start) throw new UnsupportedMetadata();
    return { type: data.toString("ascii", 4, 8), start: start + header, end: start + size };
  }

  async function fields(start: number, end: number) {
    const result = [];
    while (start < end) {
      const current = await headerAt(start, end);
      result.push(current);
      start = current.end;
    }
    return result;
  }

  async function videoDimensions(metadata: Awaited<ReturnType<typeof fields>>) {
    try {
      const minf = metadata.filter((b) => b.type === "minf");
      if (minf.length !== 1) return null;
      const stbl = (await fields(minf[0].start, minf[0].end)).filter((b) => b.type === "stbl");
      if (stbl.length !== 1) return null;
      const stsd = (await fields(stbl[0].start, stbl[0].end)).filter((b) => b.type === "stsd");
      if (stsd.length !== 1 || stsd[0].end - stsd[0].start < 8) return null;
      const description = await read(stsd[0].start, 8);
      // FullBox v0, one VisualSampleEntry. Multiple/changing descriptions are unknown.
      if (description.readUInt32BE(0) !== 0 || description.readUInt32BE(4) !== 1) return null;
      const entry = await headerAt(stsd[0].start + 8, stsd[0].end);
      if (
        entry.end !== stsd[0].end ||
        !["avc1", "avc3", "hvc1", "hev1", "vp09", "av01", "mp4v"].includes(entry.type) ||
        entry.end - entry.start < 78
      )
        return null;
      const dimensions = await read(entry.start + 24, 4);
      const width = dimensions.readUInt16BE(0),
        height = dimensions.readUInt16BE(2);
      return width > 0 && height > 0 ? { width, height } : null;
    } catch (error) {
      if (!(error instanceof UnsupportedMetadata)) throw error;
      return null;
    }
  }

  try {
    await read(0, 8);
    if (key) {
      const cached = proofs.get(key);
      // Every temporal hit still validates a fresh bounded first range. A
      // rotated signed URL, missing/changed validator or expired context is a miss.
      if (
        cached &&
        validator &&
        cached.validator === validator &&
        cached.total === total &&
        Date.now() < cached.expiresAt &&
        context?.isCurrent() &&
        Date.now() < budget.deadlineAt
      )
        return structuredClone(cached.facts);
      proofs.delete(key);
    }
    for (let offset = 0; offset < total!; ) {
      const current = await headerAt(offset, total!);
      offset = current.end;
      if (current.type !== "moov") continue;
      const languages: Array<string | null> = [];
      const videos: Array<{ width: number; height: number } | null> = [];
      for (const track of (await fields(current.start, current.end)).filter(
        (b) => b.type === "trak"
      )) {
        const media = (await fields(track.start, track.end)).filter((b) => b.type === "mdia");
        if (media.length !== 1) return unknownFacts();
        const metadata = await fields(media[0].start, media[0].end);
        const handlers = metadata.filter((b) => b.type === "hdlr");
        if (handlers.length !== 1 || handlers[0].end - handlers[0].start < 12)
          return unknownFacts();
        const handler = (await read(handlers[0].start + 8, 4)).toString("ascii");
        if (handler === "vide") {
          if (includeDimensions) videos.push(await videoDimensions(metadata));
          continue;
        }
        if (handler !== "soun") continue;
        const headers = metadata.filter((b) => b.type === "mdhd");
        if (headers.length !== 1 || headers[0].end === headers[0].start) return unknownFacts();
        const version = (await read(headers[0].start, 1))[0];
        const languageOffset = version === 0 ? 20 : version === 1 ? 32 : -1;
        if (languageOffset < 0 || headers[0].end - headers[0].start < languageOffset + 4)
          return unknownFacts();
        const packed = (await read(headers[0].start + languageOffset, 2)).readUInt16BE(0);
        const letters = [10, 5, 0].map((shift) => (packed >> shift) & 31);
        if (packed & 0x8000 || letters.some((letter) => letter < 1 || letter > 26))
          return unknownFacts();
        const code = String.fromCharCode(...letters.map((letter) => letter + 96));
        let language: string | null = null;
        if (!["und", "mul", "zxx"].includes(code)) {
          try {
            language = new Intl.Locale(code).language;
          } catch {
            return unknownFacts();
          }
        }
        languages.push(language);
      }
      if (Date.now() >= budget.deadlineAt) throw new FetchBudgetError();
      const facts: Mp4MediaFacts = {
        audioLanguage:
          languages.length && languages.every((language) => language && language === languages[0])
            ? languages[0]
            : null,
        videoDimensions: videos.length === 1 ? videos[0] : null,
      };
      if (context?.isCurrent() === false) return unknownFacts();
      const ttl = Math.min(getSearchTTL(), 300) * 1000;
      if (key && validator && total && ttl > 0 && (facts.audioLanguage || facts.videoDimensions))
        proofs.set(key, {
          facts: structuredClone(facts),
          validator,
          total,
          expiresAt: Date.now() + ttl,
        });
      return facts;
    }
  } catch (error) {
    if (!(error instanceof UnsupportedMetadata) && !(error instanceof AssetVersionChanged))
      throw error;
    if (key) proofs.delete(key);
    recordDecision("media", "probe_unsupported", "missing");
  }
  return unknownFacts();
}

/** Audio-only callers retain their established budget, without optional dimension seeks. */
export async function probeMp4AudioLanguage(
  url: string,
  budget: HttpRequestBudget
): Promise<string | null> {
  return (await probeMp4MediaFacts(url, budget, false)).audioLanguage;
}
