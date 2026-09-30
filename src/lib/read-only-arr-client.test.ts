import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { arrApiUrl, fetchReadOnlyArr, createReadOnlyArrJsonClient } from "./read-only-arr-client";
import { HttpRequestBudget } from "./fetch-retry";

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("preserves a reverse-proxy base path and keeps the key out of the URL", async () => {
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-sonarr-key");
  const query = new URLSearchParams({ seriesId: "42" });
  fetchMock.mockResolvedValue(Response.json([]));
  await fetchReadOnlyArr(
    "http://sonarr.internal/sonarr/",
    "/api/v3/episode",
    "PINGUFUNK_SONARR_API_KEY",
    query
  );
  const [url, options] = fetchMock.mock.calls[0];
  expect(url).toBe("http://sonarr.internal/sonarr/api/v3/episode?seriesId=42");
  expect(url).not.toContain("synthetic-sonarr-key");
  expect(options.method).toBe("GET");
  expect(options.headers["X-Api-Key"]).toBe("synthetic-sonarr-key");
  expect(options.redirect).toBe("error");
});

it("rejects unsafe bases, credential queries, and missing secrets without fetching", async () => {
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-sonarr-key");
  expect(() => arrApiUrl("http://user:pass@host/sonarr", "api/v3/series")).toThrow();
  expect(() => arrApiUrl("http://host/sonarr?key=1", "api/v3/series")).toThrow();
  expect(() => arrApiUrl("http://host/sonarr", "../series")).toThrow();
  expect(() =>
    arrApiUrl("http://host/sonarr", "api/v3/series", new URLSearchParams({ apikey: "secret" }))
  ).toThrow();
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", undefined);
  await expect(
    fetchReadOnlyArr("http://host/sonarr", "api/v3/series", "PINGUFUNK_SONARR_API_KEY")
  ).rejects.toThrow("Credential configuration is invalid");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("fails closed on a redirect and never returns a provider error body", async () => {
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-sonarr-key");
  fetchMock.mockResolvedValue(new Response("secret-in-error-body", { status: 302 }));
  await expect(
    fetchReadOnlyArr("http://host/sonarr", "api/v3/series", "PINGUFUNK_SONARR_API_KEY", undefined, {
      maxRetries: 0,
    })
  ).rejects.toThrow("Metadata request failed");
});

it("uses one captured credential and deadline for successive JSON GETs", async () => {
  const client = createReadOnlyArrJsonClient(
    "https://example.org/sonarr",
    "fixture-before-rotation"
  );
  const requestBudget = new HttpRequestBudget(2);
  fetchMock.mockImplementation(async () => Response.json({ version: "4.0.17.2952" }));
  await client("api/v3/system/status", undefined, { requestBudget });
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "fixture-after-rotation");
  await client("api/v3/series", new URLSearchParams({ tvdbId: "345" }), { requestBudget });
  expect(requestBudget.remainingAttempts).toBe(0);
  for (const [url, options] of fetchMock.mock.calls) {
    expect(url).not.toContain("fixture-");
    expect(options.headers["X-Api-Key"]).toBe("fixture-before-rotation");
    expect(options.method).toBe("GET");
    expect(options.redirect).toBe("error");
  }
});

it("bounds a never-ending response body and cancels its owned reader", async () => {
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
  const client = createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key");
  const started = Date.now();
  await expect(
    client("api/v3/series", undefined, { requestBudget: new HttpRequestBudget(1, 25) })
  ).rejects.toThrow("Metadata request failed");
  expect(Date.now() - started).toBeLessThan(250);
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("does not grant the body a fresh deadline after slow response headers", async () => {
  vi.useFakeTimers();
  let bodyTimer: ReturnType<typeof setTimeout> | undefined;
  const cancel = vi.fn(() => clearTimeout(bodyTimer));
  fetchMock.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 25));
    return new Response(
      new ReadableStream({
        start(controller) {
          bodyTimer = setTimeout(() => {
            controller.enqueue(new TextEncoder().encode("[]"));
            controller.close();
          }, 35);
        },
        cancel,
      })
    );
  });
  try {
    const rejected = expect(
      createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key")(
        "api/v3/series",
        undefined,
        { requestBudget: new HttpRequestBudget(1, 50) }
      )
    ).rejects.toThrow("Metadata request failed");
    await vi.advanceTimersByTimeAsync(50);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
  } finally {
    clearTimeout(bodyTimer);
    vi.useRealTimers();
  }
});

it.each([false, true])(
  "rejects oversized JSON with declared length=%s without leaking its contents",
  async (declared) => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5 * 1024 * 1024 + 1));
      },
      cancel,
    });
    fetchMock.mockResolvedValue(
      new Response(body, {
        headers: declared ? { "content-length": String(5 * 1024 * 1024 + 1) } : {},
      })
    );
    const client = createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key");
    await expect(client("api/v3/series")).rejects.toThrow("Metadata request failed");
    expect(cancel).toHaveBeenCalledTimes(1);
  }
);

it.each(["secret-in-json-error", '{"private":"secret'])("redacts malformed JSON", async (body) => {
  fetchMock.mockResolvedValue(new Response(body));
  await expect(
    createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key")("api/v3/series")
  ).rejects.toThrow(/^Metadata request failed$/);
});

it("uses byte limits for non-ASCII JSON and handles streamed UTF-8 boundaries", async () => {
  const bytes = new TextEncoder().encode('{"title":"Übung"}');
  fetchMock.mockResolvedValue(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          controller.close();
        },
      })
    )
  );
  await expect(
    createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key")("api/v3/series")
  ).resolves.toEqual({ title: "Übung" });
});

it("does not turn invalid UTF-8 into silently replaced metadata", async () => {
  fetchMock.mockResolvedValue(new Response(new Uint8Array([0x22, 0xff, 0x22])));
  await expect(
    createReadOnlyArrJsonClient("https://example.org/sonarr", "fixture-key")("api/v3/series")
  ).rejects.toThrow(/^Metadata request failed$/);
});
