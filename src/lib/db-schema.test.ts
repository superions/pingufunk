import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

function modelNames(schema: string): string[] {
  return Array.from(schema.matchAll(/^model\s+(\w+)\s+\{/gm), (match) => match[1]);
}

describe("PostgreSQL schema lineage", () => {
  it("keeps all six models in a native baseline and archives SQLite SQL separately", () => {
    const root = process.cwd();
    const schema = readFileSync(path.join(root, "prisma", "schema.prisma"), "utf-8");
    const migration = readFileSync(
      path.join(root, "prisma/migrations/20260930000000_postgresql_baseline/migration.sql"),
      "utf8"
    );
    const lock = readFileSync(path.join(root, "prisma/migrations/migration_lock.toml"), "utf8");
    const legacy = readFileSync(
      path.join(root, "prisma/legacy/sqlite/migrations/migration_lock.toml"),
      "utf8"
    );

    expect(schema).toContain('provider = "postgresql"');
    expect(lock).toContain('provider = "postgresql"');
    expect(legacy).toContain('provider = "sqlite"');
    expect(modelNames(schema)).toHaveLength(6);
    for (const model of modelNames(schema)) {
      expect(migration).toContain(`CREATE TABLE "${model}"`);
    }
    expect(migration).not.toContain("sqlite_sequence");
  });
});

const required = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const testUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (required) {
  let safe = false;
  try {
    const parsed = new URL(testUrl ?? "");
    safe =
      ["postgresql:", "postgres:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname) &&
      parsed.pathname === "/pingufunk_qa";
  } catch {
    /* Invalid or missing disposable URL. */
  }
  if (!safe) throw new Error("A loopback disposable pingufunk_qa database is required");
}

it.skipIf(!required)("checks the applied PostgreSQL catalog, types and relationships", async () => {
  process.env.DATABASE_URL = testUrl;
  const pg = new PrismaClient({ log: [] });
  try {
    const columns = await pg.$queryRaw<
      Array<{
        table_name: string;
        column_name: string;
        data_type: string;
        datetime_precision: number | null;
      }>
    >`
      SELECT table_name, column_name, data_type, datetime_precision
      FROM information_schema.columns
      WHERE table_schema = current_schema()
    `;
    const column = (table: string, field: string) =>
      columns.find((item) => item.table_name === table && item.column_name === field);
    expect(new Set(columns.map((item) => item.table_name))).toEqual(
      new Set([
        "TvdbSeries",
        "TvdbEpisode",
        "Download",
        "Config",
        "GeneratedRuleset",
        "TopicCategory",
        "_prisma_migrations",
      ])
    );
    expect(column("Download", "size")?.data_type).toBe("bigint");
    expect(column("TvdbSeries", "cachedAt")?.data_type).toBe("timestamp with time zone");
    expect(column("TvdbSeries", "cachedAt")?.datetime_precision).toBe(3);
    expect(column("Download", "createdAt")?.datetime_precision).toBe(3);
    const indexes = await pg.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()
    `;
    expect(indexes.map((item) => item.indexname)).toContain("GeneratedRuleset_topic_key");
    expect(indexes.map((item) => item.indexname)).toContain("TopicCategory_topic_key");
    const foreignKeys = await pg.$queryRaw<Array<{ conname: string; confdeltype: string }>>`
      SELECT conname, confdeltype FROM pg_constraint
      WHERE conrelid = '"TvdbEpisode"'::regclass AND contype = 'f'
    `;
    expect(foreignKeys).toEqual(
      expect.arrayContaining([{ conname: "TvdbEpisode_seriesId_fkey", confdeltype: "c" }])
    );
  } finally {
    await pg.$disconnect();
  }
});
