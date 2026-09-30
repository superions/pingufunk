import { backup, DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectLocation, inspectSource } from "./postgresql-preflight.mjs";

function checkPath(path, label) {
  if (!path?.startsWith("/")) throw new Error(`Absolute ${label} path required`);
}

async function hashFile(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function createSnapshot(sourcePath, newPrivateDirectory) {
  checkPath(sourcePath, "source");
  checkPath(newPrivateDirectory, "snapshot directory");
  const source = inspectLocation(sourcePath);
  mkdirSync(newPrivateDirectory, { mode: 0o700 });
  const mode = statSync(newPrivateDirectory).mode & 0o777;
  if (mode !== 0o700) throw new Error("Snapshot directory permissions are not private");
  const snapshotPath = join(newPrivateDirectory, "source.sqlite");
  const oldUmask = process.umask(0o077);
  let db;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true, readBigInts: true });
    db.exec("PRAGMA query_only=ON");
    await backup(db, snapshotPath);
  } finally {
    try {
      db?.close();
    } finally {
      process.umask(oldUmask);
    }
  }
  // The backup can inherit WAL journal mode. Canonicalize only the private
  // snapshot so its hash covers one complete SQLite file, never sidecars.
  const canonical = new DatabaseSync(snapshotPath);
  try {
    canonical.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    canonical.exec("PRAGMA journal_mode=DELETE");
  } finally {
    canonical.close();
  }
  if ((statSync(snapshotPath).mode & 0o777) !== 0o600)
    throw new Error("Snapshot file permissions are not private");
  const snapshot = new DatabaseSync(snapshotPath, { readOnly: true, readBigInts: true });
  try {
    snapshot.exec("PRAGMA query_only=ON");
    const integrity = snapshot.prepare("PRAGMA integrity_check").all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== "ok")
      throw new Error("Snapshot integrity check failed");
    if (snapshot.prepare("PRAGMA foreign_key_check").get())
      throw new Error("Snapshot foreign key check failed");
  } finally {
    snapshot.close();
  }
  const preflight = inspectSource(snapshotPath);
  return { version: 1, source, snapshotPath, sha256: await hashFile(snapshotPath), preflight };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 4) throw new Error("Expected source and new private directory");
    console.log(JSON.stringify(await createSnapshot(process.argv[2], process.argv[3])));
  } catch {
    console.error("SQLite snapshot failed; retain the private directory for inspection");
    process.exitCode = 1;
  }
}
