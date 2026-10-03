import { DatabaseSync } from "node:sqlite";
import { lstatSync, accessSync, statfsSync, constants } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient, Prisma } from "@prisma/client";
import { postgresqlRequiresTls } from "./postgresql-transport.mjs";
import { resolveDatabaseConfig } from "./database-config.mjs";
import {
  validatePostgresqlLedger,
  validatePostgresqlStructure,
} from "./check-postgresql-schema.mjs";

import { modelNames, schemaShape, knownShapes, validateSourceLedger } from "./sqlite-schema.mjs";
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
    text: [
      "id",
      "title",
      "url",
      "category",
      "status",
      "filePath",
      "error",
      "mediaExpectations",
      "mediaValidation",
    ],
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

export function validSourceDate(value) {
  if (typeof value === "bigint") {
    // An epoch-sized integer can be seconds in the 2000s or milliseconds
    // near 1970. Refuse that ambiguous range until provenance is established.
    return (
      value >= -62135596800000n &&
      value <= 253402300799999n &&
      (value <= -100000000000n || value >= 100000000000n)
    );
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
    if (
      db.prepare("PRAGMA foreign_key_check").get() ||
      db
        .prepare(
          `
      SELECT 1 FROM TvdbEpisode e LEFT JOIN TvdbSeries s ON s.id=e.seriesId
      WHERE s.id IS NULL LIMIT 1
    `
        )
        .get()
    )
      fail("Source foreign key check failed");
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
      ledgerNames = validateSourceLedger(db, variant);
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

// Verified against the versioned Prisma 6 matrix and PostgreSQL's support
// calendar on 2026-09-30. Unknown majors require an explicit compatibility review.
export const postgresqlSupportEnds = {
  14: "2026-11-12T00:00:00Z",
  15: "2027-11-11T00:00:00Z",
  16: "2028-11-09T00:00:00Z",
  17: "2029-11-08T00:00:00Z",
  18: "2030-11-14T00:00:00Z",
};

export function assertTargetMetadata(
  target,
  expectedDatabase,
  expectedRole,
  requireTls = postgresqlRequiresTls(),
  now = Date.now()
) {
  if (target.database !== expectedDatabase || target.role !== expectedRole)
    fail("Unexpected PostgreSQL target identity");
  const end = postgresqlSupportEnds[Math.floor(target.version / 10000)];
  if (!Number.isInteger(target.version) || !end || !Number.isFinite(now) || now >= Date.parse(end))
    fail("Unsupported PostgreSQL server version");
  if (target.standby) fail("PostgreSQL target is a standby");
  if (requireTls && !target.tls) fail("PostgreSQL connection is not using TLS");
  if (!requireTls && target.tls !== false)
    fail("PostgreSQL connection does not match explicitly unencrypted transport");
  if (target.superuser || target.createdb || target.createrole)
    fail("PostgreSQL runtime role is overprivileged");
  return { version: target.version, primary: true, tls: target.tls, scopedRole: true };
}

export async function readTargetMetadata(client) {
  const [target] = await client.$queryRaw`
    SELECT current_database() AS database, current_user AS role,
      current_setting('server_version_num')::integer AS version,
      pg_is_in_recovery() AS standby,
      (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS tls,
      (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS superuser,
      (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS createdb,
      (SELECT rolcreaterole FROM pg_roles WHERE rolname = current_user) AS createrole,
      (SELECT oid::text FROM pg_database WHERE datname = current_database()) AS database_oid,
      inet_server_addr()::text AS server_address,
      inet_server_port() AS server_port, current_schema() AS schema_name,
      (SELECT oid::text FROM pg_namespace WHERE nspname=current_schema()) AS schema_oid
  `;
  return target;
}

/** Bind the actual transaction connection, not a prior pool connection. */
export async function assertConnectedTarget(
  client,
  baseline,
  database,
  role,
  requireTls = postgresqlRequiresTls()
) {
  const target = await readTargetMetadata(client);
  assertTargetMetadata(target, database, role, requireTls);
  for (const [field, key] of [
    ["database_oid", "databaseOid"],
    ["server_address", "serverAddress"],
    ["server_port", "serverPort"],
    ["schema_name", "schemaName"],
    ["schema_oid", "schemaOid"],
  ]) {
    if (target[field] !== baseline[key]) fail("PostgreSQL transaction target identity changed");
  }
}

export async function inspectTarget(
  expectedDatabase,
  expectedRole,
  expectedHost,
  requireTls = postgresqlRequiresTls()
) {
  if (!expectedDatabase || !expectedRole || !expectedHost)
    fail("Expected database, role and endpoint host are required");
  let configuredHost;
  let configuredSchema;
  try {
    const url = new URL(process.env.DATABASE_URL);
    configuredHost = url.hostname;
    if (url.searchParams.getAll("schema").length > 1 || url.searchParams.get("schema") === "")
      fail("Ambiguous PostgreSQL schema");
    configuredSchema = url.searchParams.get("schema") ?? "public";
  } catch {
    fail("PostgreSQL URL unavailable");
  }
  if (configuredHost !== expectedHost) fail("Unexpected PostgreSQL endpoint host");
  const prisma = new PrismaClient({ log: [] });
  try {
    const target = await readTargetMetadata(prisma);
    const metadata = assertTargetMetadata(target, expectedDatabase, expectedRole, requireTls);
    if (target.schema_name !== configuredSchema || !target.schema_oid)
      fail("Unexpected or unprovisioned PostgreSQL schema");
    const relations = await prisma.$queryRaw`
      SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=current_schema() AND c.relkind IN ('r','p','v','m','f','S')
    `;
    let schemaState = "empty";
    if (relations.some((relation) => relation.name === "_prisma_migrations")) {
      await validatePostgresqlLedger(prisma);
      await validatePostgresqlStructure(prisma);
      schemaState = "validated";
    } else if (relations.length !== 0) {
      fail("Unowned PostgreSQL schema is not empty");
    }
    return {
      ...metadata,
      schemaState,
      schemaName: target.schema_name,
      schemaOid: target.schema_oid,
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
    const config = resolveDatabaseConfig();
    if (config.provider !== "postgresql") fail("PostgreSQL configuration required");
    process.env.DATABASE_URL = config.url;
    delete process.env.DATABASE_URL_FILE;
    const report = {
      version: 2,
      node: process.version,
      prismaClient: Prisma.prismaVersion.client,
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
