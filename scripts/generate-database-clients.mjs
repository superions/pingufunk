import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
for (const schema of ["prisma/schema.prisma", "prisma/legacy/sqlite/schema.prisma"]) {
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/prisma/build/index.js"),
      "generate",
      "--schema",
      resolve(root, schema),
    ],
    { cwd: root, encoding: "utf8", timeout: 120_000 }
  );
  if (result.error || result.status !== 0) {
    console.error("Database client generation failed");
    process.exit(1);
  }
}
console.log("SQLite and PostgreSQL clients generated");
