import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { arrApiUrl, fetchReadOnlyArr } from "./read-only-arr-client";

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
