import { resolveDatabaseConfig } from "./database-config.mjs";

try {
  // This private stdout pipe is consumed by the entrypoint, never logged.
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && args[0] !== "--provider"))
    throw new Error("Invalid resolver option");
  const config = resolveDatabaseConfig();
  process.stdout.write(args.length === 1 ? config.provider : config.url);
} catch {
  console.error("Invalid database connection configuration");
  process.exitCode = 1;
}
