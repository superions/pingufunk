import { afterEach, expect, it, vi } from "vitest";
import { FetchBudgetError, fetchWithRetry, HttpRequestBudget } from "./fetch-retry";

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

it("shares attempts across status, metadata and retries rather than resetting per call", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(new Response("ok"))
    .mockResolvedValueOnce(new Response("busy", { status: 429 }))
    .mockResolvedValueOnce(new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  const requestBudget = new HttpRequestBudget(3);
  const options = { requestBudget, baseDelayMs: 1 };
  await fetchWithRetry("https://example.org/status", {}, options);
  await fetchWithRetry("https://example.org/episodes", {}, options);
  expect(requestBudget.remainingAttempts).toBe(0);
  await expect(fetchWithRetry("https://example.org/another", {}, options)).rejects.toBeInstanceOf(
    FetchBudgetError
  );
  expect(fetch).toHaveBeenCalledTimes(3);
});

it("stops retrying immediately on exhausted shared attempts", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("busy", { status: 503 }));
  vi.stubGlobal("fetch", fetch);
  await expect(
    fetchWithRetry(
      "https://example.org/episodes",
      {},
      {
        requestBudget: new HttpRequestBudget(1),
        baseDelayMs: 1,
      }
    )
  ).rejects.toBeInstanceOf(FetchBudgetError);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cannot renew an expired operation deadline with a new request timeout", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  const requestBudget = new HttpRequestBudget(2, 20);
  await new Promise((resolve) => setTimeout(resolve, 30));
  await expect(
    fetchWithRetry(
      "https://example.org/episodes",
      {},
      {
        requestBudget,
        timeoutMs: 30_000,
      }
    )
  ).rejects.toBeInstanceOf(FetchBudgetError);
  expect(fetch).not.toHaveBeenCalled();
  expect(requestBudget.remainingAttempts).toBe(2);
});

it.each([
  [0, 10],
  [33, 10],
  [1, 0],
  [1, 15_001],
  [NaN, 10],
])("rejects invalid operation caps %s/%s", (attempts, timeout) => {
  expect(() => new HttpRequestBudget(attempts, timeout)).toThrow(FetchBudgetError);
});

it("keeps the default/RSS cap at ten and permits only the explicit 32-attempt foreground cap", () => {
  expect(new HttpRequestBudget().remainingAttempts).toBe(10);
  const foreground = new HttpRequestBudget(32);
  for (let i = 0; i < 32; i++) foreground.takeAttempt();
  expect(() => foreground.takeAttempt()).toThrow(FetchBudgetError);
});
