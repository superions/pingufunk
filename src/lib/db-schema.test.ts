import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

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
