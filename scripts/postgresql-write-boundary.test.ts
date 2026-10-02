import { expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const required = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const testUrl = process.env.PINGUFUNK_TEST_DENIED_URL;
if (required) {
  let safe = false;
  try {
    const parsed = new URL(testUrl ?? "");
    safe =
      ["postgresql:", "postgres:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/pingufunk_qa" &&
      parsed.username === "pingufunk_qa_denied";
  } catch {
    // Invalid or missing disposable URL.
  }
  if (!safe) throw new Error("A loopback disposable denied-write role is required");
}

it.skipIf(!required)(
  "fails closed when the durable first-write checkpoint cannot be saved",
  async () => {
    vi.stubEnv("DATABASE_URL", testUrl);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
    const { prisma } = await import("@/lib/db");
    const key = `qa-denied-${randomUUID()}`;
    const pg = new PrismaClient({ log: [], datasourceUrl: testUrl });
    try {
      expect(await pg.migrationCheckpoint.count()).toBe(0);
      await expect(
        prisma.config.create({ data: { key, value: "never-written" } })
      ).rejects.toThrow();
      expect(await prisma.config.count({ where: { key } })).toBe(0);
      expect(await pg.migrationCheckpoint.count()).toBe(0);
    } finally {
      await prisma.$disconnect();
      await pg.$disconnect();
      vi.unstubAllEnvs();
    }
  }
);
