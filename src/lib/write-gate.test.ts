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

it("allows default SQLite operation while PostgreSQL requires write release", () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", undefined);
  vi.stubEnv("DATABASE_PROVIDER", undefined);
  vi.stubEnv("DATABASE_URL", undefined);
  vi.stubEnv("DATABASE_URL_FILE", undefined);
  expect(writesEnabled()).toBe(true);
  vi.stubEnv("DATABASE_URL", "postgresql://synthetic@127.0.0.1:5432/disposable");
  expect(writesEnabled()).toBe(false);
  vi.stubEnv("DATABASE_URL", "");
  expect(writesEnabled()).toBe(false);
  vi.stubEnv("DATABASE_PROVIDER", "postgresql");
  expect(writesEnabled()).toBe(false);
});
