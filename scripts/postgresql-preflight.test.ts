import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { inspectSource } from "./postgresql-preflight.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function source(sqlFiles: string[], extra = "") {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-preflight-"));
  dirs.push(dir);
  const path = join(dir, "source.sqlite");
  const db = new DatabaseSync(path);
  try {
    for (const sqlFile of sqlFiles) db.exec(readFileSync(resolve(sqlFile), "utf8"));
    db.exec(extra);
  } finally {
    db.close();
  }
  return path;
}

const legacy = "prisma/legacy/sqlite";
const migrations = [
  `${legacy}/migrations/20260116132336_init/migration.sql`,
  `${legacy}/migrations/20260117120853_bigint_size_fields/migration.sql`,
  `${legacy}/migrations/20260708000000_add_topic_category/migration.sql`,
];

it("recognizes the historic bootstrap without reading sensitive payloads into its report", () => {
  const path = source(
    [`${legacy}/init-db.sql`],
    "INSERT INTO Config(key,value) VALUES ('token','private-value')"
  );
  const report = inspectSource(path);
  expect(report.variant).toBe("bootstrap");
  expect(report.counts.Config).toBe("1");
  expect(JSON.stringify(report)).not.toContain("private-value");
});

it("recognizes the completed Prisma SQLite chain", () => {
  const report = inspectSource(source(migrations));
  expect(report.variant).toBe("migrated");
  expect(report.counts.Download).toBe("0");
});

it("rejects unknown columns and tables", () => {
  expect(() =>
    inspectSource(source([`${legacy}/init-db.sql`], "ALTER TABLE Config ADD COLUMN surprise TEXT"))
  ).toThrow("Unrecognized SQLite source schema");
  expect(() =>
    inspectSource(source([`${legacy}/init-db.sql`], "CREATE TABLE SecretExtra(id INTEGER)"))
  ).toThrow("Unknown source table");
});

it("rejects an unknown legacy migration ledger entry", () => {
  const path = source(
    [`${legacy}/init-db.sql`],
    `
    INSERT INTO _prisma_migrations(id,checksum,migration_name)
    VALUES ('synthetic','synthetic','foreign_migration');
  `
  );
  expect(() => inspectSource(path)).toThrow("Unknown SQLite migration ledger entry");
});

it("rejects ambiguous timestamps and preserves large integer evidence", () => {
  const path = source(
    [`${legacy}/init-db.sql`],
    `
    INSERT INTO Download(id,title,url,category,createdAt,size)
    VALUES ('a','a','https://example.invalid','tv','2026-09-30 12:00:00',9007199254740993);
  `
  );
  expect(() => inspectSource(path)).toThrow("Ambiguous timestamp in Download.createdAt");
  const db = new DatabaseSync(path);
  db.exec("UPDATE Download SET createdAt='2026-09-30T12:00:00.123Z' WHERE id='a'");
  db.close();
  expect(
    (inspectSource(path).dateRepresentations as Record<string, string>)["Download.createdAt"]
  ).toBe("iso-offset");
});

it("does not change the SQLite database or sidecars during a WAL preflight", () => {
  const path = source([`${legacy}/init-db.sql`]);
  const writer = new DatabaseSync(path);
  try {
    writer.exec("PRAGMA journal_mode=WAL");
    writer.exec("INSERT INTO Config(key,value) VALUES ('token','private')");
    const files = [path, `${path}-wal`, `${path}-shm`].filter(existsSync);
    const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
    const before = files.map(hash);
    expect(() => inspectSource(path)).toThrow("WAL source needs a consistent backup snapshot");
    expect(files.map(hash)).toEqual(before);
  } finally {
    writer.close();
  }
});
