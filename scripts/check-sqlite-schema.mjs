import { DatabaseSync } from "node:sqlite";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { schemaShape, knownShapes } from "./sqlite-schema.mjs";

/** Validate shipped SQLite schemas without DDL or adopting a legacy ledger. */
export function checkSqliteSchema(filename) {
  const stat = lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("SQLite file unavailable");
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON");
    const actual = JSON.stringify(schemaShape(db));
    if (!Object.values(knownShapes()).some((shape) => JSON.stringify(shape) === actual))
      throw new Error("SQLite schema incompatible");
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (
      integrity.length !== 1 ||
      integrity[0].quick_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()
    )
      throw new Error("SQLite integrity check failed");
    const migrations = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../prisma/legacy/sqlite/migrations"
    );
    const expected = readdirSync(migrations)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const rows = db
      .prepare(
        'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations"'
      )
      .all();
    // Historical container bootstrap creates an empty ledger. Its complete
    // schema is valid; do not manufacture applied migrations or rewrite data.
    if (rows.length > 0) {
      const names = rows.map((row) => row.migration_name).sort();
      if (JSON.stringify(names) !== JSON.stringify(expected))
        throw new Error("SQLite ledger incompatible");
      for (const row of rows) {
        const checksum = createHash("sha256")
          .update(readFileSync(resolve(migrations, row.migration_name, "migration.sql")))
          .digest("hex");
        if (!row.finished_at || row.rolled_back_at || row.checksum !== checksum)
          throw new Error("SQLite migration incomplete or changed");
      }
    }
  } finally {
    db.close();
  }
}
