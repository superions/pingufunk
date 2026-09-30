import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, it } from "vitest";
import { createSnapshot } from "./postgresql-snapshot.mjs";
import { importSnapshot } from "./postgresql-import.mjs";
import { synchronizeOwnedSequences } from "./postgresql-verify.mjs";
import { createHash } from "node:crypto";

const enabled = process.env.PINGUFUNK_REQUIRE_PG_IMPORT_TESTS === "1";
const url = process.env.PINGUFUNK_TEST_IMPORT_URL;
if (enabled) {
  let safe = false;
  try {
    const parsed = new URL(url ?? "");
    safe =
      ["postgresql:", "postgres:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/pingufunk_qa_fresh" &&
      parsed.username === "pingufunk_qa_import";
  } catch {
    /* Invalid or missing disposable URL. */
  }
  if (!safe) throw new Error("A loopback disposable import database and scoped role are required");
}

it.skipIf(!enabled)("imports all six models atomically and refuses a nonempty repeat", async () => {
  process.env.DATABASE_URL = url;
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-import-test-"));
  const sourcePath = join(dir, "source.sqlite");
  const sqlite = new DatabaseSync(sourcePath);
  let sqliteOpen = true;
  const pg = new PrismaClient({ log: [] });
  let generatedId: number | null = null;
  try {
    sqlite.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
    sqlite.exec(`
      INSERT INTO TvdbSeries(id,name,firstAired,cachedAt,expiresAt)
        VALUES (7123,'Synthetic','2024-01-01T12:00:00.123+02:00',1780228800123,1780238800123);
      INSERT INTO TvdbEpisode(id,seriesId,seasonNumber,episodeNumber) VALUES (37,7123,1,2);
      INSERT INTO Config(key,value) VALUES ('qa-secret','synthetic-private');
      INSERT INTO Download(id,title,url,category,status,progress,size,totalSize,downloadedBytes,speed,createdAt)
        VALUES ('synthetic-download','Synthetic','https://example.invalid/video','tv','queued',2,9007199254740993,9007199254740993,1,0,1780228800123);
      INSERT INTO GeneratedRuleset(id,topic,tvdbId,showName,createdAt,updatedAt)
        VALUES ('synthetic-rule','Synthetic Topic',7123,'Synthetic',1780228800123,1780228800123);
      INSERT INTO TopicCategory(id,topic,category,cachedAt)
        VALUES ('synthetic-category','Synthetic Topic','tv',1780228800123);
    `);
    sqlite.close();
    sqliteOpen = false;
    const snapshot = await createSnapshot(sourcePath, join(dir, "backup"));
    const args = {
      snapshotPath: snapshot.snapshotPath,
      expectedHash: snapshot.sha256,
      database: "pingufunk_qa_fresh",
      role: "pingufunk_qa_import",
      host: "127.0.0.1",
      requireTls: false,
    };
    await expect(importSnapshot({ ...args, verifyOnly: true })).rejects.toThrow(
      "No validated import manifest"
    );
    const migration = "20260930000000_postgresql_baseline";
    const checksum = createHash("sha256")
      .update(readFileSync(`prisma/migrations/${migration}/migration.sql`))
      .digest("hex");
    await pg.$executeRaw`UPDATE "_prisma_migrations" SET checksum='tampered' WHERE migration_name=${migration}`;
    await expect(importSnapshot(args)).rejects.toThrow("checksum changed");
    expect(await pg.config.count()).toBe(0);
    await pg.$executeRaw`UPDATE "_prisma_migrations" SET checksum=${checksum} WHERE migration_name=${migration}`;
    await expect(
      importSnapshot({
        ...args,
        afterTable(table: string) {
          if (table === "Config") throw new Error("Synthetic mid-import fault");
        },
      })
    ).rejects.toThrow("Synthetic mid-import fault");
    expect(await pg.tvdbSeries.count()).toBe(0);
    expect(await pg.tvdbEpisode.count()).toBe(0);
    expect(await pg.config.count()).toBe(0);
    const result = await importSnapshot(args);
    expect(result.sourceCounts.Download).toBe("1");
    expect(await pg.tvdbSeries.count()).toBe(1);
    expect(await pg.tvdbEpisode.count()).toBe(1);
    expect(await pg.config.count()).toBe(1);
    expect(await pg.download.count()).toBe(1);
    expect(await pg.generatedRuleset.count()).toBe(1);
    expect(await pg.topicCategory.count()).toBe(1);
    expect(
      (await pg.tvdbSeries.findUnique({ where: { id: 7123 } }))?.firstAired?.toISOString()
    ).toBe("2024-01-01T10:00:00.123Z");
    expect((await pg.download.findUnique({ where: { id: "synthetic-download" } }))?.size).toBe(
      BigInt("9007199254740993")
    );
    expect((await pg.tvdbEpisode.findUnique({ where: { id: 37 } }))?.seriesId).toBe(7123);
    expect((await pg.config.findUnique({ where: { key: "qa-secret" } }))?.value).toBe(
      "synthetic-private"
    );
    const manifestPath = join(dir, "backup", "import-manifest.json");
    const crashWindow = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeFileSync(manifestPath, JSON.stringify({ ...crashWindow, status: "pending" }));
    expect((await importSnapshot(args)).imported).toBe(false);
    expect((await importSnapshot({ ...args, verifyOnly: true })).imported).toBe(false);
    expect(JSON.parse(readFileSync(manifestPath, "utf8")).status).toBe("validated");
    let sideEffectCompleted = false;
    const interruptedSequenceClient = {
      migrationCheckpoint: pg.migrationCheckpoint,
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) =>
        pg.$queryRaw(strings, ...values),
      $queryRawUnsafe: async (sql: string, ...values: unknown[]) => {
        const result = await pg.$queryRawUnsafe(sql, ...values);
        if (sql.startsWith("SELECT setval")) {
          sideEffectCompleted = true;
          throw new Error("Synthetic failure after nontransactional setval");
        }
        return result;
      },
    };
    await expect(synchronizeOwnedSequences(interruptedSequenceClient)).rejects.toThrow(
      "Synthetic failure after nontransactional setval"
    );
    expect(sideEffectCompleted).toBe(true);
    // Re-reading the verified snapshot is the caller's prerequisite before retry.
    expect((await importSnapshot({ ...args, verifyOnly: true })).imported).toBe(false);
    expect((await synchronizeOwnedSequences(pg)).adjustedSequences).toBe(1);
    expect((await synchronizeOwnedSequences(pg)).adjustedSequences).toBe(1);
    const next = await pg.tvdbEpisode.create({
      data: { seriesId: 7123, seasonNumber: 1, episodeNumber: 3 },
    });
    generatedId = next.id;
    expect(next.id).toBeGreaterThan(37);
    await pg.tvdbEpisode.delete({ where: { id: next.id } });
    generatedId = null;
    await pg.config.update({ where: { key: "qa-secret" }, data: { value: "modified" } });
    await expect(importSnapshot(args)).rejects.toThrow("Value mismatch in Config.value");
    expect((await pg.config.findUnique({ where: { key: "qa-secret" } }))?.value).toBe("modified");
    await pg.config.update({ where: { key: "qa-secret" }, data: { value: "synthetic-private" } });
    await pg.config.create({ data: { key: "qa-foreign", value: "foreign-stays" } });
    await expect(importSnapshot(args)).rejects.toThrow("Row count mismatch in Config");
    expect((await pg.config.findUnique({ where: { key: "qa-foreign" } }))?.value).toBe(
      "foreign-stays"
    );
    await pg.migrationCheckpoint.create({ data: { key: "first_application_write" } });
    await expect(synchronizeOwnedSequences(pg)).rejects.toThrow(
      "Application PostgreSQL write checkpoint already exists"
    );
    await expect(importSnapshot(args)).rejects.toThrow(
      "Application PostgreSQL write checkpoint already exists"
    );
  } finally {
    if (sqliteOpen) sqlite.close();
    if (generatedId !== null) await pg.tvdbEpisode.deleteMany({ where: { id: generatedId } });
    await pg.tvdbEpisode.deleteMany({ where: { id: 37 } });
    await pg.tvdbSeries.deleteMany({ where: { id: 7123 } });
    await pg.download.deleteMany({ where: { id: "synthetic-download" } });
    await pg.config.deleteMany({ where: { key: "qa-secret" } });
    await pg.config.deleteMany({ where: { key: "qa-foreign" } });
    await pg.generatedRuleset.deleteMany({ where: { id: "synthetic-rule" } });
    await pg.topicCategory.deleteMany({ where: { id: "synthetic-category" } });
    await pg.migrationCheckpoint.deleteMany({ where: { key: "first_application_write" } });
    await pg.$disconnect();
    rmSync(dir, { recursive: true, force: true });
  }
});

it.skipIf(!enabled)("resets an empty owned sequence to its actual start value", async () => {
  process.env.DATABASE_URL = url;
  const pg = new PrismaClient({ log: [] });
  try {
    expect(await pg.tvdbEpisode.count()).toBe(0);
    expect((await synchronizeOwnedSequences(pg)).adjustedSequences).toBe(1);
    expect((await synchronizeOwnedSequences(pg)).adjustedSequences).toBe(1);
    await pg.tvdbSeries.create({
      data: { id: 9999, name: "Synthetic", expiresAt: new Date("2026-10-01T00:00:00Z") },
    });
    const episode = await pg.tvdbEpisode.create({
      data: { seriesId: 9999, seasonNumber: 1, episodeNumber: 1 },
    });
    expect(episode.id).toBe(1);
  } finally {
    await pg.tvdbEpisode.deleteMany({ where: { seriesId: 9999 } });
    await pg.tvdbSeries.deleteMany({ where: { id: 9999 } });
    await pg.$disconnect();
  }
});

it.skipIf(!enabled)("does not reuse deleted SQLite IDs after a PostgreSQL cutover", async () => {
  process.env.DATABASE_URL = url;
  const sqlite = new DatabaseSync(":memory:", { readBigInts: true });
  const pg = new PrismaClient({ log: [] });
  try {
    sqlite.exec(
      'CREATE TABLE "TvdbEpisode" (id INTEGER PRIMARY KEY AUTOINCREMENT); INSERT INTO "TvdbEpisode" VALUES (1000); DELETE FROM "TvdbEpisode"'
    );
    expect(await pg.tvdbEpisode.count()).toBe(0);
    await synchronizeOwnedSequences(pg, sqlite);
    await pg.tvdbSeries.create({
      data: { id: 9998, name: "Synthetic", expiresAt: new Date("2026-10-01T00:00:00Z") },
    });
    const episode = await pg.tvdbEpisode.create({
      data: { seriesId: 9998, seasonNumber: 1, episodeNumber: 1 },
    });
    expect(episode.id).toBe(1001);
  } finally {
    await pg.tvdbEpisode.deleteMany({ where: { seriesId: 9998 } });
    await pg.tvdbSeries.deleteMany({ where: { id: 9998 } });
    await pg.$disconnect();
    sqlite.close();
  }
});
