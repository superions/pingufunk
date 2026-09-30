import { PrismaClient } from "@prisma/client";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export async function checkPostgresqlSchema() {
  const prisma = new PrismaClient({ log: [] });
  try {
    const expected = readdirSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../prisma/migrations")
    )
      .filter((entry) => /^\d{14}_/.test(entry))
      .sort();
    if (expected.length === 0) throw new Error("No migration history");
    const rows = await prisma.$queryRaw`
    SELECT migration_name, finished_at, rolled_back_at
    FROM "_prisma_migrations"
  `;
    const applied = rows
      .filter((row) => row.finished_at && !row.rolled_back_at)
      .map((row) => row.migration_name)
      .sort();
    if (JSON.stringify(applied) !== JSON.stringify(expected)) {
      throw new Error("Schema migration not applied");
    }
    await prisma.config.count();
    await prisma.migrationCheckpoint.count();
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await checkPostgresqlSchema();
    console.log("PostgreSQL schema ready");
  } catch {
    console.error("PostgreSQL schema unavailable or incompatible");
    process.exitCode = 1;
  }
}
