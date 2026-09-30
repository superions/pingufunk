import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

const required = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const testUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
const run = required;

if (required) {
  let safe = false;
  try {
    const parsed = new URL(testUrl ?? "");
    safe =
      ["postgresql:", "postgres:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/pingufunk_qa";
  } catch {
    // Invalid or missing URL is rejected below without logging it.
  }
  if (!safe) throw new Error("A loopback disposable pingufunk_qa database is required");
}

afterAll(() => vi.unstubAllEnvs());

it.skipIf(!run)(
  "reads in maintenance and blocks model/transaction writes before PG mutation",
  async () => {
    vi.stubEnv("DATABASE_URL", testUrl);
    const { prisma } = await import("@/lib/db");
    const key = `qa-${randomUUID()}`;
    try {
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const countBefore = await prisma.config.count();
      const { GET: systemStatus } = await import("@/app/api/system/route");
      const status = await systemStatus();
      expect(status.status).toBe(200);
      expect((await status.json()).database.sizeBytes).toBeGreaterThan(0);
      await expect(prisma.config.create({ data: { key, value: "synthetic" } })).rejects.toThrow(
        "Application writes are disabled"
      );
      await expect(
        prisma.$transaction(async (tx) => tx.config.create({ data: { key, value: "synthetic" } }))
      ).rejects.toThrow("Application writes are disabled");
      expect(await prisma.config.count()).toBe(countBefore);

      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      const firstWrite = vi.spyOn(console, "warn").mockImplementation(() => {});
      await prisma.config.create({ data: { key, value: "synthetic" } });
      expect(firstWrite).toHaveBeenCalledWith(
        "[Migration] First application PostgreSQL mutation observed; SQLite rollback requires reconciliation"
      );
      expect((await prisma.config.findUnique({ where: { key } }))?.value).toBe("synthetic");
      await prisma.config.update({ where: { key }, data: { value: "rotated" } });
      expect((await prisma.config.findUnique({ where: { key } }))?.value).toBe("rotated");
      await prisma.config.delete({ where: { key } });
      expect(
        firstWrite.mock.calls.filter(([message]) =>
          String(message).startsWith("[Migration] First application")
        )
      ).toHaveLength(1);
      expect(await prisma.config.count()).toBe(countBefore);
    } finally {
      vi.restoreAllMocks();
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      await prisma.config.deleteMany({ where: { key } });
      await prisma.$disconnect();
    }
  }
);
