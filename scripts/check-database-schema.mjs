import { resolveDatabaseConfig } from "./database-config.mjs";

try {
  const config = resolveDatabaseConfig();
  if (config.provider === "sqlite") {
    const { checkSqliteSchema } = await import("./check-sqlite-schema.mjs");
    checkSqliteSchema(config.sqlitePath);
  } else {
    process.env.DATABASE_URL = config.url;
    delete process.env.DATABASE_URL_FILE;
    const { checkPostgresqlSchema } = await import("./check-postgresql-schema.mjs");
    await checkPostgresqlSchema();
  }
  console.log(`${config.provider} schema ready`);
} catch {
  console.error(
    "Database unavailable or incompatible; apply the selected migration chain explicitly"
  );
  process.exitCode = 1;
}
