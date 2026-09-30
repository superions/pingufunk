import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createSnapshot } from "./postgresql-snapshot.mjs";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function source() {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-snapshot-test-"));
  dirs.push(dir);
  const path = join(dir, "live.sqlite");
  const db = new DatabaseSync(path);
  db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
  return { db, path, destination: join(dir, "private-snapshot") };
}

it("backs up a live WAL source without copying a partial main file", async () => {
  const { db, path, destination } = source();
  try {
    db.exec("PRAGMA journal_mode=WAL");
    db.exec("INSERT INTO Config(key,value) VALUES ('secret','synthetic-private')");
    const report = await createSnapshot(path, destination);
    expect(report.source.walPresent).toBe(true);
    expect(report.preflight.counts.Config).toBe("1");
    expect(report.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(statSync(destination).mode & 0o777).toBe(0o700);
    expect(statSync(report.snapshotPath).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(report)).not.toContain("synthetic-private");
    await expect(createSnapshot(path, destination)).rejects.toThrow();
  } finally {
    db.close();
  }
});

it("rejects a snapshot with broken foreign keys", async () => {
  const { db, path, destination } = source();
  db.exec("PRAGMA foreign_keys=OFF");
  db.exec("INSERT INTO TvdbEpisode(seriesId,seasonNumber,episodeNumber) VALUES (77,1,1)");
  db.close();
  await expect(createSnapshot(path, destination)).rejects.toThrow("foreign key check failed");
});
