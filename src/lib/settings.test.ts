import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique, findMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique, findMany },
  },
}));

import {
  clearSettingsCache,
  getMinDurationSeconds,
  getSetting,
  getSettings,
  isMkvConversionEnabled,
  withSettingsSnapshot,
} from "./settings";

beforeEach(() => {
  clearSettingsCache();
  findUnique.mockReset();
  findMany.mockReset();
});

afterEach(() => vi.useRealTimers());

describe("bounded setting lookups", () => {
  it("coalesces concurrent reads and briefly caches a missing key", async () => {
    findUnique.mockResolvedValue(null);
    expect(await Promise.all([getSetting("missing"), getSetting("missing")])).toEqual([null, null]);
    expect(await getSetting("missing")).toBeNull();
    expect(findUnique).toHaveBeenCalledTimes(1);
  });

  it("expires misses and evicts old keys at the capacity limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
    findUnique.mockResolvedValue(null);
    await getSetting("missing");
    vi.setSystemTime(new Date("2026-09-30T00:00:06Z"));
    await getSetting("missing");
    expect(findUnique).toHaveBeenCalledTimes(2);

    for (let index = 0; index < 257; index++) await getSetting(`key-${index}`);
    await getSetting("key-0");
    expect(findUnique).toHaveBeenCalledTimes(260);
  });

  it("does not restore stale settings after a rotation clears an in-flight read", async () => {
    let resolveOld!: (value: { value: string }) => void;
    findUnique
      .mockImplementationOnce(
        () =>
          new Promise<{ value: string }>((resolve) => {
            resolveOld = resolve;
          })
      )
      .mockResolvedValueOnce({ value: "new" });
    const oldRead = getSetting("api.tvdb.key");
    await vi.waitFor(() => expect(findUnique).toHaveBeenCalledTimes(1));
    clearSettingsCache();
    expect(await getSetting("api.tvdb.key")).toBe("new");
    resolveOld({ value: "old" });
    expect(await oldRead).toBe("old");
    expect(await getSetting("api.tvdb.key")).toBe("new");
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("deduplicates keys in a multi-setting read", async () => {
    findUnique.mockResolvedValue({ value: "enabled" });
    expect(await getSettings(["a", "a", "b"])).toEqual({ a: "enabled", b: "enabled" });
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});

describe("getMinDurationSeconds", () => {
  it("uses the configured duration", async () => {
    findUnique.mockResolvedValue({ value: "2700" });

    await expect(getMinDurationSeconds()).resolves.toBe(2700);
  });

  it("allows zero to disable minimum-duration filtering", async () => {
    findUnique.mockResolvedValue({ value: "0" });

    await expect(getMinDurationSeconds()).resolves.toBe(0);
  });

  it("defaults only missing settings to 300 seconds", async () => {
    findUnique.mockResolvedValue(null);
    await expect(getMinDurationSeconds()).resolves.toBe(300);
  });
  it.each(["invalid", "-1", "300suffix", ""])("fails closed for stored %s", async (value) => {
    findUnique.mockResolvedValue({ value });
    await expect(getMinDurationSeconds()).rejects.toThrow(
      "Invalid stored setting: matching.minDuration"
    );
  });
});

describe("request-scoped settings snapshots", () => {
  it("reads one atomic policy and reuses it in nested owners", async () => {
    findMany.mockResolvedValue([{ key: "matching.sonarr.tolerancePercent", value: "015" }]);
    await withSettingsSnapshot(async () => {
      expect(await getSetting("matching.sonarr.tolerancePercent")).toBe("15");
      expect(await getSetting("matching.movie.tolerancePercent")).toBe("10");
      await withSettingsSnapshot(async () => {
        expect(await getMinDurationSeconds()).toBe(300);
      });
    });
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findUnique).not.toHaveBeenCalled();
  });
  it("does not return a late response after a settings commit", async () => {
    findMany.mockResolvedValue([{ key: "matching.sonarr.tolerancePercent", value: "15" }]);
    await expect(
      withSettingsSnapshot(async () => {
        clearSettingsCache();
        expect(await getSetting("matching.sonarr.tolerancePercent")).toBe("15");
        return "stale";
      })
    ).rejects.toThrow("Settings changed during search");
  });
  it("never defaults corrupt stored matching settings or executes the search", async () => {
    const operation = vi.fn();
    findMany.mockResolvedValue([{ key: "matching.movie.yearTolerance", value: "0" }]);
    await expect(withSettingsSnapshot(operation)).rejects.toThrow("Invalid stored setting");
    expect(operation).not.toHaveBeenCalled();
  });
});

describe("isMkvConversionEnabled", () => {
  it("defaults to enabled when the setting does not exist", async () => {
    findUnique.mockResolvedValue(null);

    await expect(isMkvConversionEnabled()).resolves.toBe(true);
  });

  it.each([
    ["true", true],
    ["false", false],
  ])("maps %s to %s", async (value, expected) => {
    findUnique.mockResolvedValue({ value });

    await expect(isMkvConversionEnabled()).resolves.toBe(expected);
  });
});
