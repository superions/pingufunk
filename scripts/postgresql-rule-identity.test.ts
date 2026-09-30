import { expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";

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
    } finally {
      await pg.$disconnect();
    }
  }
);
