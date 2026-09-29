/** Bounded retries for provider HTTP requests; response bodies need their own limit. */
export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  deadlineAt?: number;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 30_000;

export class FetchBudgetError extends Error {
  constructor() {
    super("Provider request deadline exceeded");
  }
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function boundedInteger(value: number | undefined, fallback: number, upper: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(Math.trunc(value!), upper)) : fallback;
}

export function requestDeadline(options: RetryOptions = {}): number {
  const timeout = boundedInteger(
    options.timeoutMs,
    options.deadlineAt === undefined ? DEFAULT_TIMEOUT_MS : MAX_TIMEOUT_MS,
    MAX_TIMEOUT_MS
  );
  const callerDeadline = Number.isFinite(options.deadlineAt) ? options.deadlineAt! : Infinity;
  return Math.min(callerDeadline, Date.now() + timeout);
}

async function waitWithinBudget(
  ms: number,
  deadlineAt: number,
  signal?: AbortSignal
): Promise<void> {
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0 || signal?.aborted) throw new FetchBudgetError();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new FetchBudgetError());
    };
    const timer = setTimeout(
      () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      },
      Math.min(ms, remaining)
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
  if (Date.now() >= deadlineAt || signal?.aborted) throw new FetchBudgetError();
}

/** Retry transient headers responses only; never log URLs or provider error bodies. */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {}
): Promise<Response> {
  const maxRetries = boundedInteger(options.maxRetries, 2, 5);
  const baseDelayMs = boundedInteger(options.baseDelayMs, 250, 5_000);
  const maxDelayMs = boundedInteger(options.maxDelayMs, 2_000, 10_000);
  const deadlineAt = requestDeadline(options);

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const remaining = deadlineAt - Date.now();
    if (remaining <= 0 || init.signal?.aborted) throw new FetchBudgetError();
    const controller = new AbortController();
    const signal = init.signal
      ? AbortSignal.any([init.signal, controller.signal])
      : controller.signal;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new FetchBudgetError());
        }, remaining);
      });
      const response = await Promise.race([fetch(url, { ...init, signal }), timeout]);
      if (response.ok || !isRetryable(response.status) || attempt === maxRetries) {
        return response;
      }
      controller.abort();
      void response.body?.cancel().catch(() => {});
    } catch (error) {
      if (error instanceof FetchBudgetError || init.signal?.aborted || Date.now() >= deadlineAt) {
        throw new FetchBudgetError();
      }
      if (attempt === maxRetries) throw new Error("Provider request failed after retries");
    } finally {
      if (timer) clearTimeout(timer);
    }
    const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
    await waitWithinBudget(delay, deadlineAt, init.signal ?? undefined);
  }

  throw new Error("Provider request failed after retries");
}
