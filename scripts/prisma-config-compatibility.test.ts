import { afterEach, expect, it } from "vitest";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { loadConfigFromFile } from "@prisma/config";

const owned: string[] = [];
afterEach(() => {
  for (const directory of owned.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("loads actual Prisma 6 configuration with the scoped merge override", async () => {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "pingufunk-prisma-config-")));
  owned.push(directory);
  writeFileSync(
    join(directory, "prisma.config.mjs"),
    'export default { schema: "schema.prisma", migrations: { path: "migrations", seed: "node seed.mjs" } };'
  );
  // Exercise Prisma's real c12/merger path, not only the package's export shape.
  const result = await loadConfigFromFile({ configRoot: directory });
  expect(result.error).toBeUndefined();
  expect(result.config?.schema).toBe(join(directory, "schema.prisma"));
  expect(result.config?.migrations).toMatchObject({
    path: join(directory, "migrations"),
    seed: "node seed.mjs",
  });
}, 15_000);

it("merges recursive records without stack exhaustion in Prisma's resolved dependency", () => {
  const require = createRequire(import.meta.url);
  const prismaRequire = createRequire(require.resolve("@prisma/config"));
  const { deepmerge } = prismaRequire("deepmerge-ts") as {
    deepmerge: (...values: Record<string, unknown>[]) => Record<string, unknown>;
  };
  const left: Record<string, unknown> = { left: true };
  const right: Record<string, unknown> = { right: true };
  left.self = left;
  right.self = right;
  const merged = deepmerge(left, right);
  expect(merged).toMatchObject({ left: true, right: true });
  expect(merged.self).toBe(merged);
});
