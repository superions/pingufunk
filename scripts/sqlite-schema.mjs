import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
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
      .map(({ name: field, type, notnull, pk }) => [
        field,
        type.toUpperCase(),
        Number(notnull),
        Number(pk),
      ]);
    const indexes = db
      .prepare(`PRAGMA index_list("${name}")`)
      .all()
      .map(({ name: index, unique, origin }) => ({
        unique: Number(unique),
        origin,
        columns: db
          .prepare(`PRAGMA index_info("${index}")`)
          .all()
          .map((row) => row.name),
      }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    const foreignKeys = db
      .prepare(`PRAGMA foreign_key_list("${name}")`)
      .all()
      .map(({ table, from, to, on_delete }) => [table, from, to, on_delete]);
    return [name, columns, indexes, foreignKeys];
  });
}

export function knownShapes() {
  const bootstrap = new DatabaseSync(":memory:");
  const migrated = new DatabaseSync(":memory:");
  try {
    bootstrap.exec(readFileSync(resolve(legacy, "init-db.sql"), "utf8"));
    const migrationNames = [
      "20260116132336_init",
      "20260117120853_bigint_size_fields",
      "20260708000000_add_topic_category",
    ];
    for (const name of migrationNames) {
      migrated.exec(readFileSync(resolve(legacy, "migrations", name, "migration.sql"), "utf8"));
    }
    return { bootstrap: schemaShape(bootstrap), migrated: schemaShape(migrated) };
  } finally {
    bootstrap.close();
    migrated.close();
  }
}
