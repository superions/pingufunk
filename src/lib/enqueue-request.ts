export const MAX_NZB_BYTES = 256 * 1024;
export const ENQUEUE_KEY_HEADER = "X-Pingufunk-Enqueue-Key";
export const ENQUEUE_KEY_RETENTION_MS = 7 * 86400_000;

export class EnqueueRequestError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 408 | 413 = 400
  ) {
    super(message);
  }
}
export class EnqueueConflictError extends Error {
  constructor() {
    super("Enqueue key belongs to a different request");
  }
}

/** Keys assert a deliberate request identity, not authorization or URL similarity. */
export function parseEnqueueKey(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const match = /^([a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}):(\d{13})$/i.exec(value);
  if (!match) throw new EnqueueRequestError("Invalid enqueue key");
  const issued = Number(match[2]);
  if (issued > Date.now() + 60_000 || issued + ENQUEUE_KEY_RETENTION_MS <= Date.now())
    throw new EnqueueRequestError(
      "Enqueue key expired or clock invalid; check existing job before a new request"
    );
  return value.toLowerCase();
}

/** Bound untrusted body bytes before XML/regex parsing, including chunked bodies. */
export async function readNzbBody(request: Request): Promise<string> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || !Number.isSafeInteger(Number(length))))
    throw new EnqueueRequestError("Invalid body length");
  if (length !== null && Number(length) > MAX_NZB_BYTES)
    throw new EnqueueRequestError("NZB body too large", 413);
  const encoding = request.headers.get("content-encoding");
  if (encoding && encoding !== "identity")
    throw new EnqueueRequestError("Unsupported body encoding");
  if (!request.body) throw new EnqueueRequestError("Empty NZB body");
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new EnqueueRequestError("NZB body deadline exceeded", 408)),
      15_000
    );
  });
  let abort!: () => void;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(new EnqueueRequestError("NZB body aborted"));
  });
  request.signal.addEventListener("abort", abort, { once: true });
  let complete = false;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (let count = 0; ; count++) {
      if (request.signal.aborted) throw new EnqueueRequestError("NZB body aborted");
      const part = await Promise.race([reader.read(), timeout, aborted]);
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_NZB_BYTES || count >= 4096)
        throw new EnqueueRequestError("NZB body too large", 413);
      chunks.push(part.value);
    }
    if (!size) throw new EnqueueRequestError("Empty NZB body");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let content: string;
    try {
      content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new EnqueueRequestError("Invalid NZB encoding");
    }
    complete = true;
    return content;
  } finally {
    if (timer) clearTimeout(timer);
    request.signal.removeEventListener("abort", abort);
    // A broken stream's cancel promise must not extend the read deadline.
    if (!complete) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
