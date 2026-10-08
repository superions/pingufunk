import { afterEach, beforeEach, expect, it, vi } from "vitest";
import path from "node:path";

const { configFindUnique, downloadFindMany } = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  databaseProvider: "sqlite",
  prisma: {
    config: { findUnique: configFindUnique },
    download: { findMany: downloadFindMany },
  },
}));

import { clearSettingsCache } from "@/lib/settings";
import { getHistory, getQueue } from "./download";

beforeEach(() => {
  vi.clearAllMocks();
  clearSettingsCache();
  configFindUnique.mockResolvedValue({ value: "/downloads" });
  vi.stubEnv("DOWNLOAD_FOLDER_PATH_MAPPING", "/mapped/downloads");
});

afterEach(() => vi.unstubAllEnvs());

it("reports a job-owned mapped folder while retaining the public SAB category", async () => {
  downloadFindMany.mockResolvedValueOnce([
    {
      id: "job-id",
      title: "Show.S01E02",
      category: "sonarr",
      status: "completed",
      completedAt: new Date("2026-09-30T00:00:00Z"),
      filePath: path.join("/downloads", "sonarr", "Show.S01E02-job-id", "Show.S01E02.mkv"),
      size: BigInt(4),
      error: null,
    },
  ]);

  const history = await getHistory();

  expect(history.slots[0]).toEqual(
    expect.objectContaining({
      nzo_id: "job-id",
      category: "sonarr",
      storage: "/mapped/downloads/sonarr/Show.S01E02-job-id",
    })
  );
});

it("keeps the public category unchanged in a queued job", async () => {
  downloadFindMany.mockResolvedValueOnce([
    {
      id: "job-id",
      title: "Show.S01E02",
      category: "sonarr",
      status: "downloading",
      progress: 25,
      totalSize: BigInt(100),
      downloadedBytes: BigInt(25),
      speed: BigInt(1),
    },
  ]);

  const queue = await getQueue();

  expect(queue.slots[0]).toEqual(
    expect.objectContaining({ nzo_id: "job-id", cat: "sonarr", filename: "Show.S01E02" })
  );
});

it("keeps a proxy-private legacy folder readable while exposing only its public category", async () => {
  const privateCategory = "sonarr/Show.S01E02.rfjob-2589d87beba2";
  downloadFindMany.mockResolvedValueOnce([
    {
      id: "legacy-job",
      title: "Show.S01E02",
      category: privateCategory,
      status: "completed",
      completedAt: new Date("2026-09-30T00:00:00Z"),
      filePath: `/mapped/downloads/${privateCategory}/Show.S01E02.mkv`,
      size: BigInt(4),
      error: null,
    },
  ]);
  const history = await getHistory();
  expect(history.slots[0]).toEqual(
    expect.objectContaining({
      category: "sonarr",
      storage: "/mapped/downloads/sonarr/Show.S01E02.rfjob-2589d87beba2",
    })
  );

  downloadFindMany.mockResolvedValueOnce([
    {
      id: "legacy-job",
      title: "Show.S01E02",
      category: privateCategory,
      status: "downloading",
      progress: 1,
      totalSize: BigInt(100),
      downloadedBytes: BigInt(1),
      speed: BigInt(1),
    },
  ]);
  expect((await getQueue()).slots[0].cat).toBe("sonarr");
});
