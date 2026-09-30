import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

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

afterAll(async () => {
  vi.unstubAllEnvs();
  if (!run) return;
  process.env.DATABASE_URL = testUrl;
  const cleanup = new PrismaClient({ log: [] });
  try {
    await cleanup.migrationCheckpoint.deleteMany({ where: { key: "first_application_write" } });
  } finally {
    await cleanup.$disconnect();
  }
});

it.skipIf(!run)(
  "reads in maintenance and blocks model/transaction writes before PG mutation",
  async () => {
    vi.stubEnv("DATABASE_URL", testUrl);
    const { prisma } = await import("@/lib/db");
    const key = `qa-${randomUUID()}`;
    const pg = new PrismaClient({ log: [], datasourceUrl: testUrl });
    try {
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const countBefore = await prisma.config.count();
      expect(await pg.migrationCheckpoint.count()).toBe(0);
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
      expect(await pg.migrationCheckpoint.count()).toBe(0);

      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      const firstWrite = vi.spyOn(console, "warn").mockImplementation(() => {});
      await prisma.config.create({ data: { key, value: "synthetic" } });
      expect(
        (
          await pg.migrationCheckpoint.findUnique({
            where: { key: "first_application_write" },
          })
        )?.key
      ).toBe("first_application_write");
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
      await pg.$disconnect();
    }
  }
);

it.skipIf(!run)(
  "serves queue, history, rulesets and category cache from disposable PostgreSQL",
  async () => {
    vi.stubEnv("DATABASE_URL", testUrl);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
    const { prisma } = await import("@/lib/db");
    const id = randomUUID();
    const topic = `qa-${id}`;
    const settingKey = `qa.${id}`;
    try {
      await prisma.download.create({
        data: {
          id,
          title: "Synthetic.S01E01",
          url: "https://example.invalid/video",
          category: "sonarr",
          status: "queued",
        },
      });
      await prisma.generatedRuleset.create({
        data: { id, topic, tvdbId: 7123, showName: "Synthetic" },
      });
      await prisma.topicCategory.create({ data: { id, topic, category: "tv" } });
      const { POST: settingsPost, GET: settingsGet } = await import("@/app/api/settings/route");
      const saved = await settingsPost(
        new NextRequest("http://localhost/api/settings", {
          method: "POST",
          body: JSON.stringify({ key: settingKey, value: "synthetic-setting" }),
        })
      );
      expect(saved.status).toBe(200);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const readback = await settingsGet(
        new NextRequest(`http://localhost/api/settings?key=${settingKey}`)
      );
      expect((await readback.json()).value).toBe("synthetic-setting");
      const { getQueue, getHistory } = await import("@/services/download");
      const { getCategoryForTopic } = await import("@/services/category");
      const { GET: rulesetsGet } = await import("@/app/api/rulesets/route");
      expect((await getQueue()).slots.find((item) => item.nzo_id === id)?.cat).toBe("sonarr");
      expect(await getCategoryForTopic(topic)).toBe("tv");
      const rulesets = await rulesetsGet();
      expect(rulesets.status).toBe(200);
      expect((await rulesets.json()).some((item: { id: string }) => item.id === id)).toBe(true);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      await prisma.download.update({
        where: { id },
        data: {
          status: "failed",
          completedAt: new Date("2026-09-30T12:00:00.123Z"),
          size: BigInt(2048),
        },
      });
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const history = await getHistory();
      expect(history.slots.find((item) => item.nzo_id === id)).toMatchObject({
        status: "Failed",
        bytes: 2048,
        category: "sonarr",
      });
    } finally {
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      await prisma.download.deleteMany({ where: { id } });
      await prisma.generatedRuleset.deleteMany({ where: { id } });
      await prisma.topicCategory.deleteMany({ where: { id } });
      await prisma.config.deleteMany({ where: { key: settingKey } });
      await prisma.$disconnect();
    }
  }
);
