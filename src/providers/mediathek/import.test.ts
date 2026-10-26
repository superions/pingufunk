import { expect, it, vi } from "vitest";

const { readSetting, spawn, execFile } = vi.hoisted(() => ({
  readSetting: vi.fn(),
  spawn: vi.fn(),
  execFile: vi.fn(),
}));
vi.mock("@/lib/settings", () => ({ getSetting: readSetting, getMinDurationSeconds: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  spawn,
  execFile,
}));

it("loads the source modules and dispatcher without settings, network, tools or download jobs", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Unexpected network"));
  try {
    await Promise.all([
      import("./search"),
      import("./download"),
      import("@/server/source-download"),
    ]);
    expect(readSetting).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(execFile).not.toHaveBeenCalled();
  } finally {
    fetch.mockRestore();
  }
});
