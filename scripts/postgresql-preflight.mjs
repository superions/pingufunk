import { DatabaseSync } from "node:sqlite";
import { readFileSync, lstatSync, accessSync, statfsSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const modelNames = [
  "Config",
  "Download",
  "GeneratedRuleset",
  "TopicCategory",
  "TvdbEpisode",
  "TvdbSeries",
];
const legacy = resolve(root, "prisma/legacy/sqlite");
export const sourceFieldContract = {
  TvdbSeries: {
    int: ["id"],
    text: ["name", "germanName", "slug", "overview", "aliases"],
    date: ["firstAired", "cachedAt", "expiresAt"],
    required: ["id", "name", "cachedAt", "expiresAt"],
  },
  TvdbEpisode: {
    int: ["id", "seriesId", "seasonNumber", "episodeNumber", "runtime"],
    text: ["name"],
    date: ["aired"],
    required: ["id", "seriesId", "seasonNumber", "episodeNumber"],
  },
  Download: {
    int: ["progress"],
    bigint: ["size", "totalSize", "downloadedBytes", "speed"],
    text: ["id", "title", "url", "category", "status", "filePath", "error"],
    date: ["createdAt", "completedAt"],
    required: [
      "id",
      "title",
      "url",
      "category",
      "status",
      "progress",
      "size",
      "totalSize",
      "downloadedBytes",
      "speed",
      "createdAt",
    ],
  },
  Config: { text: ["key", "value"], required: ["key", "value"] },
  GeneratedRuleset: {
    int: ["tvdbId"],
    text: [
      "id",
      "topic",
      "showName",
      "germanName",
      "matchingStrategy",
      "filters",
      "episodeRegex",
      "seasonRegex",
      "titleRegexRules",
    ],
    date: ["createdAt", "updatedAt"],
    required: [
      "id",
      "topic",
      "tvdbId",
      "showName",
      "matchingStrategy",
      "filters",
      "episodeRegex",
      "seasonRegex",
      "titleRegexRules",
      "createdAt",
      "updatedAt",
    ],
  },
  TopicCategory: {
    int: ["tmdbId"],
    text: ["id", "topic", "category"],
    date: ["cachedAt"],
    required: ["id", "topic", "category", "cachedAt"],
  },
};

function fail(reason) {
  throw new Error(reason);
}

function schemaShape(db) {
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

function knownShapes() {
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

export function validSourceDate(value) {
  if (typeof value === "bigint") {
    // SQLite/Prisma integer timestamps are Unix milliseconds, never seconds.
    return value >= -62135596800000n && value <= 253402300799999n;
  }
  if (typeof value !== "string") return false;
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(
    value
  );
  if (!match) return false;
  const local = Date.parse(`${match[1]}T${match[2]}Z`);
  const milliseconds = Date.parse(value);
  return (
    Number.isFinite(milliseconds) &&
    Number.isFinite(local) &&
    new Date(local).toISOString().startsWith(`${match[1]}T${match[2]}`)
  );
}

function inspectValues(db) {
  const dateRepresentations = {};
  for (const [model, contract] of Object.entries(sourceFieldContract)) {
    const columns = new Set(Object.values(contract).flat());
    for (const row of db.prepare(`SELECT * FROM "${model}"`).iterate()) {
      for (const [field, value] of Object.entries(row)) {
        if (!columns.has(field)) fail("Uncontracted source field");
        if (value === null) {
          if (contract.required.includes(field)) fail(`Null value in required ${model}.${field}`);
          continue;
        }
        if (
          contract.int?.includes(field) &&
          (typeof value !== "bigint" || value < -2147483648n || value > 2147483647n)
        )
          fail(`Invalid int32 in ${model}.${field}`);
        if (contract.bigint?.includes(field) && typeof value !== "bigint")
          fail(`Invalid int64 in ${model}.${field}`);
        if (contract.text?.includes(field) && (typeof value !== "string" || value.includes("\0")))
          fail(`Invalid text in ${model}.${field}`);
        if (contract.date?.includes(field)) {
          if (!validSourceDate(value)) fail(`Ambiguous timestamp in ${model}.${field}`);
          const key = `${model}.${field}`;
          const kind = typeof value === "bigint" ? "unix-ms" : "iso-offset";
          const old = dateRepresentations[key];
          if (old && old !== kind) fail(`Mixed timestamp representations in ${key}`);
          dateRepresentations[key] = kind;
        }
      }
    }
  }
  return dateRepresentations;
}

export function inspectLocation(sourcePath) {
  if (!sourcePath || !sourcePath.startsWith("/")) fail("Absolute source path required");
  const sourceStat = lstatSync(sourcePath, { bigint: true });
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink())
    fail("Source must be a regular, non-symlink file");
  accessSync(sourcePath, constants.R_OK);
  const filesystem = statfsSync(dirname(sourcePath), { bigint: true });
  return {
    sourcePath,
    sourceDevice: sourceStat.dev.toString(),
    sourceInode: sourceStat.ino.toString(),
    sourceBytes: sourceStat.size.toString(),
    filesystemType: filesystem.type.toString(),
    freeBytes: (filesystem.bavail * filesystem.bsize).toString(),
    walPresent: exists(`${sourcePath}-wal`),
    shmPresent: exists(`${sourcePath}-shm`),
  };
}

export function inspectSource(sourcePath) {
  const location = inspectLocation(sourcePath);
  // SQLite read-only connections still update WAL shared-memory lock bytes.
  // Inventory a live WAL separately, then inspect the consistent backup snapshot.
  if (location.walPresent || location.shmPresent)
    fail("WAL source needs a consistent backup snapshot before schema inspection");
  const db = new DatabaseSync(sourcePath, { readOnly: true, readBigInts: true });
  try {
    db.exec("PRAGMA query_only=ON");
    const actual = JSON.stringify(schemaShape(db));
    const expected = knownShapes();
    const variant = Object.entries(expected).find(
      ([, shape]) => JSON.stringify(shape) === actual
    )?.[0];
    if (!variant) fail("Unrecognized SQLite source schema");
    const dateRepresentations = inspectValues(db);
    const integrity = db.prepare("PRAGMA quick_check").all();
    if (integrity.length !== 1 || integrity[0].quick_check !== "ok")
      fail("Source quick check failed");
    const journalMode = db.prepare("PRAGMA journal_mode").get().journal_mode;
    const counts = Object.fromEntries(
      modelNames.map((name) => [
        name,
        db.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get().count.toString(),
      ])
    );
    const ledger = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_prisma_migrations'")
      .get();
    let ledgerNames = [];
    if (ledger) {
      ledgerNames = db
        .prepare("SELECT migration_name FROM _prisma_migrations")
        .all()
        .map((row) => row.migration_name);
      const historical = new Set([
        "20260116132336_init",
        "20260117120853_bigint_size_fields",
        "20260708000000_add_topic_category",
      ]);
      if (ledgerNames.some((name) => !historical.has(name)))
        fail("Unknown SQLite migration ledger entry");
    }
    return {
      variant,
      journalMode,
      ...location,
      ledgerPresent: Boolean(ledger),
      ledgerNames,
      counts,
      dateRepresentations,
    };
  } finally {
    db.close();
  }
}

function exists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function assertTargetMetadata(target, expectedDatabase, expectedRole, requireTls = true) {
  if (target.database !== expectedDatabase || target.role !== expectedRole)
    fail("Unexpected PostgreSQL target identity");
  // Prisma 6's supported server range is checked before any target write.
  if (target.version < 90600 || target.version >= 190000)
    fail("Unsupported PostgreSQL server version");
  if (target.standby) fail("PostgreSQL target is a standby");
  if (requireTls && !target.tls) fail("PostgreSQL connection is not using TLS");
  if (target.superuser || target.createdb || target.createrole)
    fail("PostgreSQL runtime role is overprivileged");
  return { version: target.version, primary: true, tls: target.tls, scopedRole: true };
}

export async function inspectTarget(
  expectedDatabase,
  expectedRole,
  expectedHost,
  requireTls = true
) {
  if (!expectedDatabase || !expectedRole || !expectedHost)
    fail("Expected database, role and endpoint host are required");
  let configuredHost;
  try {
    configuredHost = new URL(process.env.DATABASE_URL).hostname;
  } catch {
    fail("PostgreSQL URL unavailable");
  }
  if (configuredHost !== expectedHost) fail("Unexpected PostgreSQL endpoint host");
  const prisma = new PrismaClient({ log: [] });
  try {
    const [target] = await prisma.$queryRaw`
      SELECT current_database() AS database, current_user AS role,
        current_setting('server_version_num')::integer AS version,
        pg_is_in_recovery() AS standby,
        (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
        (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS createdb,
        (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS createrole,
        (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
        inet_server_addr()::text AS server_address,
        inet_server_port() AS server_port
    `;
    return {
      ...assertTargetMetadata(target, expectedDatabase, expectedRole, requireTls),
      databaseOid: target.database_oid,
      serverAddress: target.server_address,
      serverPort: target.server_port,
      endpointMatchesExpected: true,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 6) fail("Expected source, database, role and endpoint host");
    const [source, database, role, endpointHost] = process.argv.slice(2);
    const report = {
      version: 1,
      node: process.version,
      source: inspectSource(source),
      target: await inspectTarget(database, role, endpointHost),
    };
    console.log(JSON.stringify(report));
  } catch {
    console.error(
      "Read-only migration preflight failed; inspect source schema, target identity and connectivity"
    );
    process.exitCode = 1;
  }
}
