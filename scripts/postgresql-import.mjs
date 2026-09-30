import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { inspectLocation, inspectSource, inspectTarget } from "./postgresql-preflight.mjs";
import { convertRow, importOrder } from "./postgresql-row-transform.mjs";
import { verifyRows } from "./postgresql-verify.mjs";
import { hasRunManifest, prepareRunManifest } from "./postgresql-run-manifest.mjs";

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * First-write core for a private, empty PostgreSQL target. This deliberately
 * has no CLI until repeat verification and a persisted run identity exist.
 */
export async function importSnapshot({
  snapshotPath,
  expectedHash,
  database,
  role,
  host,
  requireTls = true,
  afterTable = /** @type {undefined | ((table: string) => void | Promise<void>)} */ (undefined),
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) throw new Error("Snapshot hash required");
  const source = inspectSource(snapshotPath);
  if ((await hashFile(snapshotPath)) !== expectedHash) throw new Error("Snapshot hash changed");
  const target = await inspectTarget(database, role, host, requireTls);

  const sqlite = new DatabaseSync(snapshotPath, { readOnly: true, readBigInts: true });
  const pg = new PrismaClient({ log: [] });
  try {
    sqlite.exec("PRAGMA query_only=ON");
    sqlite.exec("BEGIN");
    const integrity = sqlite.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("Snapshot integrity check failed");
    if (sqlite.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Snapshot foreign key check failed");
    const migrationRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/migrations");
    const expectedMigrations = readdirSync(migrationRoot)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    if (expectedMigrations.length === 0) throw new Error("PostgreSQL migration history missing");
    const ledger = await pg.$queryRaw`
      SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"
    `;
    const applied = ledger
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name)
      .sort();
    if (JSON.stringify(applied) !== JSON.stringify(expectedMigrations))
      throw new Error("PostgreSQL migration history mismatch");
    const scriptRoot = dirname(fileURLToPath(import.meta.url));
    const scriptNames = [
      "postgresql-import.mjs",
      "postgresql-preflight.mjs",
      "postgresql-row-transform.mjs",
      "postgresql-verify.mjs",
      "postgresql-run-manifest.mjs",
    ];
    const importerVersion = createHash("sha256")
      .update(scriptNames.map((name) => readFileSync(resolve(scriptRoot, name))).join("\n"))
      .digest("hex");
    const schemaVersion = createHash("sha256")
      .update(
        expectedMigrations
          .map((name) => readFileSync(resolve(migrationRoot, name, "migration.sql")))
          .join("\n")
      )
      .digest("hex");
    const identity = {
      sourceHash: expectedHash,
      importerVersion,
      schemaVersion,
      migrations: expectedMigrations,
      database,
      role,
      host,
      target,
    };
    if (!hasRunManifest(snapshotPath)) {
      for (const [, delegate] of importOrder) {
        if ((await pg[delegate].count()) !== 0)
          throw new Error("Unowned PostgreSQL target is not empty");
      }
    }
    const manifest = prepareRunManifest(snapshotPath, identity);
    if (manifest.status === "validated") {
      await pg.$transaction(async (tx) => verifyRows(sqlite, tx, source.counts), {
        isolationLevel: "RepeatableRead",
      });
      return {
        sourceHash: expectedHash,
        sourceCounts: source.counts,
        imported: false,
        runId: manifest.runId,
      };
    }
    const imported = await pg.$transaction(
      async (tx) => {
        // ACCESS EXCLUSIVE prevents a concurrent application writer from adding
        // rows after the empty-target check. The operator must still keep the
        // application in maintenance for the whole handoff.
        await tx.$executeRawUnsafe(
          'LOCK TABLE "TvdbSeries", "TvdbEpisode", "Config", "Download", "GeneratedRuleset", "TopicCategory" IN ACCESS EXCLUSIVE MODE'
        );
        let existingRows = 0;
        for (const [, delegate] of importOrder) existingRows += await tx[delegate].count();
        if (existingRows === 0) {
          for (const [table, delegate] of importOrder) {
            const rows = sqlite.prepare(`SELECT * FROM "${table}"`).iterate();
            let batch = [];
            for (const row of rows) {
              batch.push(convertRow(table, row));
              if (batch.length === 100) {
                await tx[delegate].createMany({ data: batch });
                batch = [];
              }
            }
            if (batch.length) await tx[delegate].createMany({ data: batch });
            if (afterTable) await afterTable(table);
          }
        }
        await verifyRows(sqlite, tx, source.counts);
        const location = inspectLocation(snapshotPath);
        if (
          location.walPresent ||
          location.shmPresent ||
          (await hashFile(snapshotPath)) !== expectedHash
        )
          throw new Error("Snapshot changed during import");
        return existingRows === 0;
      },
      { maxWait: 10_000, timeout: 3_600_000 }
    );
    manifest.markValidated();
    return {
      sourceHash: expectedHash,
      sourceCounts: source.counts,
      imported,
      runId: manifest.runId,
    };
  } finally {
    sqlite.close();
    await pg.$disconnect();
  }
}
