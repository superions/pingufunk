import { afterEach, expect, it, vi } from "vitest";

const { initCacheTTL, recoverInterruptedDownloads, startDownloadProcessing } = vi.hoisted(() => ({
  initCacheTTL: vi.fn().mockResolvedValue(undefined),
  recoverInterruptedDownloads: vi.fn().mockResolvedValue(0),
  startDownloadProcessing: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/cache", () => ({ initCacheTTL }));
vi.mock("@/server/download-manager", () => ({
  recoverInterruptedDownloads,
  startDownloadProcessing,
}));

import { register } from "./instrumentation";

afterEach(() => vi.unstubAllEnvs());

it("does not mutate download rows outside the booted single-worker runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("PINGUFUNK_BOOT_QUEUE", "0");
  await register();
  expect(recoverInterruptedDownloads).not.toHaveBeenCalled();
});

it("recovers interrupted rows once before draining queued work", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("PINGUFUNK_BOOT_QUEUE", "1");
  await register();
  await register();
  expect(recoverInterruptedDownloads).toHaveBeenCalledTimes(1);
  expect(startDownloadProcessing).toHaveBeenCalledTimes(1);
  expect(recoverInterruptedDownloads.mock.invocationCallOrder[0]).toBeLessThan(
    startDownloadProcessing.mock.invocationCallOrder[0]
  );
});
