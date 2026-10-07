import { afterAll, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";
import { spawnSync } from "node:child_process";
import path from "node:path";

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
    vi.stubEnv("DATABASE_PROVIDER", undefined);
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: testUrl };
    delete env.DATABASE_PROVIDER;
    delete env.DATABASE_URL_FILE;
    delete env.PINGUFUNK_WRITES_ENABLED;
    // Exercise the real startup readiness wrapper, then exit via Next's help
    // option instead of opening a server or booting a production worker.
    const localStart = spawnSync(
      process.execPath,
      [path.resolve("scripts/application-entrypoint.mjs"), "start", "--help"],
      { env, encoding: "utf8", timeout: 30_000 }
    );
    expect(localStart.status === 0).toBe(true);
    const { prisma } = await import("@/lib/db");
    const key = `qa-${randomUUID()}`;
    const pg = new PrismaClient({ log: [], datasourceUrl: testUrl });
    try {
      vi.spyOn(globalThis, "fetch").mockRejectedValue(
        new Error("External network forbidden in PG gate")
      );
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const countBefore = await prisma.config.count();
      const domainCounts = () =>
        Promise.all([
          prisma.config.count(),
          prisma.download.count(),
          prisma.generatedRuleset.count(),
          prisma.topicCategory.count(),
          prisma.tvdbSeries.count(),
          prisma.tvdbEpisode.count(),
        ]);
      const beforeAllModels = await domainCounts();
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
      const mutations = [
        () => prisma.config.createMany({ data: [{ key, value: "synthetic" }] }),
        () => prisma.config.createManyAndReturn({ data: [{ key, value: "synthetic" }] }),
        () => prisma.config.update({ where: { key }, data: { value: "synthetic" } }),
        () => prisma.config.updateMany({ where: { key }, data: { value: "synthetic" } }),
        () => prisma.config.updateManyAndReturn({ where: { key }, data: { value: "synthetic" } }),
        () =>
          prisma.config.upsert({
            where: { key },
            create: { key, value: "synthetic" },
            update: { value: "synthetic" },
          }),
        () => prisma.config.delete({ where: { key } }),
        () => prisma.config.deleteMany({ where: { key } }),
        () =>
          prisma.tvdbSeries.create({
            data: { id: 7654321, name: "Synthetic", expiresAt: new Date() },
          }),
        () =>
          prisma.tvdbEpisode.create({
            data: { seriesId: 7654321, seasonNumber: 1, episodeNumber: 1 },
          }),
        () =>
          prisma.download.create({
            data: {
              id: key,
              title: "Synthetic",
              url: "https://example.invalid/video",
              category: "tv",
            },
          }),
        () =>
          prisma.generatedRuleset.create({
            data: { id: key, topic: key, tvdbId: 7654321, showName: "Synthetic" },
          }),
        () => prisma.topicCategory.create({ data: { id: key, topic: key, category: "tv" } }),
      ];
      for (const mutate of mutations)
        await expect(mutate()).rejects.toThrow("Application writes are disabled");
      const { addToQueue, retryDownload, deleteHistoryItem } = await import("@/services/download");
      const { startDownloadProcessing, recoverInterruptedDownloads } =
        await import("@/server/download-manager");
      for (const action of [
        () => addToQueue("https://example.invalid/video", "Synthetic", "tv"),
        () => retryDownload(key),
        () => deleteHistoryItem(key, true),
        () => startDownloadProcessing(),
        () => recoverInterruptedDownloads(),
      ])
        await expect(action()).rejects.toThrow("Application writes are disabled");
      for (const name of ["settings", "rulesets", "download"] as const) {
        const route =
          name === "settings"
            ? await import("@/app/api/settings/route")
            : name === "rulesets"
              ? await import("@/app/api/rulesets/route")
              : await import("@/app/api/download/route");
        expect(
          (
            await route.POST(
              new NextRequest(`http://localhost/api/${name}`, {
                method: "POST",
                body: JSON.stringify({ key, value: "synthetic", id: key }),
              })
            )
          ).status
        ).toBe(503);
      }
      await expect(
        prisma.$executeRaw`UPDATE "Config" SET value='synthetic' WHERE key=${key}`
      ).rejects.toThrow("Application writes are disabled");
      await expect(
        prisma.$executeRawUnsafe('UPDATE "Config" SET value=$1 WHERE key=$2', "synthetic", key)
      ).rejects.toThrow("Application writes are disabled");
      expect(await prisma.config.count()).toBe(countBefore);
      expect(await domainCounts()).toEqual(beforeAllModels);
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
    vi.stubEnv("DATABASE_PROVIDER", undefined);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
    const { prisma } = await import("@/lib/db");
    const id = randomUUID();
    const topic = `qa-${id}`;
    const legacyKey = `qa.${id}`;
    const settingKey = "matching.movie.yearTolerance";
    // This gate owns an empty disposable schema, never an installation config.
    expect(await prisma.config.findUnique({ where: { key: settingKey } })).toBeNull();
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
      await prisma.config.create({ data: { key: legacyKey, value: "synthetic-setting" } });
      const { POST: settingsPost, GET: settingsGet } = await import("@/app/api/settings/route");
      const rejected = await settingsPost(
        new NextRequest("http://localhost/api/settings", {
          method: "POST",
          body: JSON.stringify({ key: legacyKey, value: "must-not-replace" }),
        })
      );
      expect(rejected.status).toBe(400);
      const saved = await settingsPost(
        new NextRequest("http://localhost/api/settings", {
          method: "POST",
          body: JSON.stringify({ key: settingKey, value: "02" }),
        })
      );
      expect(saved.status).toBe(200);
      expect(await saved.json()).toMatchObject({
        success: true,
        updated: 1,
        settings: { [settingKey]: "2" },
      });
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
      const readback = await settingsGet(
        new NextRequest(`http://localhost/api/settings?key=${settingKey}`)
      );
      expect((await readback.json()).value).toBe("2");
      const legacyReadback = await settingsGet(
        new NextRequest(`http://localhost/api/settings?key=${legacyKey}`)
      );
      expect((await legacyReadback.json()).value).toBe("synthetic-setting");
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
      await prisma.config.deleteMany({ where: { key: { in: [settingKey, legacyKey] } } });
      await prisma.$disconnect();
    }
  }
);
