import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), worker: vi.fn() }));
vi.mock("./bounded-process", () => ({ readBoundedProcess: mocks.read }));
vi.mock("./download-manager", () => ({ getWorkerRuntimeState: mocks.worker }));

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ state: "ok", output: "sqlite schema ready\n" });
  mocks.worker.mockReturnValue({
    state: "idle",
    configuredConcurrency: 1,
    exclusiveOwnership: "unverified",
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

it("coalesces actual schema commands, caches briefly and rechecks after expiry", async () => {
  const { getSchemaReadiness } = await import("./runtime-readiness");
  expect(await Promise.all(Array.from({ length: 8 }, () => getSchemaReadiness()))).toEqual(
    Array.from({ length: 8 }, () => ({ ready: true, state: "compatible" }))
  );
  expect(mocks.read).toHaveBeenCalledTimes(1);
  expect(mocks.read.mock.calls[0][0]).toBe(process.execPath);
  expect(mocks.read.mock.calls[0][1][0]).toMatch(/scripts\/check-database-schema.mjs$/);
  vi.spyOn(Date, "now").mockReturnValue(Date.now() + 10_001);
  mocks.read.mockResolvedValue({ state: "timeout", output: "synthetic private connection" });
  expect(await getSchemaReadiness()).toEqual({ ready: false, state: "timeout" });
  expect(mocks.read).toHaveBeenCalledTimes(2);
});

it("cannot treat malformed success output as a compatible schema or claim exclusive job ownership", async () => {
  const { getSchemaReadiness, runtimeState } = await import("./runtime-readiness");
  mocks.read.mockResolvedValue({ state: "ok", output: "synthetic-private-path ready" });
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  const schema = await getSchemaReadiness();
  expect(schema).toEqual({ ready: false, state: "unavailable" });
  expect(runtimeState(schema)).toMatchObject({
    liveness: "alive",
    writesEnabled: false,
    worker: { exclusiveOwnership: "unverified" },
  });
  expect(JSON.stringify(schema)).not.toContain("private");
});

it("bounds a hung read without leaving a rejected late promise unhandled", async () => {
  const { boundedRuntimeRead } = await import("./runtime-readiness");
  vi.useFakeTimers();
  let reject!: (error: Error) => void;
  const operation = new Promise<string>((_, fail) => {
    reject = fail;
  });
  const assertion = expect(boundedRuntimeRead(operation, 20)).rejects.toThrow(
    "Runtime read unavailable"
  );
  await vi.advanceTimersByTimeAsync(21);
  await assertion;
  reject(new Error("private late error"));
  await Promise.resolve();
  expect(vi.getTimerCount()).toBe(0);
});
