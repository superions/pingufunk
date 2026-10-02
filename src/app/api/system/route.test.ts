import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "./route";

const { count, databaseSizeBytes } = vi.hoisted(() => ({
  count: vi.fn(),
  databaseSizeBytes: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    tvdbSeries: { count: vi.fn(async () => 1) },
    tvdbEpisode: { count: vi.fn(async () => 2) },
    config: { count: vi.fn(async () => 3) },
    download: { count },
  },
  databaseSizeBytes,
}));
vi.mock("child_process", () => ({ execSync: vi.fn(() => "synthetic-tool-version") }));

beforeEach(() => {
  vi.clearAllMocks();
  databaseSizeBytes.mockResolvedValue(4096);
  // Distinct states ensure a forgotten converting job changes the visible count.
  const rows = ["completed", "queued", "downloading", "converting", "processing", "failed"];
  count.mockImplementation(
    async ({ where }) =>
      rows.filter((state) =>
        typeof where.status === "string" ? state === where.status : where.status.in.includes(state)
      ).length
  );
});

it("counts current conversion and legacy processing as unfinished downloads", async () => {
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).downloads).toEqual({ completed: 1, inQueue: 4, failed: 1 });
});

it("does not report healthy system statistics or raw details after a DB failure", async () => {
  databaseSizeBytes.mockRejectedValue(new Error("synthetic private connection detail"));
  const response = await GET();
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("synthetic private connection detail");
});
