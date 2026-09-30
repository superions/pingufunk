import { resolveDatabaseConfig } from "./database-config.mjs";

try {
  // This private stdout pipe is consumed by the entrypoint, never logged.
  process.stdout.write(resolveDatabaseConfig().url);
} catch {
  console.error("Invalid database connection configuration");
  process.exitCode = 1;
}
