import { afterEach, expect, it, vi } from "vitest";
import { assertWritesEnabled, MaintenanceModeError, writesEnabled } from "./write-gate";

afterEach(() => vi.unstubAllEnvs());

it("requires an exact explicit write enablement", () => {
  for (const value of ["0", "true", "yes", ""]) {
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", value);
    expect(writesEnabled()).toBe(false);
    expect(() => assertWritesEnabled()).toThrow(MaintenanceModeError);
  }
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
  expect(writesEnabled()).toBe(true);
  expect(() => assertWritesEnabled()).not.toThrow();
});
