import { expect, it } from "vitest";
import { parseMigrationArgs } from "./postgresql-migration-cli.mjs";

const valid = [
  "import",
  "--snapshot",
  "/private/source.sqlite",
  "--sha256",
  "a".repeat(64),
  "--database",
  "pingufunk",
  "--role",
  "pingufunk_import",
  "--host",
  "postgres-haproxy",
  "--confirm-writers-stopped",
];

it("requires an explicit private snapshot, target and stopped writers", () => {
  expect((parseMigrationArgs(valid) as Record<string, string>).database).toBe("pingufunk");
  expect(() => parseMigrationArgs(valid.slice(0, -1))).toThrow("writer confirmation");
  expect(
    (parseMigrationArgs(["verify", ...valid.slice(1, -1)]) as Record<string, string>).action
  ).toBe("verify");
  expect(() => parseMigrationArgs(["verify", ...valid.slice(1)])).toThrow("writer confirmation");
  expect(() => parseMigrationArgs(["sequences", ...valid.slice(1, -1)])).toThrow(
    "writer confirmation"
  );
  expect(() => parseMigrationArgs(["sequences", ...valid.slice(1)])).toThrow("writer confirmation");
  expect(
    (
      parseMigrationArgs([
        "sequences",
        ...valid.slice(1),
        "--confirm-no-app-writes-since-import",
      ]) as Record<string, string>
    ).action
  ).toBe("sequences");
  expect(() => parseMigrationArgs(["unknown", ...valid.slice(1)])).toThrow(
    "Unknown migration action"
  );
  expect(() => parseMigrationArgs([...valid, "--database-url", "secret"])).toThrow(
    "Invalid migration arguments"
  );
  expect(() => parseMigrationArgs([...valid, "--role", "other"])).toThrow(
    "Invalid migration arguments"
  );
  expect(() =>
    parseMigrationArgs(
      valid.map((item) => (item === "/private/source.sqlite" ? "source.sqlite" : item))
    )
  ).toThrow("Absolute private snapshot");
});
