import { expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { validatePostgresqlStructure } from "./check-postgresql-schema.mjs";

const required = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const configured = process.env.PINGUFUNK_TEST_DATABASE_URL;
let url: URL | undefined;
if (required) {
  url = new URL(configured ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/pingufunk_qa"
  )
    throw new Error("Disposable loopback database required");
  url.searchParams.set("schema", "p07_identity");
}
it.skipIf(!required)(
  "migrates populated PostgreSQL rules without changing IDs or payloads",
  async () => {
    // The harness owns this isolated schema, never public or an existing installation.
    const pg = new PrismaClient({ datasourceUrl: url!.href, log: [] });
    try {
      for (const name of ["20260930000000_postgresql_baseline", "20260930001000_write_boundary"]) {
        for (const statement of readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8")
          .replace(/^--.*$/gm, "")
          .split(";")
          .filter((sql) => sql.trim()))
          await pg.$executeRawUnsafe(statement);
      }
      const original = await pg.generatedRuleset.create({
        data: {
          id: "original-p07-rule",
          topic: "Shared catalogue",
          tvdbId: 7,
          showName: "Series one",
          filters: '[{"regex":"\\\\d+"}]',
          episodeRegex: "original-regex",
          createdAt: new Date("2026-09-30T12:00:00.123Z"),
        },
      });
      await expect(
        pg.generatedRuleset.create({
          data: { topic: original.topic, tvdbId: 8, showName: "Series two" },
        })
      ).rejects.toThrow();
      for (const statement of readFileSync(
        "prisma/migrations/20260930002000_series_topic_identity/migration.sql",
        "utf8"
      )
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((sql) => sql.trim()))
        await pg.$executeRawUnsafe(statement);
      expect(await pg.generatedRuleset.findUnique({ where: { id: original.id } })).toEqual(
        original
      );
      const second = await pg.generatedRuleset.create({
        data: { topic: original.topic, tvdbId: 8, showName: "Series two" },
      });
      expect(
        (
          await pg.generatedRuleset.findUnique({
            where: { tvdbId_topic: { tvdbId: 7, topic: original.topic } },
          })
        )?.id
      ).toBe(original.id);
      expect(
        (
          await pg.generatedRuleset.findUnique({
            where: { tvdbId_topic: { tvdbId: 8, topic: original.topic } },
          })
        )?.id
      ).toBe(second.id);
      await expect(
        pg.generatedRuleset.create({
          data: { topic: original.topic, tvdbId: 7, showName: "Duplicate" },
        })
      ).rejects.toThrow();
      await pg.topicCategory.create({ data: { topic: original.topic, category: "tv" } });
      await expect(
        pg.topicCategory.create({ data: { topic: original.topic, category: "movie" } })
      ).rejects.toThrow();
      // The catalog gate checks the current client, including later additive P09 DDL.
      for (const statement of readFileSync(
        "prisma/migrations/20261001000000_media_validation/migration.sql",
        "utf8"
      )
        .replace(/^--.*$/gm, "")
        .split(";")
        .filter((sql) => sql.trim()))
        await pg.$executeRawUnsafe(statement);
      await validatePostgresqlStructure(pg);
      const driftCases = [
        ["CREATE SEQUENCE synthetic_orphan_sequence", "DROP SEQUENCE synthetic_orphan_sequence"],
        [
          'ALTER TABLE "Config" ALTER COLUMN "value" TYPE VARCHAR(255)',
          'ALTER TABLE "Config" ALTER COLUMN "value" TYPE TEXT',
        ],
        [
          'ALTER TABLE "Config" ADD COLUMN synthetic_extra TEXT',
          'ALTER TABLE "Config" DROP COLUMN synthetic_extra',
        ],
        [
          'ALTER TABLE "Config" ENABLE ROW LEVEL SECURITY',
          'ALTER TABLE "Config" DISABLE ROW LEVEL SECURITY',
        ],
        [
          'ALTER TABLE "Download" ALTER COLUMN "size" SET DEFAULT 99',
          'ALTER TABLE "Download" ALTER COLUMN "size" SET DEFAULT 0',
        ],
        [
          'ALTER TABLE "Config" ALTER COLUMN "value" DROP NOT NULL',
          'ALTER TABLE "Config" ALTER COLUMN "value" SET NOT NULL',
        ],
        [
          'CREATE INDEX synthetic_extra_index ON "Config" (value)',
          "DROP INDEX synthetic_extra_index",
        ],
        [
          'ALTER TABLE "TvdbEpisode" DROP CONSTRAINT "TvdbEpisode_seriesId_fkey"',
          'ALTER TABLE "TvdbEpisode" ADD CONSTRAINT "TvdbEpisode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TvdbSeries"(id) ON DELETE CASCADE ON UPDATE CASCADE',
        ],
        ["CREATE TABLE synthetic_foreign_table (id INTEGER)", "DROP TABLE synthetic_foreign_table"],
      ];
      for (const [inject, restore] of driftCases) {
        await pg.$executeRawUnsafe(inject);
        try {
          await expect(validatePostgresqlStructure(pg)).rejects.toThrow("drift");
        } finally {
          await pg.$executeRawUnsafe(restore);
        }
        await validatePostgresqlStructure(pg);
      }
    } finally {
      await pg.$disconnect();
    }
  }
);
