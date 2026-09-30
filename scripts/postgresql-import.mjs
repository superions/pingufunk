import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  inspectLocation,
  inspectSource,
  inspectTarget,
  assertConnectedTarget,
} from "./postgresql-preflight.mjs";
import { convertRow, importOrder } from "./postgresql-row-transform.mjs";
import { verifyRows } from "./postgresql-verify.mjs";
import { hasRunManifest, prepareRunManifest } from "./postgresql-run-manifest.mjs";
import {
  validatePostgresqlLedger,
  validatePostgresqlStructure,
} from "./check-postgresql-schema.mjs";

export async function hashSnapshotFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Import core for a private, empty PostgreSQL target. The CLI requires a
 * persisted run identity and separates import, read-only verification and
 * nontransactional sequence synchronization into explicit actions.
 */
export async function importSnapshot({
  snapshotPath,
  expectedHash,
  database,
  role,
  host,
  requireTls = true,
  afterTable = /** @type {undefined | ((table: string) => void | Promise<void>)} */ (undefined),
  verifyOnly = false,
}) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash ?? "")) throw new Error("Snapshot hash required");
  const source = inspectSource(snapshotPath);
  if ((await hashSnapshotFile(snapshotPath)) !== expectedHash)
    throw new Error("Snapshot hash changed");
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
    const expectedMigrations = await validatePostgresqlLedger(pg);
    await validatePostgresqlStructure(pg);
    if ((await pg.migrationCheckpoint.count()) !== 0)
      throw new Error("Application PostgreSQL write checkpoint already exists");
    const scriptRoot = dirname(fileURLToPath(import.meta.url));
    const scriptNames = [
      "postgresql-import.mjs",
      "postgresql-preflight.mjs",
      "sqlite-schema.mjs",
      "postgresql-row-transform.mjs",
      "postgresql-verify.mjs",
      "postgresql-run-manifest.mjs",
      "postgresql-migration-cli.mjs",
      "check-postgresql-schema.mjs",
      "postgresql-prepare.mjs",
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
    if (verifyOnly && !hasRunManifest(snapshotPath))
      throw new Error("No validated import manifest exists");
    if (!hasRunManifest(snapshotPath)) {
      for (const [, delegate] of importOrder) {
        if ((await pg[delegate].count()) !== 0)
          throw new Error("Unowned PostgreSQL target is not empty");
      }
    }
    const manifest = prepareRunManifest(snapshotPath, identity);
    if (verifyOnly && manifest.status !== "validated")
      throw new Error("Import run is not validated");
    if (manifest.status === "validated") {
      await pg.$transaction(
        async (tx) => {
          await assertConnectedTarget(tx, target, database, role, requireTls);
          await verifyRows(sqlite, tx, source.counts);
        },
        { isolationLevel: "RepeatableRead", timeout: 3_600_000 }
      );
      const location = inspectLocation(snapshotPath);
      if (
        location.walPresent ||
        location.shmPresent ||
        (await hashSnapshotFile(snapshotPath)) !== expectedHash
      )
        throw new Error("Snapshot changed during verification");
      return {
        sourceHash: expectedHash,
        sourceCounts: source.counts,
        imported: false,
        runId: manifest.runId,
        target,
      };
    }
    const imported = await pg.$transaction(
      async (tx) => {
        await assertConnectedTarget(tx, target, database, role, requireTls);
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
          (await hashSnapshotFile(snapshotPath)) !== expectedHash
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
      target,
    };
  } finally {
    sqlite.close();
    await pg.$disconnect();
  }
}
