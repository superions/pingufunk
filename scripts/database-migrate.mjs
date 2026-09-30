import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closeSync, lstatSync, openSync } from "node:fs";
import { resolveDatabaseConfig } from "./database-config.mjs";
import { loadDatabaseEnvironment } from "./load-database-environment.mjs";

try {
  loadDatabaseEnvironment(process.env.NODE_ENV !== "production");
  const config = resolveDatabaseConfig();
  if (config.provider === "sqlite") {
    // Only the explicitly invoked migrator may create a new empty source.
    // Exclusive creation never replaces existing files or follows symlinks.
    try {
      const stat = lstatSync(config.sqlitePath);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid SQLite target");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      closeSync(openSync(config.sqlitePath, "wx", 0o600));
    }
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const schema =
    config.provider === "sqlite" ? "prisma/legacy/sqlite/schema.prisma" : "prisma/schema.prisma";
  // One-shot versioned DDL; URLs stay in the child environment. Prisma
  // diagnostics can include endpoints and must not reach the operator log.
  const env = { ...process.env, DATABASE_URL: config.url };
  delete env.DATABASE_URL_FILE;
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--schema",
      resolve(root, schema),
    ],
    { cwd: root, env, encoding: "utf8", timeout: 120_000 }
  );
  if (result.error || result.status !== 0) throw new Error("Migration failed");
  console.log(`${config.provider} migrations applied`);
} catch {
  console.error(
    "Database migration stopped; preserve the database and inspect its migration state"
  );
  process.exitCode = 1;
}
