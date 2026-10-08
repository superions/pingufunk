import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  knownShapes,
  modelNames,
  schemaShape,
  validateSourceLedger,
  sourceRows,
} from "./sqlite-schema.mjs";
import { checkSqliteSchema } from "./check-sqlite-schema.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const hash = (value) => createHash("sha256").update(value).digest("hex");

function verifyIntegrity(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  if (
    rows.length !== 1 ||
    rows[0].integrity_check !== "ok" ||
    db.prepare("PRAGMA foreign_key_check").get()
  )
    throw new Error("SQLite integrity failed");
}

/** Compare raw SQLite values, retaining integer precision and representation. */
export function sqliteDataFingerprint(db) {
  const digest = createHash("sha256");
  for (const model of modelNames) {
    const key = model === "Config" ? "key" : "id";
    digest.update(model);
    const present = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
      .get(model);
    const rows = present
      ? db.prepare(`SELECT * FROM "${model}" ORDER BY "${key}"`).iterate()
      : sourceRows(db, model);
    for (const row of rows) {
      // Only these append-only nullable columns are absent in accepted historical shapes.
      // Present payloads are retained byte-for-byte, never normalized or discarded.
      if (model === "Download") {
        row.mediaExpectations ??= null;
        row.mediaValidation ??= null;
      }
      digest.update(
        JSON.stringify(
          Object.entries(row)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([field, value]) => [
              field,
              typeof value,
              typeof value === "bigint" ? value.toString() : value,
            ])
        )
      );
    }
  }
  return digest.digest("hex");
}

/** Build a new migrated database from a private immutable snapshot; never adopt its ledger. */
export function transitionSqliteSnapshot({ snapshotPath, expectedHash, targetPath }) {
  if (
    ![snapshotPath, targetPath].every((path) => typeof path === "string" && path.startsWith("/")) ||
    resolve(snapshotPath) === resolve(targetPath) ||
    !/^[a-f0-9]{64}$/.test(expectedHash ?? "")
  )
    throw new Error("Explicit snapshot, hash and separate target required");
  const stat = lstatSync(snapshotPath);
  const parent = lstatSync(dirname(targetPath));
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o077) !== 0 ||
    existsSync(`${snapshotPath}-wal`) ||
    existsSync(`${snapshotPath}-shm`) ||
    hash(readFileSync(snapshotPath)) !== expectedHash
  )
    throw new Error("Private immutable snapshot and private target directory required");
  const source = new DatabaseSync(snapshotPath, { readOnly: true, readBigInts: true });
  let target;
  try {
    verifyIntegrity(source);
    const shape = JSON.stringify(schemaShape(source));
    const variant = Object.entries(knownShapes()).find(
      ([, value]) => JSON.stringify(value) === shape
    )?.[0];
    if (!variant) throw new Error("Unknown SQLite source schema");
    if (
      source
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
        .get()
    ) {
      validateSourceLedger(source, variant);
    }
    const sourceData = sqliteDataFingerprint(source);
    const manifestPath = `${targetPath}.baseline.json`;
    const contract = {
      version: 1,
      sourceHash: expectedHash,
      sourceData,
      targetSchema: hash(JSON.stringify(knownShapes().current)),
    };
    if (existsSync(targetPath)) {
      const targetStat = lstatSync(targetPath);
      const manifestStat = lstatSync(manifestPath);
      if (
        !targetStat.isFile() ||
        targetStat.isSymbolicLink() ||
        !manifestStat.isFile() ||
        manifestStat.isSymbolicLink() ||
        (manifestStat.mode & 0o077) !== 0 ||
        JSON.stringify(JSON.parse(readFileSync(manifestPath, "utf8"))) !==
          JSON.stringify({
            ...contract,
            targetDevice: targetStat.dev.toString(),
            targetInode: targetStat.ino.toString(),
          })
      )
        throw new Error("Foreign baseline target");
      checkSqliteSchema(targetPath);
      const existing = new DatabaseSync(targetPath, { readOnly: true, readBigInts: true });
      try {
        verifyIntegrity(existing);
        if (
          sqliteDataFingerprint(existing) === sourceData &&
          hash(readFileSync(snapshotPath)) === expectedHash
        )
          return { version: 1, copied: false, sourceHash: expectedHash, dataHash: sourceData };
        if (modelNames.some((model) => existing.prepare(`SELECT 1 FROM "${model}" LIMIT 1`).get()))
          throw new Error("Baseline target changed");
      } finally {
        existing.close();
      }
    } else {
      if (existsSync(manifestPath)) throw new Error("Foreign baseline manifest");
      writeFileSync(targetPath, "", { flag: "wx", mode: 0o600 });
      const targetStat = lstatSync(targetPath);
      writeFileSync(
        manifestPath,
        JSON.stringify({
          ...contract,
          targetDevice: targetStat.dev.toString(),
          targetInode: targetStat.ino.toString(),
        }),
        { flag: "wx", mode: 0o600 }
      );
    }
    const env = { ...process.env, DATABASE_PROVIDER: "sqlite", DATABASE_URL: `file:${targetPath}` };
    delete env.DATABASE_URL_FILE;
    const migration = spawnSync(process.execPath, [resolve(root, "scripts/database-migrate.mjs")], {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 120_000,
    });
    if (migration.error || migration.status !== 0) throw new Error("Baseline migrations failed");
    checkSqliteSchema(targetPath);
    target = new DatabaseSync(targetPath, { readBigInts: true });
    const occupied = modelNames.some((model) =>
      target.prepare(`SELECT 1 FROM "${model}" LIMIT 1`).get()
    );
    if (occupied) {
      verifyIntegrity(target);
      if (sqliteDataFingerprint(target) !== sourceData) throw new Error("Baseline target changed");
      return { version: 1, copied: false, sourceHash: expectedHash, dataHash: sourceData };
    }
    target.exec("PRAGMA foreign_keys=ON; BEGIN IMMEDIATE");
    try {
      // Parent rows before FK children; unrelated model data is copied verbatim.
      for (const model of [
        "TvdbSeries",
        "TvdbEpisode",
        "Config",
        "Download",
        "EnqueueIntent",
        "GeneratedRuleset",
        "TopicCategory",
      ]) {
        if (
          model === "EnqueueIntent" &&
          !source.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(model)
        )
          continue;
        const columns = source
          .prepare(`PRAGMA table_info("${model}")`)
          .all()
          .map((row) => row.name);
        const statement = target.prepare(
          `INSERT INTO "${model}" (${columns.map((name) => `"${name}"`).join(",")}) VALUES (${columns.map(() => "?").join(",")})`
        );
        for (const row of source.prepare(`SELECT * FROM "${model}"`).iterate())
          statement.run(...columns.map((name) => row[name]));
      }
      // Preserve historical high-water marks, including deleted episode IDs.
      if (source.prepare("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").get()) {
        for (const { name, seq } of source.prepare("SELECT name,seq FROM sqlite_sequence").all()) {
          const current = target.prepare("SELECT seq FROM sqlite_sequence WHERE name=?").get(name);
          if (current && typeof seq === "bigint" && seq > current.seq)
            target.prepare("UPDATE sqlite_sequence SET seq=? WHERE name=?").run(seq, name);
          else if (
            !current &&
            typeof seq === "bigint" &&
            seq >= 0n &&
            /\bAUTOINCREMENT\b/i.test(
              target
                .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
                .get(name)?.sql ?? ""
            )
          )
            target.prepare("INSERT INTO sqlite_sequence(name,seq) VALUES (?,?)").run(name, seq);
        }
      }
      verifyIntegrity(target);
      if (
        sqliteDataFingerprint(target) !== sourceData ||
        hash(readFileSync(snapshotPath)) !== expectedHash
      )
        throw new Error("Baseline comparison failed");
      target.exec("COMMIT");
    } catch (error) {
      target.exec("ROLLBACK");
      throw error;
    }
    return { version: 1, copied: true, sourceHash: expectedHash, dataHash: sourceData };
  } finally {
    target?.close();
    source.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6 || process.argv[5] !== "--confirm-writers-stopped")
      throw new Error("Writer confirmation required");
    console.log(
      JSON.stringify(
        transitionSqliteSnapshot({
          snapshotPath: process.argv[2],
          expectedHash: process.argv[3],
          targetPath: process.argv[4],
        })
      )
    );
  } catch {
    console.error(
      "SQLite baseline transition stopped; retain source, target and manifest for review"
    );
    process.exitCode = 1;
  }
}
