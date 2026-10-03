import { afterEach, expect, it, vi } from "vitest";
import { postgresqlRequiresTls } from "./postgresql-transport.mjs";
import { assertConnectedTarget, assertTargetMetadata } from "./postgresql-preflight.mjs";

const url = "postgresql://synthetic:private-test-value@127.0.0.1/qa";
const target = {
  database: "qa",
  role: "runtime",
  version: 170000,
  standby: false,
  tls: false,
  superuser: false,
  createdb: false,
  createrole: false,
  database_oid: "41",
  server_address: "127.0.0.1",
  server_port: 5432,
  schema_name: "public",
  schema_oid: "2200",
};
const baseline = {
  databaseOid: "41",
  serverAddress: "127.0.0.1",
  serverPort: 5432,
  schemaName: "public",
  schemaOid: "2200",
};
afterEach(() => vi.unstubAllEnvs());

it("requires TLS by default and never downgrades after a failed connection", () => {
  vi.stubEnv("DATABASE_URL", url);
  expect(postgresqlRequiresTls()).toBe(true);
  expect(() => assertTargetMetadata(target, "qa", "runtime")).toThrow("not using TLS");
  expect(postgresqlRequiresTls(`${url}?sslmode=require`)).toBe(true);
});

it("accepts explicit plaintext while preserving identity, role and primary checks", async () => {
  vi.stubEnv("DATABASE_URL", `${url}?sslmode=disable`);
  expect(postgresqlRequiresTls()).toBe(false);
  expect(assertTargetMetadata(target, "qa", "runtime").tls).toBe(false);
  await expect(
    assertConnectedTarget({ $queryRaw: async () => [target] }, baseline, "qa", "runtime")
  ).resolves.toBeUndefined();
  for (const changed of [{ standby: true }, { superuser: true }, { database: "foreign" }])
    expect(() => assertTargetMetadata({ ...target, ...changed }, "qa", "runtime")).toThrow();
  await expect(
    assertConnectedTarget(
      { $queryRaw: async () => [{ ...target, schema_oid: "99" }] },
      baseline,
      "qa",
      "runtime"
    )
  ).rejects.toThrow("target identity changed");
  expect(() => assertTargetMetadata({ ...target, tls: true }, "qa", "runtime")).toThrow(
    "explicitly unencrypted transport"
  );
});

it.each(["prefer", "", "unknown", "require&sslmode=disable"])(
  "rejects ambiguous/downgrade mode %s without leaking the URL",
  (mode) => {
    expect(() => postgresqlRequiresTls(`${url}?sslmode=${mode}`)).toThrow(
      "Invalid PostgreSQL migration transport configuration"
    );
  }
);
