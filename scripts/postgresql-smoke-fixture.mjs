import { DatabaseSync } from "node:sqlite";
import { closeSync, openSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

/** Synthetic six-model source only; exclusive creation never adopts a real DB. */
export function createSmokeSource(path) {
  if (!path || !isAbsolute(path)) throw new Error("An absolute disposable source path is required");
  closeSync(openSync(path, "wx", 0o600));
  const db = new DatabaseSync(path);
  try {
    db.exec(readFileSync("prisma/legacy/sqlite/init-db.sql", "utf8"));
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
  } finally {
    db.close();
  }
}
