import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const legacy = resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/legacy/sqlite");
export const modelNames = [
  "Config",
  "Download",
  "GeneratedRuleset",
  "TopicCategory",
  "TvdbEpisode",
  "TvdbSeries",
];
function fail(reason) {
  throw new Error(reason);
}

/** Legacy empty ledgers are valid recovery sources, not evidence of applied DDL. */
export function validateSourceLedger(db, variant) {
  const rows = db
    .prepare("SELECT migration_name,checksum,finished_at,rolled_back_at FROM _prisma_migrations")
    .all();
  if (rows.length === 0) return [];
  const migrations = resolve(legacy, "migrations");
  const known = readdirSync(migrations)
    .filter((name) => /^\d{14}_/.test(name))
    .sort();
  if (rows.some((row) => !known.includes(row.migration_name)))
    fail("Unknown SQLite migration ledger entry");
  const expected = variant === "current" ? known : known.slice(0, -1);
  const names = rows.map((row) => row.migration_name).sort();
  if (variant === "bootstrap" || JSON.stringify(names) !== JSON.stringify(expected))
    fail("SQLite source ledger incompatible with schema");
  for (const row of rows) {
    const checksum = createHash("sha256")
      .update(readFileSync(resolve(migrations, row.migration_name, "migration.sql")))
      .digest("hex");
    if (!row.finished_at || row.rolled_back_at || row.checksum !== checksum)
      fail("SQLite source migration incomplete or changed");
  }
  return names;
}

export function schemaShape(db) {
  const objects = db
    .prepare("SELECT name, type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();
  const allowed = new Set([...modelNames, "_prisma_migrations"]);
  for (const object of objects) {
    if (object.type === "table" && !allowed.has(object.name)) fail("Unknown source table");
    if (!["table", "index"].includes(object.type)) fail("Unknown source schema object");
  }
  return modelNames.map((name) => {
    if (!objects.some((object) => object.name === name && object.type === "table"))
      fail("Source model missing");
    const columns = db
      .prepare(`PRAGMA table_info("${name}")`)
      .all()
      .map(({ name: field, type, notnull, pk, dflt_value }) => [
        field,
        type.toUpperCase(),
        Number(notnull),
        Number(pk),
        dflt_value,
      ]);
    const indexes = db
      .prepare(`PRAGMA index_list("${name}")`)
      .all()
      .map(({ name: index, unique, origin, partial }) => ({
        unique: Number(unique),
        origin,
        partial: Number(partial),
        columns: db
          .prepare(`PRAGMA index_info("${index}")`)
          .all()
          .map((row) => row.name),
        keyDetails: db
          .prepare(`PRAGMA index_xinfo("${index}")`)
          .all()
          .filter((row) => Number(row.key) === 1)
          .map((row) => [row.name, Number(row.desc), row.coll]),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const foreignKeys = db
      .prepare(`PRAGMA foreign_key_list("${name}")`)
      .all()
      .map(({ table, from, to, on_delete, on_update }) => [table, from, to, on_delete, on_update]);
    return [name, columns, indexes, foreignKeys];
  });
}

export function knownShapes() {
  const bootstrap = new DatabaseSync(":memory:");
  const migrated = new DatabaseSync(":memory:");
  const current = new DatabaseSync(":memory:");
  try {
    bootstrap.exec(readFileSync(resolve(legacy, "init-db.sql"), "utf8"));
    const migrationNames = [
      "20260116132336_init",
      "20260117120853_bigint_size_fields",
      "20260708000000_add_topic_category",
    ];
    for (const name of migrationNames) {
      const sql = readFileSync(resolve(legacy, "migrations", name, "migration.sql"), "utf8");
      migrated.exec(sql);
      current.exec(sql);
    }
    current.exec(
      readFileSync(
        resolve(legacy, "migrations/20260930002000_series_topic_identity/migration.sql"),
        "utf8"
      )
    );
    return {
      bootstrap: schemaShape(bootstrap),
      migrated: schemaShape(migrated),
      current: schemaShape(current),
    };
  } finally {
    bootstrap.close();
    migrated.close();
    current.close();
  }
}
