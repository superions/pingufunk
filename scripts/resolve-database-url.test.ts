import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";

const script = path.join(process.cwd(), "scripts/resolve-database-url.mjs");
const disposableUrl = "postgresql://test:synthetic-only@127.0.0.1:5432/pingufunk_qa";
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function run(overrides: Record<string, string | undefined>, args: string[] = []) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_FILE;
  env.DATABASE_PROVIDER = "postgresql";
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

function secret(contents: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "pingufunk-db-secret-"));
  dirs.push(dir);
  const file = path.join(dir, "database-url");
  writeFileSync(file, contents, { mode: 0o600 });
  return file;
}

it("resolves a mounted secret with one final newline and does not log it", () => {
  const result = run({ DATABASE_URL_FILE: secret(`${disposableUrl}\n`) });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `${disposableUrl}?connection_limit=5&connect_timeout=5&pool_timeout=10&socket_timeout=30`
  );
  expect(result.stderr).toBe("");
});

it("preserves explicit pool and TLS settings without adding PgBouncer mode", () => {
  const url = `${disposableUrl}?connection_limit=3&sslmode=require&pool_timeout=4`;
  const result = run({ DATABASE_URL: url });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`${url}&connect_timeout=5&socket_timeout=30`);
  expect(result.stdout).not.toContain("pgbouncer");
});

it("preserves explicit plaintext from a mounted secret for runtime and migration", () => {
  const result = run({ DATABASE_URL_FILE: secret(`${disposableUrl}?sslmode=disable\n`) });
  expect(result.status).toBe(0);
  expect(new URL(result.stdout).searchParams.getAll("sslmode")).toEqual(["disable"]);
  expect(result.stderr).toBe("");
});

it.each([
  () => ({ DATABASE_URL: disposableUrl, DATABASE_URL_FILE: "/run/secrets/conflict" }),
  () => ({ DATABASE_URL: "", DATABASE_URL_FILE: secret(disposableUrl) }),
  () => ({ DATABASE_URL: "file:./legacy.db" }),
  () => ({ DATABASE_URL: `${disposableUrl}?pool_timeout=0` }),
  () => ({ DATABASE_URL: `${disposableUrl}?pool_timeout=5&pool_timeout=0` }),
  () => ({ DATABASE_URL: `${disposableUrl}?pgbouncer=true` }),
  () => ({ DATABASE_URL: `${disposableUrl}?schema=` }),
  () => ({ DATABASE_URL: `${disposableUrl}?schema=one&schema=two` }),
  () => ({ DATABASE_URL: `${disposableUrl}?sslmode=require&sslmode=disable` }),
  () => ({ DATABASE_URL: `${disposableUrl}?sslmode=` }),
  () => ({ DATABASE_URL: `${disposableUrl}?sslmode=unknown` }),
  () => ({ DATABASE_URL_FILE: "/missing/pingufunk" }),
  () => ({ DATABASE_URL_FILE: secret("\n") }),
  () => ({ DATABASE_URL_FILE: secret(`${disposableUrl}\nsecond-line`) }),
])("fails closed without printing a URL for invalid configuration %#", (config) => {
  const result = run(config());
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain(disposableUrl);
});

it("rejects a symlinked secret file", () => {
  const original = secret(disposableUrl);
  const link = `${original}-link`;
  symlinkSync(original, link);
  const result = run({ DATABASE_URL_FILE: link });
  rmSync(link);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
});

it("defaults to historical SQLite persistence without a PostgreSQL configuration", () => {
  const result = run({ DATABASE_PROVIDER: undefined });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(`file:${path.join(process.cwd(), "prisma/data/rundfunkarr.db")}`);
});

it("keeps legacy SQLite paths relative to the historical prisma directory", () => {
  const result = run({
    DATABASE_PROVIDER: "sqlite",
    DATABASE_URL: "file:./data/legacy.db?connection_limit=1&socket_timeout=30",
  });
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    `file:${path.join(process.cwd(), "prisma/data/legacy.db")}?connection_limit=1&socket_timeout=30`
  );
});

it.each([
  { DATABASE_PROVIDER: "sqlite", DATABASE_URL: disposableUrl },
  { DATABASE_PROVIDER: "postgresql", DATABASE_URL: "file:./data/legacy.db" },
  { DATABASE_PROVIDER: "unknown", DATABASE_URL: disposableUrl },
  { DATABASE_PROVIDER: "sqlite", DATABASE_URL: "" },
])("rejects mismatched provider selection without leaking the connection %#", (config) => {
  const result = run(config);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("Invalid database connection configuration\n");
});

it.each(["direct", "secret"])("infers PG from %s configuration without a selector", (kind) => {
  const config =
    kind === "direct"
      ? { DATABASE_URL: disposableUrl }
      : { DATABASE_URL_FILE: secret(disposableUrl) };
  const result = run({ DATABASE_PROVIDER: undefined, ...config }, ["--provider"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("postgresql");
  expect(result.stderr).toBe("");
  expect(run({ DATABASE_PROVIDER: undefined, ...config }).stdout).toContain("?connection_limit=5");
});

it.each(["direct", "secret", "absent"])("infers SQLite from %s configuration", (kind) => {
  const value = "file:./data/legacy.db";
  const config =
    kind === "direct"
      ? { DATABASE_URL: value }
      : kind === "secret"
        ? { DATABASE_URL_FILE: secret(value) }
        : {};
  const result = run({ DATABASE_PROVIDER: undefined, ...config }, ["--provider"]);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe("sqlite");
});

it.each([
  { DATABASE_URL: "" },
  { DATABASE_URL: "mysql://synthetic@localhost/db" },
  { DATABASE_URL_FILE: "/missing/synthetic" },
  { DATABASE_URL: disposableUrl, DATABASE_URL_FILE: "/missing/synthetic" },
  { DATABASE_PROVIDER: "postgresql" },
  { DATABASE_URL: "postgresql://localhost" },
])("rejects invalid inferred configuration rather than falling back %#", (config) => {
  const result = run({ DATABASE_PROVIDER: undefined, ...config }, ["--provider"]);
  expect(result.status).not.toBe(0);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("Invalid database connection configuration\n");
});
