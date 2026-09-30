import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { loadDatabaseEnvironment } from "./load-database-environment.mjs";
import { resolveDatabaseConfig } from "./database-config.mjs";

try {
  const [command, ...args] = process.argv.slice(2);
  if (!["dev", "start"].includes(command)) throw new Error("Invalid application command");
  process.env.NODE_ENV ??= command === "dev" ? "development" : "production";
  loadDatabaseEnvironment(command === "dev");
  const config = resolveDatabaseConfig();
  process.env.DATABASE_URL = config.url;
  process.env.DATABASE_PROVIDER = config.provider;
  delete process.env.DATABASE_URL_FILE;
  if (config.provider === "sqlite") {
    const { checkSqliteSchema } = await import("./check-sqlite-schema.mjs");
    checkSqliteSchema(config.sqlitePath);
  } else {
    const { checkPostgresqlSchema } = await import("./check-postgresql-schema.mjs");
    await checkPostgresqlSchema();
  }
  process.env.PINGUFUNK_WRITES_ENABLED ??= config.provider === "sqlite" ? "1" : "0";
  if (!["0", "1"].includes(process.env.PINGUFUNK_WRITES_ENABLED))
    throw new Error("Invalid write gate");
  if (process.env.PINGUFUNK_WRITES_ENABLED === "1") process.env.PINGUFUNK_BOOT_QUEUE = "1";
  else delete process.env.PINGUFUNK_BOOT_QUEUE;
  const child = spawn(
    process.execPath,
    [resolve("node_modules/next/dist/bin/next"), command, ...args],
    { stdio: "inherit" }
  );
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", () => {
    console.error("Application process could not start");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 143);
  });
} catch {
  console.error("Application startup stopped: database configuration or schema unavailable");
  process.exitCode = 1;
}
