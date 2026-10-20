import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";
import type { MatchedEpisodeInfo } from "@/types";

const enabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (enabled) {
  const url = new URL(pgUrl ?? "");
  if (
    !/^(postgres|postgresql):$/.test(url.protocol) ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.pathname !== "/pingufunk_qa"
  )
    throw new Error("Disposable loopback PostgreSQL required");
}
let directory: string | undefined;
let disconnect: (() => Promise<void>) | undefined;
afterEach(async () => {
  await disconnect?.();
  disconnect = undefined;
  delete (globalThis as { prisma?: unknown }).prisma;
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("pingufunk.tv-search-delivery.v1")];
  delete (globalThis as Record<symbol, unknown>)[Symbol.for("pingufunk.source-media-facts.v1")];
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !enabled)(
    `persists discovery/readiness but not stale proof across actual ${provider} connections`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-tv-delivery-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p06_delivery");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_url: string, init: RequestInit) => {
          const response = mp4RangeResponse(syntheticMp4(), init);
          response.headers.set("etag", '"synthetic"');
          return response;
        })
      );
      const migration = spawnSync(
        process.execPath,
        [path.resolve("scripts/database-migrate.mjs")],
        { env: process.env, encoding: "utf8", timeout: 30_000 }
      );
      expect(migration.status).toBe(0);
      vi.resetModules();
      const { prisma } = await import("@/lib/db");
      disconnect = () => prisma.$disconnect();
      const { TvSearchDeliveryJournal, TV_DELIVERY_KEY, tvSearchDelivery } =
        await import("@/services/tv-search-delivery");
      tvSearchDelivery.dispose();
      const { SourceMediaFactsStore } = await import("@/services/source-media-facts");
      const repository = {
        read: async () =>
          (await prisma.config.findUnique({ where: { key: TV_DELIVERY_KEY } }))?.value ?? null,
        write: async (value: string) => {
          await prisma.config.upsert({
            where: { key: TV_DELIVERY_KEY },
            create: { key: TV_DELIVERY_KEY, value },
            update: { value },
          });
        },
      };
      let facts = new SourceMediaFactsStore(),
        journal = new TvSearchDeliveryJournal(repository, facts);
      const scope = "a".repeat(64),
        source = "https://rodlzdf-a.akamaihd.net/synthetic/runtime.mp4";
      const show = {
        id: 123,
        name: "Synthetic Series",
        germanName: null,
        aliases: [],
        episodes: [],
        sonarrMonitoredCoordinates: ["1:1"],
      };
      const match: MatchedEpisodeInfo = {
        showName: show.name,
        matchedTitle: "Synthetic",
        tvdbId: 123,
        episode: {
          seasonNumber: 1,
          episodeNumber: 1,
          name: "Synthetic",
          aired: new Date("2019-01-01T00:00:00Z"),
          runtime: 10,
        },
        item: {
          channel: "ZDF",
          topic: show.name,
          title: "Synthetic (S01E01)",
          description: "",
          duration: 600,
          size: 0,
          filmlisteTimestamp: 1,
          url_website: "https://example.invalid/synthetic",
          url_video_hd: source,
          url_video: "",
          url_video_low: "",
        },
      };
      try {
        await prisma.config.upsert({
          where: { key: "synthetic.sentinel" },
          create: { key: "synthetic.sentinel", value: "preserve" },
          update: { value: "preserve" },
        });
        await journal.register(scope, show, [match]);
        await facts.idle();
        await journal.idle();
        const [registered] = await journal.current(scope);
        const announced = await journal.announce(scope, [
          { entryId: registered.id, guid: "synthetic-hd" },
        ]);
        const first = await journal.current(scope);
        expect(first).toHaveLength(1);
        expect(first[0].readyAt).not.toBeNull();
        const persisted = await repository.read();
        expect(persisted).not.toMatch(/fingerprint|audioLanguage|videoDimensions/);
        journal.dispose();
        facts.clear();
        await facts.idle();
        await prisma.$disconnect();
        facts = new SourceMediaFactsStore();
        journal = new TvSearchDeliveryJournal(repository, facts);
        expect(facts.get(source)).toBeUndefined();
        expect(await journal.current(scope)).toEqual(first);
        await facts.idle();
        await journal.idle();
        expect(facts.get(source)?.facts.audioLanguage).toBe("de");
        expect(await journal.current(scope)).toEqual(first); // Fresh proof never moves first readiness.
        expect(
          await journal.announce(scope, [{ entryId: first[0].id, guid: "synthetic-hd" }])
        ).toEqual(announced);
        expect(
          (await prisma.config.findUnique({ where: { key: "synthetic.sentinel" } }))?.value
        ).toBe("preserve");
        expect(await prisma.download.count()).toBe(0);
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
        const before = await repository.read();
        await expect(
          journal.register(scope, { ...show, sonarrMonitoredCoordinates: ["1:1", "1:2"] }, [
            {
              ...match,
              episode: { ...match.episode, episodeNumber: 2 },
              item: { ...match.item, url_video_hd: source.replace("runtime", "other") },
            },
          ])
        ).rejects.toThrow();
        expect(await repository.read()).toBe(before);
      } finally {
        journal.dispose();
        facts.clear();
        await facts.idle();
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
        await prisma.config.deleteMany({
          where: { key: { in: [TV_DELIVERY_KEY, "synthetic.sentinel"] } },
        });
      }
    },
    60_000
  );
