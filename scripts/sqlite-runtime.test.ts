import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { checkSqliteSchema } from "./check-sqlite-schema.mjs";
import { createSnapshot } from "./postgresql-snapshot.mjs";
import { transitionSqliteSnapshot } from "./sqlite-baseline.mjs";

const directories: string[] = [];
let disconnect: (() => Promise<void>) | undefined;
afterEach(async () => {
  await disconnect?.();
  disconnect = undefined;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.unstubAllEnvs();
  vi.resetModules();
  for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function location() {
  const dir = mkdtempSync(path.join(tmpdir(), "pingufunk-sqlite-qa-"));
  directories.push(dir);
  return path.join(dir, "database.sqlite");
}
function environment(filename: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `file:${filename}`,
  };
  delete env.DATABASE_URL_FILE;
  delete env.DATABASE_PROVIDER;
  return env;
}
function tool(script: string, filename: string, args: string[] = []) {
  return spawnSync(process.execPath, [path.resolve("scripts", script), ...args], {
    env: environment(filename),
    encoding: "utf8",
    timeout: 30_000,
  });
}
function hash(filename: string) {
  return createHash("sha256").update(readFileSync(filename)).digest("hex");
}
function seed(filename: string, bootstrap: boolean) {
  const db = new DatabaseSync(filename);
  try {
    if (bootstrap) db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
    const timestamp = Date.parse("2026-09-30T12:00:00.123Z");
    db.prepare("INSERT INTO Config(key,value) VALUES (?,?)").run(
      "qa.config",
      "synthetic-persisted"
    );
    db.prepare("INSERT INTO TvdbSeries(id,name,aliases,cachedAt,expiresAt) VALUES (?,?,?,?,?)").run(
      7123,
      "Synthetic",
      '["Original"]',
      timestamp,
      timestamp + 60000
    );
    db.prepare(
      "INSERT INTO TvdbEpisode(id,seriesId,seasonNumber,episodeNumber,name,aired) VALUES (?,?,?,?,?,?)"
    ).run(41, 7123, 2, 3, "Original Episode", timestamp);
    db.prepare(
      "INSERT INTO Download(id,title,url,category,status,size,filePath,createdAt,completedAt) VALUES (?,?,?,?,?,?,?,?,?)"
    ).run(
      "original-job",
      "Synthetic.S02E03",
      "https://example.invalid/video",
      "sonarr",
      "failed",
      BigInt("9007199254741115"),
      "/synthetic/jobs/original.mkv",
      timestamp,
      null
    );
    db.prepare(
      "INSERT INTO GeneratedRuleset(id,topic,tvdbId,showName,filters,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)"
    ).run(
      "original-rule",
      "Synthetic Topic",
      7123,
      "Synthetic",
      '[{"regex":"\\\\d+"}]',
      timestamp,
      timestamp
    );
    db.prepare(
      "INSERT INTO TopicCategory(id,topic,category,tmdbId,cachedAt) VALUES (?,?,?,?,?)"
    ).run("original-category", "Synthetic Topic", "tv", null, timestamp);
  } finally {
    db.close();
  }
}

// Multiple real CLI processes plus client startup exceed the default unit budget
// on a cold CI runner. Each child remains bounded and teardown still disconnects.
it.each(["bootstrap", "migrated"])(
  "preserves %s SQLite data through readiness, real client writes and restart",
  async (variant) => {
    let filename = location();
    if (variant === "migrated") {
      const first = tool("database-migrate.mjs", filename);
      expect(first.status, first.stderr).toBe(0);
      const beforeRepeat = hash(filename);
      expect(tool("database-migrate.mjs", filename).status).toBe(0);
      expect(hash(filename)).toBe(beforeRepeat);
    }
    seed(filename, variant === "bootstrap");
    if (variant === "bootstrap") {
      const original = filename;
      const originalHash = hash(original);
      expect(() => checkSqliteSchema(original)).toThrow("SQLite schema incompatible");
      const snapshot = await createSnapshot(original, path.join(path.dirname(original), "backup"));
      filename = path.join(path.dirname(original), "current.sqlite");
      transitionSqliteSnapshot({
        snapshotPath: snapshot.snapshotPath,
        expectedHash: snapshot.sha256,
        targetPath: filename,
      });
      expect(hash(original)).toBe(originalHash);
    }
    const beforeReadiness = hash(filename);
    checkSqliteSchema(filename);
    const readiness = tool("check-database-schema.mjs", filename);
    expect(readiness.status, readiness.stderr).toBe(0);
    expect(readiness.stdout).toBe("sqlite schema ready\n");
    expect(hash(filename)).toBe(beforeReadiness);
    const localStart = tool("application-entrypoint.mjs", filename, ["start", "--help"]);
    expect(localStart.status, localStart.stderr).toBe(0);
    expect(hash(filename)).toBe(beforeReadiness);

    vi.stubEnv("DATABASE_PROVIDER", undefined);
    vi.stubEnv("DATABASE_URL", `file:${filename}`);
    vi.stubEnv("DATABASE_URL_FILE", undefined);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", undefined);
    delete (globalThis as { prisma?: unknown }).prisma;
    const { prisma, databaseProvider } = await import("@/lib/db");
    disconnect = () => prisma.$disconnect();
    expect(databaseProvider).toBe("sqlite");
    expect((await prisma.config.findUnique({ where: { key: "qa.config" } }))?.value).toBe(
      "synthetic-persisted"
    );
    const show = await prisma.tvdbSeries.findUnique({
      where: { id: 7123 },
      include: { episodes: true },
    });
    expect(show?.aliases).toBe('["Original"]');
    expect(show?.episodes[0]).toMatchObject({ id: 41, seasonNumber: 2, episodeNumber: 3 });
    expect(show?.cachedAt.toISOString()).toBe("2026-09-30T12:00:00.123Z");
    const job = await prisma.download.findUnique({ where: { id: "original-job" } });
    expect(job).toMatchObject({
      size: BigInt("9007199254741115"),
      filePath: "/synthetic/jobs/original.mkv",
      completedAt: null,
      status: "failed",
    });
    expect(
      (await prisma.generatedRuleset.findUnique({ where: { id: "original-rule" } }))?.filters
    ).toBe('[{"regex":"\\\\d+"}]');
    await prisma.generatedRuleset.create({
      data: {
        id: "second-series-rule",
        topic: "Synthetic Topic",
        tvdbId: 9999,
        showName: "Other series",
      },
    });
    expect(
      (
        await prisma.generatedRuleset.findUnique({
          where: { tvdbId_topic: { tvdbId: 7123, topic: "Synthetic Topic" } },
        })
      )?.id
    ).toBe("original-rule");
    expect(
      (
        await prisma.generatedRuleset.findUnique({
          where: { tvdbId_topic: { tvdbId: 9999, topic: "Synthetic Topic" } },
        })
      )?.id
    ).toBe("second-series-rule");
    await expect(
      prisma.generatedRuleset.create({
        data: { topic: "Synthetic Topic", tvdbId: 7123, showName: "Duplicate" },
      })
    ).rejects.toThrow();
    await prisma.generatedRuleset.delete({ where: { id: "second-series-rule" } });
    expect(
      (await prisma.topicCategory.findUnique({ where: { id: "original-category" } }))?.tmdbId
    ).toBeNull();
    const episode = await prisma.tvdbEpisode.create({
      data: { seriesId: 7123, seasonNumber: 2, episodeNumber: 4 },
    });
    expect(episode.id).toBeGreaterThan(41);

    const { POST, GET } = await import("@/app/api/settings/route");
    expect(
      (
        await POST(
          new NextRequest("http://localhost/api/settings", {
            method: "POST",
            body: JSON.stringify({ key: "qa.config", value: "client-roundtrip" }),
          })
        )
      ).status
    ).toBe(200);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
    await expect(
      prisma.config.update({ where: { key: "qa.config" }, data: { value: "forbidden" } })
    ).rejects.toThrow("Application writes are disabled");
    await expect(
      prisma.$executeRaw`UPDATE "Config" SET value='forbidden' WHERE key='qa.config'`
    ).rejects.toThrow("Application writes are disabled");
    await expect(
      prisma.$executeRawUnsafe(
        'UPDATE "Config" SET value=$1 WHERE key=$2',
        "forbidden",
        "qa.config"
      )
    ).rejects.toThrow("Application writes are disabled");
    expect((await prisma.config.findUnique({ where: { key: "qa.config" } }))?.value).toBe(
      "client-roundtrip"
    );
    expect((await GET(new NextRequest("http://localhost/api/settings?key=qa.config"))).status).toBe(
      200
    );
    const { GET: system } = await import("@/app/api/system/route");
    const response = await system();
    expect(response.status).toBe(200);
    expect((await response.json()).database).toMatchObject({
      shows: 1,
      episodes: 2,
      configEntries: 1,
    });
    vi.stubEnv("DATABASE_URL", `file:${filename}-other`);
    vi.resetModules();
    await expect(import("@/lib/db")).rejects.toThrow("restart the application");
    expect(existsSync(`${filename}-other`)).toBe(false);
    vi.stubEnv("DATABASE_URL", `file:${filename}`);
    await prisma.$disconnect();
    delete (globalThis as { prisma?: unknown }).prisma;
    vi.resetModules();
    const restarted = await import("@/lib/db");
    disconnect = () => restarted.prisma.$disconnect();
    expect((await restarted.prisma.config.findUnique({ where: { key: "qa.config" } }))?.value).toBe(
      "client-roundtrip"
    );
    expect(
      (await restarted.prisma.download.findUnique({ where: { id: "original-job" } }))?.size
    ).toBe(BigInt("9007199254741115"));
    const inspect = new DatabaseSync(filename, { readOnly: true });
    try {
      expect(
        inspect.prepare("SELECT name FROM sqlite_master WHERE name='MigrationCheckpoint'").get()
      ).toBeUndefined();
      expect(inspect.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally {
      inspect.close();
    }
  },
  60_000
);

it("refuses missing or incompatible SQLite databases without creating or repairing them", () => {
  const filename = location();
  const missing = tool("application-entrypoint.mjs", filename, ["start"]);
  expect(missing.status).not.toBe(0);
  expect(existsSync(filename)).toBe(false);
  seed(filename, true);
  const db = new DatabaseSync(filename);
  db.exec("ALTER TABLE Config ADD COLUMN unexpected TEXT");
  db.close();
  const before = hash(filename);
  expect(tool("check-database-schema.mjs", filename).status).not.toBe(0);
  expect(hash(filename)).toBe(before);
});
