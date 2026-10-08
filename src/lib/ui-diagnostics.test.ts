import { afterEach, expect, it, vi } from "vitest";
import { rememberUiDiagnosis, readUiDiagnosis } from "./ui-diagnostics";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("retains one redacted tab-local report only until expiry and clears an uncertain next attempt", () => {
  const store = new Map<string, string>();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
  });
  vi.useFakeTimers();
  const report = {
    version: 1,
    correlationId: "10000000-0000-4000-8000-000000000003",
    state: "recorded",
    events: [{ stage: "language", reason: "language_unknown", evidence: "missing", count: 1 }],
    overflow: false,
  };
  rememberUiDiagnosis({ ...report, query: "private", url: "private" });
  expect(readUiDiagnosis()).toEqual(report);
  expect([...store.values()].join()).not.toContain("private");
  vi.advanceTimersByTime(300001);
  expect(readUiDiagnosis()).toBeNull();
  rememberUiDiagnosis(report);
  rememberUiDiagnosis(null);
  expect(readUiDiagnosis()).toBeNull();
});
