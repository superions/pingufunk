import { PrismaClient } from "@prisma/client";
import { readdirSync } from "node:fs";

const prisma = new PrismaClient({ log: [] });
try {
  const expected = readdirSync("/app/prisma/migrations")
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
  console.log("PostgreSQL schema ready");
} catch {
  console.error("PostgreSQL schema unavailable or incompatible");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
