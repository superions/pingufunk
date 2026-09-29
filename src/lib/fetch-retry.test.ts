import { afterEach, expect, it, vi } from "vitest";
import { FetchBudgetError, fetchWithRetry } from "./fetch-retry";

afterEach(() => vi.unstubAllGlobals());

it.each([401, 403])("does not retry an HTTP %i response", async (status) => {
  const fetch = vi.fn().mockResolvedValue(new Response("denied", { status }));
  vi.stubGlobal("fetch", fetch);

  expect((await fetchWithRetry("https://example.org/private")).status).toBe(status);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("aborts retry waiting when the caller cancels", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("busy", { status: 429 }));
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 10);

  await expect(
    fetchWithRetry("https://example.org/query", { signal: controller.signal }, { baseDelayMs: 100 })
  ).rejects.toBeInstanceOf(FetchBudgetError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("bounds rate-limit and server-error attempts", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("retry", { status: 429 }))
    .mockResolvedValueOnce(new Response("retry", { status: 503 }))
    .mockResolvedValueOnce(new Response("ok", { status: 200 }));
  vi.stubGlobal("fetch", fetch);

  expect(
    (await fetchWithRetry("https://example.org/query", {}, { baseDelayMs: 1, maxDelayMs: 1 }))
      .status
  ).toBe(200);
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("ends a hung fetch within the shared deadline even if the mock ignores abort", async () => {
  const fetch = vi.fn(() => new Promise<Response>(() => {}));
  vi.stubGlobal("fetch", fetch);
  const started = Date.now();

  await expect(
    fetchWithRetry("https://example.org/query?token=private", {}, { timeoutMs: 25 })
  ).rejects.toBeInstanceOf(FetchBudgetError);
  expect(Date.now() - started).toBeLessThan(250);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("stops immediately when the caller has aborted", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const controller = new AbortController();
  controller.abort();

  await expect(
    fetchWithRetry("https://example.org/query", { signal: controller.signal })
  ).rejects.toBeInstanceOf(FetchBudgetError);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not leak a provider error containing a secret", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("token=private")));
  await expect(fetchWithRetry("https://example.org/query", {}, { maxRetries: 0 })).rejects.toThrow(
    "Provider request failed after retries"
  );
});
