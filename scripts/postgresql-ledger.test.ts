import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { expect, it } from "vitest";
import { validatePostgresqlLedger } from "./check-postgresql-schema.mjs";

function ledger() {
  return readdirSync("prisma/migrations")
    .filter((name) => /^\d{14}_/.test(name))
    .sort()
    .map((name) => ({
      migration_name: name,
      checksum: createHash("sha256")
        .update(readFileSync(`prisma/migrations/${name}/migration.sql`))
        .digest("hex"),
      finished_at: new Date("2026-09-30T00:00:00Z"),
      rolled_back_at: null as Date | null,
    }));
}

it("accepts the exact completed native chain and explicitly rolled-back known attempts", async () => {
  const rows = ledger();
  const query = { $queryRaw: async () => rows };
  expect(await validatePostgresqlLedger(query)).toEqual(rows.map((row) => row.migration_name));
  rows.push({ ...rows[0], rolled_back_at: new Date() });
  expect(await validatePostgresqlLedger(query)).toHaveLength(rows.length - 1);
});

it("rejects tampering, pending extra attempts, missing and unknown entries", async () => {
  const cases = [
    ledger().map((row, i) => (i === 0 ? { ...row, checksum: "tampered" } : row)),
    [...ledger(), { ...ledger()[0], finished_at: null }],
    ledger().slice(1),
    [...ledger(), { ...ledger()[0], migration_name: "foreign" }],
  ];
  for (const rows of cases)
    await expect(validatePostgresqlLedger({ $queryRaw: async () => rows })).rejects.toThrow();
});
