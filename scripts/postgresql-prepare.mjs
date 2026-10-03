import { DatabaseSync } from "node:sqlite";
import { lstatSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { inspectSource, inspectTarget, assertConnectedTarget } from "./postgresql-preflight.mjs";
import { hashSnapshotFile } from "./postgresql-import.mjs";
import { importOrder } from "./postgresql-row-transform.mjs";
import { postgresqlRequiresTls } from "./postgresql-transport.mjs";

/** Prepare only an empty dedicated migration target, never upgrade an active app. */
export async function preparePostgresqlTarget({
  snapshotPath,
  expectedHash,
  database,
  role,
  host,
  requireTls = postgresqlRequiresTls(),
  deploy = /** @type {undefined | (() => void | Promise<void>)} */ (undefined),
}) {
  if (!snapshotPath?.startsWith("/") || !/^[a-f0-9]{64}$/.test(expectedHash ?? ""))
    throw new Error("Private snapshot and hash required");
  const stat = lstatSync(snapshotPath);
  const parent = lstatSync(dirname(snapshotPath));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (parent.mode & 0o077) !== 0
  )
    throw new Error("Private snapshot permissions required");
  const source = inspectSource(snapshotPath);
  if ((await hashSnapshotFile(snapshotPath)) !== expectedHash)
    throw new Error("Snapshot hash changed");
  const sqlite = new DatabaseSync(snapshotPath, { readOnly: true, readBigInts: true });
  try {
    const check = sqlite.prepare("PRAGMA integrity_check").all();
    if (
      check.length !== 1 ||
      check[0].integrity_check !== "ok" ||
      sqlite.prepare("PRAGMA foreign_key_check").get()
    )
      throw new Error("Snapshot integrity failed");
  } finally {
    sqlite.close();
  }
  // Identity, supported server, primary, chosen transport, role and schema are checked
  // before invoking DDL. No superuser provisioning or credential creation here.
  const target = await inspectTarget(database, role, host, requireTls);
  const pg = new PrismaClient({ log: [] });
  let prepared = false;
  try {
    const assertEmpty = () =>
      pg.$transaction(
        async (tx) => {
          await assertConnectedTarget(tx, target, database, role, requireTls);
          if ((await tx.migrationCheckpoint.count()) !== 0)
            throw new Error("Target has application writes");
          for (const [, delegate] of importOrder) {
            if ((await tx[delegate].count()) !== 0) throw new Error("Prepare target is not empty");
          }
        },
        { isolationLevel: "RepeatableRead" }
      );
    if (target.schemaState === "validated") {
      await assertEmpty();
    } else {
      if (deploy) await deploy();
      else {
        const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
        const result = spawnSync(
          process.execPath,
          [resolve(root, "scripts/database-migrate.mjs")],
          {
            cwd: root,
            env: process.env,
            encoding: "utf8",
            timeout: 120000,
          }
        );
        if (result.error || result.status !== 0)
          throw new Error("Native target preparation failed");
      }
      const after = await inspectTarget(database, role, host, requireTls);
      if (
        after.schemaState !== "validated" ||
        after.databaseOid !== target.databaseOid ||
        after.serverAddress !== target.serverAddress ||
        after.serverPort !== target.serverPort ||
        after.schemaName !== target.schemaName ||
        after.schemaOid !== target.schemaOid
      )
        throw new Error("Prepared target identity changed");
      await assertEmpty();
      prepared = true;
    }
    const after = lstatSync(snapshotPath);
    if (
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      (await hashSnapshotFile(snapshotPath)) !== expectedHash
    )
      throw new Error("Snapshot changed during preparation");
    return { prepared, sourceHash: expectedHash, sourceCounts: source.counts };
  } finally {
    await pg.$disconnect();
  }
}
