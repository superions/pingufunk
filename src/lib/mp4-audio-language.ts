import { readBoundedProviderBytes } from "./bounded-provider-json";
import { FetchBudgetError, fetchWithRetry, type HttpRequestBudget } from "./fetch-retry";

const MAX_BYTES = 1024 * 1024;
const hosts = new Set(["rodlzdf-a.akamaihd.net", "nrodlzdf-a.akamaihd.net"]);

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

/**
 * Two 1-MiB windows, seeking only by bounded, declared ISO-BMFF box sizes.
 * Sample tables can make moov/trak many MiB long: they are not language evidence
 * and need not be fetched. Every track header still has to be inspected, so a
 * third required window or an incomplete/conflicting track stays unknown.
 */
export async function probeMp4AudioLanguage(
  url: string,
  budget: HttpRequestBudget
): Promise<string | null> {
  if (!isProbeableMp4(url)) return null;
  let total: number | undefined;
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
    if (requests >= 2 || (total !== undefined && start + size > total))
      throw new UnsupportedMetadata();
    requests++;
    const response = await fetchWithRetry(
      url,
      {
        headers: {
          Range: `bytes=${start}-${start + MAX_BYTES - 1}`,
          "Accept-Encoding": "identity",
        },
      },
      { requestBudget: budget, maxRetries: 0 }
    );
    const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get("content-range") ?? "");
    const encoding = response.headers.get("content-encoding");
    if (response.status !== 206 || !range || (encoding && encoding !== "identity")) {
      void response.body?.cancel().catch(() => {});
      throw new UnsupportedMetadata();
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
      throw new UnsupportedMetadata();
    }
    total = length;
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

  try {
    await read(0, 8);
    for (let offset = 0; offset < total!; ) {
      const current = await headerAt(offset, total!);
      offset = current.end;
      if (current.type !== "moov") continue;
      const languages: Array<string | null> = [];
      for (const track of (await fields(current.start, current.end)).filter(
        (b) => b.type === "trak"
      )) {
        const media = (await fields(track.start, track.end)).filter((b) => b.type === "mdia");
        if (media.length !== 1) return null;
        const metadata = await fields(media[0].start, media[0].end);
        const handlers = metadata.filter((b) => b.type === "hdlr");
        if (handlers.length !== 1 || handlers[0].end - handlers[0].start < 12) return null;
        if ((await read(handlers[0].start + 8, 4)).toString("ascii") !== "soun") continue;
        const headers = metadata.filter((b) => b.type === "mdhd");
        if (headers.length !== 1 || headers[0].end === headers[0].start) return null;
        const version = (await read(headers[0].start, 1))[0];
        const languageOffset = version === 0 ? 20 : version === 1 ? 32 : -1;
        if (languageOffset < 0 || headers[0].end - headers[0].start < languageOffset + 4)
          return null;
        const packed = (await read(headers[0].start + languageOffset, 2)).readUInt16BE(0);
        const letters = [10, 5, 0].map((shift) => (packed >> shift) & 31);
        if (packed & 0x8000 || letters.some((letter) => letter < 1 || letter > 26)) return null;
        const code = String.fromCharCode(...letters.map((letter) => letter + 96));
        let language: string | null = null;
        if (!["und", "mul", "zxx"].includes(code)) {
          try {
            language = new Intl.Locale(code).language;
          } catch {
            return null;
          }
        }
        languages.push(language);
      }
      if (Date.now() >= budget.deadlineAt) throw new FetchBudgetError();
      return languages.length &&
        languages.every((language) => language && language === languages[0])
        ? languages[0]
        : null;
    }
  } catch (error) {
    if (!(error instanceof UnsupportedMetadata)) throw error;
  }
  return null;
}
