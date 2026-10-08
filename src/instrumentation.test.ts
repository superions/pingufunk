import { afterEach, expect, it, vi } from "vitest";

const {
  initCacheTTL,
  recoverInterruptedDownloads,
  startDownloadProcessing,
  installWorkerShutdownHandlers,
} = vi.hoisted(() => ({
  initCacheTTL: vi.fn().mockResolvedValue(undefined),
  recoverInterruptedDownloads: vi.fn().mockResolvedValue(0),
  startDownloadProcessing: vi.fn().mockResolvedValue(undefined),
  installWorkerShutdownHandlers: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ initCacheTTL }));
vi.mock("@/server/download-manager", () => ({
  recoverInterruptedDownloads,
  startDownloadProcessing,
  installWorkerShutdownHandlers,
}));

import { register } from "./instrumentation";

afterEach(() => vi.unstubAllEnvs());

it("does not mutate download rows outside the booted single-worker runtime", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("PINGUFUNK_BOOT_QUEUE", "0");
  await register();
  expect(recoverInterruptedDownloads).not.toHaveBeenCalled();
});

it("does not boot the queue when the legacy boot flag is set during maintenance", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("PINGUFUNK_BOOT_QUEUE", "1");
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  await register();
  expect(recoverInterruptedDownloads).not.toHaveBeenCalled();
  expect(startDownloadProcessing).not.toHaveBeenCalled();
});

it("boots the worker once and leaves recovery behind its exclusive acquisition", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("PINGUFUNK_BOOT_QUEUE", "1");
  await register();
  await register();
  expect(recoverInterruptedDownloads).not.toHaveBeenCalled();
  expect(startDownloadProcessing).toHaveBeenCalledTimes(1);
  expect(installWorkerShutdownHandlers.mock.invocationCallOrder[0]).toBeLessThan(
    startDownloadProcessing.mock.invocationCallOrder[0]
  );
});
