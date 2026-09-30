export class ProviderResponseError extends Error {
  constructor() {
    super("Invalid provider response");
  }
}

/** Bound headers, streamed bytes and parsing with one absolute operation deadline. */
export async function readBoundedProviderJson(
  response: Response,
  deadlineAt: number,
  maximumBytes: number
): Promise<unknown> {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let complete = false;
  try {
    if (
      !Number.isFinite(deadlineAt) ||
      !Number.isSafeInteger(maximumBytes) ||
      maximumBytes < 1 ||
      maximumBytes > 8 * 1024 * 1024
    )
      throw new ProviderResponseError();
    reader = response.body?.getReader();
    const remaining = deadlineAt - Date.now();
    if (!reader || remaining <= 0) throw new ProviderResponseError();
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximumBytes))
      throw new ProviderResponseError();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderResponseError()), remaining);
    });
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    while (true) {
      if (Date.now() >= deadlineAt) throw new ProviderResponseError();
      const chunk = await Promise.race([reader.read(), deadline]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maximumBytes) throw new ProviderResponseError();
      if (chunk.value.byteLength > 0) chunks.push(chunk.value);
      // Prevent tiny chunks from turning a bounded payload into unbounded
      // array/object overhead. This is a transport cap, not an API page size.
      if (chunks.length > 8_192) throw new ProviderResponseError();
    }
    const value: unknown = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
    );
    if (Date.now() >= deadlineAt) throw new ProviderResponseError();
    complete = true;
    return value;
  } catch {
    // JSON/UTF-8 diagnostics can contain payloads, URLs and credentials.
    throw new ProviderResponseError();
  } finally {
    if (timer) clearTimeout(timer);
    if (reader) {
      // A remote stream may never settle cancellation; do not extend the budget.
      if (!complete) void reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
