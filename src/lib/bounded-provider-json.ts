export class ProviderResponseError extends Error {
  constructor() {
    super("Invalid provider response");
  }
}

// Absolute safety ceiling, not a default body allowance. Every caller still
// supplies its own smaller response limit; only explicit settings may raise it.
export const MAX_PROVIDER_RESPONSE_BYTES = 64 * 1024 * 1024;

/** Bound headers, streamed bytes and parsing with one absolute operation deadline. */
export async function readBoundedProviderBytes(
  response: Response,
  deadlineAt: number,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<Buffer> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  let abort: (() => void) | undefined;
  try {
    if (
      !Number.isFinite(deadlineAt) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > MAX_PROVIDER_RESPONSE_BYTES
    )
      throw new ProviderResponseError();
    reader = response.body?.getReader();
    signal?.throwIfAborted();
    const remaining = deadlineAt - Date.now();
    if (!reader || remaining <= 0) throw new ProviderResponseError();
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
      throw new ProviderResponseError();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderResponseError()), remaining);
    });
    const aborted = new Promise<never>((_, reject) => {
      abort = () => reject(new ProviderResponseError());
      signal?.addEventListener("abort", abort, { once: true });
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      if (Date.now() >= deadlineAt) throw new ProviderResponseError();
      signal?.throwIfAborted();
      const chunk = await Promise.race([reader.read(), deadline, aborted]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new ProviderResponseError();
      if (chunk.value.byteLength > 0) chunks.push(chunk.value);
      // Prevent tiny chunks from turning a bounded payload into unbounded
      // array/object overhead. This is a transport cap, not an API page size.
      if (chunks.length > 8_192) throw new ProviderResponseError();
    }
    const value = Buffer.concat(chunks);
    if (Date.now() >= deadlineAt) throw new ProviderResponseError();
    complete = true;
    return value;
  } catch {
    // JSON/UTF-8 diagnostics can contain payloads, URLs and credentials.
    throw new ProviderResponseError();
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    if (reader) {
      // A remote stream may never settle cancellation; do not extend the budget.
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}

export async function readBoundedProviderText(
  response: Response,
  deadlineAt: number,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<string> {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(
      await readBoundedProviderBytes(response, deadlineAt, maximumBytes, signal)
    );
    if (Date.now() >= deadlineAt) throw new ProviderResponseError();
    return value;
  } catch {
    throw new ProviderResponseError();
  }
}

export async function readBoundedProviderJson(
  response: Response,
  deadlineAt: number,
  maximumBytes: number,
  signal?: AbortSignal
): Promise<unknown> {
  try {
    const value: unknown = JSON.parse(
      await readBoundedProviderText(response, deadlineAt, maximumBytes, signal)
    );
    if (Date.now() >= deadlineAt) throw new ProviderResponseError();
    return value;
  } catch {
    throw new ProviderResponseError();
  }
}
