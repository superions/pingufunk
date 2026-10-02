import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transitionSqliteSnapshot } from "./sqlite-baseline.mjs";
import { checkSqliteSchema } from "./check-sqlite-schema.mjs";

const owned: string[] = [];
afterEach(() => {
  for (const dir of owned.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const hash = (file: string) => createHash("sha256").update(readFileSync(file)).digest("hex");
function fixture(variant: "bootstrap" | "migrated" | "seriesTopic" | "current") {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-baseline-"));
  owned.push(dir);
  const snapshotPath = join(dir, "snapshot.sqlite");
  const db = new DatabaseSync(snapshotPath);
  try {
    if (variant === "bootstrap") db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
    else
      for (const name of readdirSync("prisma/legacy/sqlite/migrations")
        .filter(
          (name) =>
            /^\d{14}_/.test(name) &&
            (variant === "current" ||
              (variant === "seriesTopic" ? name < "20261001" : /^20260[17]/.test(name)))
        )
        .sort())
        db.exec(readFileSync(`prisma/legacy/sqlite/migrations/${name}/migration.sql`, "utf8"));
    const instant = 1790769600123;
    db.prepare("INSERT INTO Config(key,value) VALUES (?,?)").run(
      "synthetic-secret",
      "synthetic-private-value"
    );
    db.prepare("INSERT INTO TvdbSeries(id,name,cachedAt,expiresAt) VALUES (?,?,?,?)").run(
      7,
      "Synthetic",
      instant,
      instant + 60000
    );
    db.prepare(
      "INSERT INTO TvdbEpisode(id,seriesId,seasonNumber,episodeNumber,name) VALUES (?,?,?,?,?)"
    ).run(41, 7, 2, 3, "Episode");
    db.prepare(
      "INSERT INTO Download(id,title,url,category,status,size,createdAt) VALUES (?,?,?,?,?,?,?)"
    ).run(
      "job",
      "Release",
      "https://example.invalid",
      "sonarr",
      "completed",
      BigInt("9007199254741115"),
      instant
    );
    if (variant === "current") {
      db.prepare("UPDATE Download SET mediaExpectations=?,mediaValidation=? WHERE id='job'").run(
        '{"version":1,"duration":null,"audio":null,"resolution":null}',
        '{"version":1,"durationSeconds":2,"audioLanguages":[]}'
      );
    }
    db.prepare(
      "INSERT INTO GeneratedRuleset(id,topic,tvdbId,showName,filters,createdAt,updatedAt) VALUES (?,?,?,?,?,?,?)"
    ).run("rule", "Shared", 7, "Synthetic", '[{"regex":"\\\\d+"}]', instant, instant);
    db.prepare("INSERT INTO TopicCategory(id,topic,category,cachedAt) VALUES (?,?,?,?)").run(
      "category",
      "Shared",
      "tv",
      instant
    );
    db.prepare("UPDATE sqlite_sequence SET seq=1000 WHERE name='TvdbEpisode'").run();
  } finally {
    db.close();
  }
  chmodSync(snapshotPath, 0o600);
  return { snapshotPath, expectedHash: hash(snapshotPath), targetPath: join(dir, "target.sqlite") };
}

// Real Prisma CLI startup is an integration cost, not a 5-second unit-test budget.
// Keep all preservation assertions and the migrator's subprocess bounds intact.
it.each(["bootstrap", "migrated", "seriesTopic", "current"] as const)(
  "transitions %s to a new ledger without modifying source and repeats read-only",
  (variant) => {
    const options = fixture(variant);
    const result = transitionSqliteSnapshot(options);
    expect(result.copied).toBe(true);
    expect(JSON.stringify(result)).not.toContain("synthetic-private-value");
    checkSqliteSchema(options.targetPath);
    expect(hash(options.snapshotPath)).toBe(options.expectedHash);
    const targetBefore = hash(options.targetPath);
    expect(transitionSqliteSnapshot(options).copied).toBe(false);
    expect(hash(options.targetPath)).toBe(targetBefore);
    const db = new DatabaseSync(options.targetPath, { readBigInts: true });
    try {
      expect(db.prepare("SELECT size FROM Download").get()?.size).toBe(BigInt("9007199254741115"));
      expect(db.prepare("SELECT filters FROM GeneratedRuleset").get()?.filters).toBe(
        '[{"regex":"\\\\d+"}]'
      );
      expect(
        db
          .prepare("SELECT count(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL")
          .get()?.n
      ).toBe(BigInt(5));
      const facts = db.prepare("SELECT mediaExpectations,mediaValidation FROM Download").get();
      expect(facts?.mediaExpectations).toBe(
        variant === "current"
          ? '{"version":1,"duration":null,"audio":null,"resolution":null}'
          : null
      );
      expect(facts?.mediaValidation).toBe(
        variant === "current" ? '{"version":1,"durationSeconds":2,"audioLanguages":[]}' : null
      );
      expect(
        db
          .prepare("INSERT INTO TvdbEpisode(seriesId,seasonNumber,episodeNumber) VALUES (7,2,4)")
          .run().lastInsertRowid
      ).toBe(BigInt(1001));
      db.prepare(
        "INSERT INTO GeneratedRuleset(id,topic,tvdbId,showName,updatedAt) VALUES (?,?,?,?,?)"
      ).run("other", "Shared", 8, "Other", 1790769600123);
      expect(
        db.prepare("SELECT id FROM GeneratedRuleset WHERE tvdbId=7 AND topic='Shared'").get()?.id
      ).toBe("rule");
      expect(() =>
        db
          .prepare("INSERT INTO TopicCategory(id,topic,category) VALUES ('other','Shared','movie')")
          .run()
      ).toThrow();
    } finally {
      db.close();
    }
    const changed = hash(options.targetPath);
    expect(() => transitionSqliteSnapshot(options)).toThrow("Baseline target changed");
    expect(hash(options.targetPath)).toBe(changed);
    expect(hash(options.snapshotPath)).toBe(options.expectedHash);
  },
  60_000
);

it("refuses unknown source drift before creating a target", () => {
  const options = fixture("bootstrap");
  const db = new DatabaseSync(options.snapshotPath);
  db.exec("ALTER TABLE Config ADD COLUMN foreign_field TEXT");
  db.close();
  options.expectedHash = hash(options.snapshotPath);
  expect(() => transitionSqliteSnapshot(options)).toThrow("Unknown SQLite source schema");
  expect(readdirSync(join(options.snapshotPath, ".."))).not.toContain("target.sqlite");
});

it("retains a deleted episode's high-water mark in an empty target table", () => {
  const options = fixture("bootstrap");
  const source = new DatabaseSync(options.snapshotPath);
  source.exec("DELETE FROM TvdbEpisode");
  source.close();
  options.expectedHash = hash(options.snapshotPath);
  transitionSqliteSnapshot(options);
  const target = new DatabaseSync(options.targetPath, { readBigInts: true });
  try {
    expect(
      target
        .prepare("INSERT INTO TvdbEpisode(seriesId,seasonNumber,episodeNumber) VALUES (7,2,4)")
        .run().lastInsertRowid
    ).toBe(BigInt(1001));
  } finally {
    target.close();
  }
});

it("rolls back all copied rows rather than inventing a required bootstrap value", () => {
  const options = fixture("bootstrap");
  const source = new DatabaseSync(options.snapshotPath);
  source.exec("UPDATE GeneratedRuleset SET matchingStrategy=NULL");
  source.close();
  options.expectedHash = hash(options.snapshotPath);
  expect(() => transitionSqliteSnapshot(options)).toThrow();
  expect(hash(options.snapshotPath)).toBe(options.expectedHash);
  const target = new DatabaseSync(options.targetPath);
  try {
    for (const model of [
      "TvdbSeries",
      "TvdbEpisode",
      "Config",
      "Download",
      "GeneratedRuleset",
      "TopicCategory",
    ])
      expect(target.prepare(`SELECT count(*) AS n FROM "${model}"`).get()?.n).toBe(0);
  } finally {
    target.close();
  }
});
