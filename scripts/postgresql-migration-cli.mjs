import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { DatabaseSync } from "node:sqlite";
import { importSnapshot } from "./postgresql-import.mjs";
import { assertConnectedTarget } from "./postgresql-preflight.mjs";
import { synchronizeOwnedSequences } from "./postgresql-verify.mjs";
import { preparePostgresqlTarget } from "./postgresql-prepare.mjs";
import { resolveDatabaseConfig } from "./database-config.mjs";

const fields = new Map([
  ["--snapshot", "snapshotPath"],
  ["--sha256", "expectedHash"],
  ["--database", "database"],
  ["--role", "role"],
  ["--host", "host"],
]);

export function parseMigrationArgs(argv) {
  const action = argv[0];
  if (!["prepare", "import", "verify", "sequences"].includes(action))
    throw new Error("Unknown migration action");
  const options = { action };
  let writersStopped = false;
  let noApplicationWrites = false;
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === "--confirm-writers-stopped") {
      if (writersStopped) throw new Error("Duplicate confirmation");
      writersStopped = true;
      continue;
    }
    if (flag === "--confirm-no-app-writes-since-import") {
      if (noApplicationWrites) throw new Error("Duplicate confirmation");
      noApplicationWrites = true;
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
    (action === "sequences" && !noApplicationWrites) ||
    (action !== "sequences" && noApplicationWrites) ||
    [...fields.values()].some((key) => !options[key])
  )
    throw new Error("Explicit target and valid writer confirmation are required");
  if (!options.snapshotPath.startsWith("/")) throw new Error("Absolute private snapshot required");
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseMigrationArgs(process.argv.slice(2));
    const config = resolveDatabaseConfig();
    if (config.provider !== "postgresql") throw new Error("PostgreSQL configuration required");
    process.env.DATABASE_URL = config.url;
    process.env.DATABASE_PROVIDER = config.provider;
    delete process.env.DATABASE_URL_FILE;
    if (options.action === "prepare") {
      const report = await preparePostgresqlTarget(options);
      console.log(
        JSON.stringify({
          version: 1,
          action: "prepare",
          prepared: report.prepared,
          counts: report.sourceCounts,
        })
      );
      process.exitCode = 0;
    } else {
      const report = await importSnapshot({ ...options, verifyOnly: options.action !== "import" });
      let adjustedSequences = null;
      if (options.action === "sequences") {
        const pg = new PrismaClient({ log: [] });
        const sqlite = new DatabaseSync(options.snapshotPath, {
          readOnly: true,
          readBigInts: true,
        });
        try {
          adjustedSequences = await pg.$transaction(
            async (tx) => {
              await assertConnectedTarget(tx, report.target, options.database, options.role);
              return (await synchronizeOwnedSequences(tx, sqlite)).adjustedSequences;
            },
            { timeout: 60_000 }
          );
        } finally {
          sqlite.close();
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
    }
  } catch {
    console.error("PostgreSQL import stopped; preserve snapshot, manifest and target for review");
    process.exitCode = 1;
  }
}
