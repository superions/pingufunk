import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, readFileSync, readdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

/** Synthetic source only; exclusive creation never adopts a real DB. */
export function createSmokeSource(path, variant = "bootstrap") {
  if (!path || !isAbsolute(path)) throw new Error("An absolute disposable source path is required");
  if (!["bootstrap", "current"].includes(variant)) throw new Error("Unknown synthetic variant");
  closeSync(openSync(path, "wx", 0o600));
  const db = new DatabaseSync(path);
  try {
    if (variant === "bootstrap") db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
    else {
      // Execute the actual append-only source chain, never adopt a real DB ledger.
      db.exec(`CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, checksum TEXT NOT NULL,
        finished_at DATETIME, migration_name TEXT NOT NULL, logs TEXT, rolled_back_at DATETIME,
        started_at DATETIME NOT NULL, applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
      for (const name of readdirSync("prisma/legacy/sqlite/migrations")
        .filter((name) => /^\d{14}_/.test(name))
        .sort()) {
        const sql = readFileSync(`prisma/legacy/sqlite/migrations/${name}/migration.sql`, "utf8");
        db.exec(sql);
        db.prepare(
          "INSERT INTO _prisma_migrations(id,checksum,finished_at,migration_name,started_at,applied_steps_count) VALUES (?,?,?,?,?,1)"
        ).run(
          randomUUID(),
          createHash("sha256").update(sql).digest("hex"),
          Date.now(),
          name,
          Date.now()
        );
      }
    }
    db.exec(`
      INSERT INTO Config(key,value) VALUES ('smoke','source');
      INSERT INTO TvdbSeries(id,name,cachedAt,expiresAt) VALUES (7123,'Synthetic',1780228800123,1780238800123);
      INSERT INTO TvdbEpisode(id,seriesId,seasonNumber,episodeNumber,name) VALUES (37,7123,1,2,'Synthetic episode');
      INSERT INTO Download(id,title,url,category,status,createdAt,size,totalSize,downloadedBytes)
        VALUES ('smoke-download','Synthetic','https://example.invalid/video','tv','failed',1780228800123,9007199254740993,9007199254740993,1);
      INSERT INTO GeneratedRuleset(id,topic,tvdbId,showName,createdAt,updatedAt)
        VALUES ('smoke-rule','Synthetic topic',7123,'Synthetic',1780228800123,1780228800123);
      INSERT INTO TopicCategory(id,topic,category,cachedAt) VALUES ('smoke-category','Synthetic topic','tv',1780228800123);
    `);
    if (variant === "current") {
      db.prepare(
        "UPDATE Download SET mediaExpectations=?,mediaValidation=? WHERE id='smoke-download'"
      ).run(
        '{ "version":1, "duration":null, "audio":null, "resolution":null }',
        '{"version":1,"durationSeconds":2,"video":[{"width":320,"height":180}],"audioLanguages":[],"expectedChecks":{"duration":"unknown","audio":"unknown","resolution":"unknown"}}'
      );
      db.prepare(
        "INSERT INTO EnqueueIntent(id,payloadHash,downloadId,expiresAt) VALUES (?,?,?,?)"
      ).run("synthetic-intent", "synthetic-hash", "smoke-download", 1790769600123);
    }
  } finally {
    db.close();
  }
}
