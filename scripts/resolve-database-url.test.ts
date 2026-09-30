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

function run(overrides: Record<string, string | undefined>) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env.DATABASE_URL;
  delete env.DATABASE_URL_FILE;
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return spawnSync(process.execPath, [script], { encoding: "utf8", env });
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

it.each([
  () => ({ DATABASE_URL: disposableUrl, DATABASE_URL_FILE: "/run/secrets/conflict" }),
  () => ({ DATABASE_URL: "", DATABASE_URL_FILE: secret(disposableUrl) }),
  () => ({ DATABASE_URL: "file:./legacy.db" }),
  () => ({ DATABASE_URL: `${disposableUrl}?pool_timeout=0` }),
  () => ({ DATABASE_URL: `${disposableUrl}?pool_timeout=5&pool_timeout=0` }),
  () => ({ DATABASE_URL: `${disposableUrl}?pgbouncer=true` }),
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
