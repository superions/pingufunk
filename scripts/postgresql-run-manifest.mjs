import { createHash, randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPrivate(path, mode) {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (stat.mode & 0o777) !== mode)
    throw new Error("Migration artifact permissions are not private");
}

export function hasRunManifest(snapshotPath) {
  const path = join(dirname(snapshotPath), "import-manifest.json");
  try {
    assertPrivate(path, 0o600);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function prepareRunManifest(snapshotPath, identity) {
  const directory = dirname(snapshotPath);
  assertPrivate(directory, 0o700);
  assertPrivate(snapshotPath, 0o600);
  const runId = digest(JSON.stringify(identity));
  const path = join(directory, "import-manifest.json");
  let status = "pending";
  try {
    assertPrivate(path, 0o600);
    const existing = JSON.parse(readFileSync(path, "utf8"));
    if (
      existing.version !== 1 ||
      existing.runId !== runId ||
      digest(JSON.stringify(existing.identity)) !== runId ||
      !["pending", "validated"].includes(existing.status)
    )
      throw new Error("Migration manifest does not match this run");
    status = existing.status;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    writeFileSync(path, JSON.stringify({ version: 1, runId, identity, status }), {
      flag: "wx",
      mode: 0o600,
    });
  }
  return {
    runId,
    get status() {
      return status;
    },
    markValidated() {
      if (status === "validated") return;
      const temporary = join(directory, `import-manifest.${randomUUID()}.tmp`);
      writeFileSync(
        temporary,
        JSON.stringify({ version: 1, runId, identity, status: "validated" }),
        { flag: "wx", mode: 0o600 }
      );
      renameSync(temporary, path);
      status = "validated";
    },
  };
}
