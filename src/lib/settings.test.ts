import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { findUnique } = vi.hoisted(() => ({
  findUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique },
  },
}));

import {
  clearSettingsCache,
  getMinDurationSeconds,
  getSetting,
  getSettings,
  isMkvConversionEnabled,
} from "./settings";

beforeEach(() => {
  clearSettingsCache();
  findUnique.mockReset();
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

  it.each([null, { value: "invalid" }, { value: "-1" }])(
    "falls back to 300 seconds for %j",
    async (config) => {
      findUnique.mockResolvedValue(config);

      await expect(getMinDurationSeconds()).resolves.toBe(300);
    }
  );
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
