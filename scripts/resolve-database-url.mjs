import { lstatSync, readFileSync } from "node:fs";

function fail() {
  console.error("Invalid PostgreSQL connection configuration");
  process.exit(1);
}

try {
  const direct = process.env.DATABASE_URL;
  const file = process.env.DATABASE_URL_FILE;
  const directPresent = direct !== undefined;
  const filePresent = file !== undefined;
  if (directPresent === filePresent) fail();

  let value = direct;
  if (file) {
    if (!file.startsWith("/") || lstatSync(file).isSymbolicLink() || !lstatSync(file).isFile()) {
      fail();
    }
    const contents = readFileSync(file, "utf8");
    value = contents.endsWith("\n") ? contents.slice(0, -1) : contents;
  }

  if (!value || /[\r\n\0]/.test(value)) fail();
  const parsed = new URL(value);
  if (
    !["postgresql:", "postgres:"].includes(parsed.protocol) ||
    !parsed.hostname ||
    parsed.pathname.length < 2
  ) {
    fail();
  }
  // Prisma 6 otherwise sizes each process pool from host CPU count; its
  // socket timeout is unbounded. Bound both without guessing TLS settings.
  const limits = {
    connection_limit: [5, 20],
    connect_timeout: [5, 30],
    pool_timeout: [10, 60],
    socket_timeout: [30, 120],
  };
  for (const [key, [fallback, maximum]] of Object.entries(limits)) {
    if (!parsed.searchParams.has(key)) parsed.searchParams.set(key, String(fallback));
    if (parsed.searchParams.getAll(key).length !== 1) fail();
    const value = Number(parsed.searchParams.get(key));
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) fail();
  }
  const pgbouncer = parsed.searchParams.getAll("pgbouncer");
  if (pgbouncer.length > 1 || (pgbouncer.length === 1 && pgbouncer[0] !== "false")) fail();
  process.stdout.write(parsed.toString());
} catch {
  fail();
}
