import { lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Resolve one chosen provider; connection failures must never select another. */
export function resolveDatabaseConfig(env = process.env) {
  const selected = env.DATABASE_PROVIDER;
  if (selected !== undefined && !["sqlite", "postgresql"].includes(selected))
    throw new Error("Invalid database provider");
  const directPresent = env.DATABASE_URL !== undefined;
  const filePresent = env.DATABASE_URL_FILE !== undefined;
  if (directPresent && filePresent) throw new Error("Conflicting database configuration");
  let value = env.DATABASE_URL;
  if (filePresent) {
    const file = env.DATABASE_URL_FILE;
    if (!file || !file.startsWith("/")) throw new Error("Invalid database secret file");
    const stat = lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("Invalid database secret file");
    const contents = readFileSync(file, "utf8");
    value = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  }
  if (!directPresent && !filePresent && selected !== "postgresql")
    value = "file:./data/rundfunkarr.db";
  if (!value || /[\r\n\0]/.test(value)) throw new Error("Invalid database connection");
  // Infer from validated configuration, never from connection success. An
  // explicitly selected provider still rejects a conflicting URL protocol.
  const provider = selected ?? (value.startsWith("file:") ? "sqlite" : "postgresql");
  if (provider === "sqlite") {
    if (!value.startsWith("file:")) throw new Error("Database provider and URL disagree");
    const location = value.slice(5);
    const separator = location.indexOf("?");
    const filename = separator < 0 ? location : location.slice(0, separator);
    const parameters = separator < 0 ? undefined : location.slice(separator + 1);
    if (!filename || filename.startsWith("//") || filename === ":memory:")
      throw new Error("Invalid SQLite file configuration");
    // Preserve historical schema-relative URLs after splitting client output.
    const sqlitePath = resolve(process.cwd(), "prisma", filename);
    return {
      provider,
      url: `file:${sqlitePath}${parameters === undefined ? "" : `?${parameters}`}`,
      sqlitePath,
    };
  }
  const parsed = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  )
    throw new Error("Database provider and URL disagree");
  // Bound Prisma 6's process-local pool without assuming a proxy or TLS policy.
  const limits = {
    connection_limit: [5, 20],
    connect_timeout: [5, 30],
    pool_timeout: [10, 60],
    socket_timeout: [30, 120],
  };
  for (const [key, [fallback, maximum]] of Object.entries(limits)) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, String(fallback));
    const number = Number(parsed.searchParams.get(key));
    if (
      parsed.searchParams.getAll(key).length !== 1 ||
      !Number.isSafeInteger(number) ||
      number < 1 ||
      number > maximum
    )
      throw new Error("Invalid PostgreSQL pool configuration");
  }
  const pgbouncer = parsed.searchParams.getAll("pgbouncer");
  const schemas = parsed.searchParams.getAll("schema");
  if (schemas.length > 1 || (schemas.length === 1 && schemas[0] === ""))
    throw new Error("Invalid PostgreSQL schema configuration");
  if (pgbouncer.length > 1 || (pgbouncer.length === 1 && pgbouncer[0] !== "false"))
    throw new Error("Unsupported PostgreSQL pool mode");
  return { provider, url: parsed.toString(), sqlitePath: null };
}
