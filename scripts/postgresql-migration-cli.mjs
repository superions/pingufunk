import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { importSnapshot } from "./postgresql-import.mjs";
import { inspectTarget } from "./postgresql-preflight.mjs";
import { synchronizeOwnedSequences } from "./postgresql-verify.mjs";

const fields = new Map([
  ["--snapshot", "snapshotPath"],
  ["--sha256", "expectedHash"],
  ["--database", "database"],
  ["--role", "role"],
  ["--host", "host"],
]);

export function parseMigrationArgs(argv) {
  const action = argv[0];
  if (!["import", "verify", "sequences"].includes(action))
    throw new Error("Unknown migration action");
  const options = { action };
  let writersStopped = false;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--confirm-writers-stopped") {
      if (writersStopped) throw new Error("Duplicate confirmation");
      writersStopped = true;
      continue;
    }
    const key = fields.get(flag);
    const value = argv[++index];
    if (!key || !value || value.startsWith("--") || options[key] !== undefined)
      throw new Error("Invalid migration arguments");
    options[key] = value;
  }
  if (
    (action !== "verify" && !writersStopped) ||
    (action === "verify" && writersStopped) ||
    [...fields.values()].some((key) => !options[key])
  )
    throw new Error("Explicit target and valid writer confirmation are required");
  if (!options.snapshotPath.startsWith("/")) throw new Error("Absolute private snapshot required");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseMigrationArgs(process.argv.slice(2));
    const report = await importSnapshot({ ...options, verifyOnly: options.action !== "import" });
    let adjustedSequences = null;
    if (options.action === "sequences") {
      await inspectTarget(options.database, options.role, options.host);
      const pg = new PrismaClient({ log: [] });
      try {
        adjustedSequences = (await synchronizeOwnedSequences(pg)).adjustedSequences;
      } finally {
        await pg.$disconnect();
      }
    }
    console.log(
      JSON.stringify({
        version: 1,
        action: options.action,
        runId: report.runId,
        imported: report.imported,
        counts: report.sourceCounts,
        adjustedSequences,
      })
    );
  } catch {
    console.error("PostgreSQL import stopped; preserve snapshot, manifest and target for review");
    process.exitCode = 1;
  }
}
