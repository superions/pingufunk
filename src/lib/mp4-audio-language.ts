import { readBoundedProviderBytes } from "./bounded-provider-json";
import { fetchWithRetry, type HttpRequestBudget } from "./fetch-retry";

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

/** At most two 1-MiB ranges; never download/scan mdat or invoke network ffprobe. */
export async function probeMp4AudioLanguage(
  url: string,
  budget: HttpRequestBudget
): Promise<string | null> {
  if (!isProbeableMp4(url)) return null;
  let start = 0;
  let total: number | undefined;
  for (let request = 0; request < 2; request++) {
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
      return null;
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
      return null;
    }
    total = length;
    const data = await readBoundedProviderBytes(response, budget.deadlineAt, MAX_BYTES);
    if (data.length !== end - from + 1) return null;
    let offset = 0;
    while (offset < data.length) {
      const current = box(data, offset);
      if (!current || current.size > total - start - offset) return null;
      if (current.type === "moov") {
        return current.size <= data.length - offset
          ? readMp4AudioLanguage(data.subarray(offset + current.header, offset + current.size))
          : null;
      }
      if (current.size > data.length - offset) {
        // Seek using a real top-level size, never a magic-string scan in media bytes.
        if (current.type !== "mdat") return null;
        start += offset + current.size;
        break;
      }
      offset += current.size;
    }
    if (offset === data.length) start += offset;
    if (start >= total) return null;
  }
  return null;
}
