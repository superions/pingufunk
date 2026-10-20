import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
const fixture = vi.hoisted(() => ({
  source: {
    channel: "ZDF",
    topic: "Synthetic review series",
    title: "Concrete title (S06/E01)",
    description: "",
    filmlisteTimestamp: 1_795_000_000,
    duration: 3540,
    size: 1000000,
    url_website: "https://example.invalid/episode",
    url_video_hd: "https://rodlzdf-a.akamaihd.net/synthetic/hd.mp4",
    url_video: "",
    url_video_low: "",
  },
  failJobWrite: false,
}));
vi.mock("@/services/sonarr-provider", async (original) => ({
  ...(await original<object>()),
  openSonarrSession: async () => ({
    inventory: async () => [
      { sonarrId: 7, tvdbId: 123, title: "Synthetic review series", monitored: true },
    ],
    show: async () => ({
      series: { sonarrId: 7, tvdbId: 123, title: "Synthetic review series", monitored: true },
      episodes: [
        {
          sonarrId: 11,
          seriesId: 7,
          seasonNumber: 6,
          episodeNumber: 1,
          title: "TBA",
          aired: new Date("2027-01-01T00:00:00Z"),
          expectedRuntimeSeconds: 3000,
        },
      ],
    }),
  }),
}));
vi.mock("@/services/shows", () => ({ getBaseShowInfoByTvdbId: async () => null }));
vi.mock("@/services/mediathek", () => ({
  queryTvSourceCandidates: async () => [structuredClone(fixture.source)],
}));
vi.mock("@/services/tv-search-terms", () => ({ verifiedRuleTopics: () => [] }));
vi.mock("@/services/source-audio", async (original) => ({
  ...(await original<object>()),
  enrichSourceAudio: async (items: Array<typeof fixture.source>) =>
    new Map(
      items.map((item) => [
        item,
        [
          {
            ...item,
            audioLanguage: "de",
            sourceVideoDimensions: [{ url: item.url_video_hd, width: 1920, height: 1080 }],
          },
        ],
      ])
    ),
}));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: vi.fn(async () => {}) }));
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
  vi.unstubAllEnvs();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = undefined;
});
for (const provider of ["sqlite", "postgresql"] as const) {
  it.skipIf(provider === "postgresql" && !enabled)(
    `atomic review/audit/receipt and restart safety on real ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-source-review-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p09_review");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      const migration = spawnSync(
        process.execPath,
        [path.resolve("scripts/database-migrate.mjs")],
        { env: process.env, encoding: "utf8", timeout: 30000 }
      );
      expect(migration.status).toBe(0);
      vi.resetModules();
      delete (globalThis as { prisma?: unknown }).prisma;
      let { prisma } = await import("@/lib/db");
      disconnect = () => prisma.$disconnect();
      await prisma.download.deleteMany();
      await prisma.config.deleteMany();
      await prisma.config.create({
        data: { key: "matching.sonarr.tolerancePercent", value: "15" },
      });
      let review = await import("@/services/tv-source-review");
      const found = await review.searchTvSourceReviews("Synthetic review series");
      const preview = await review.previewTvSource(found![0].review.selector);
      expect(await prisma.download.count()).toBe(0);
      expect(await prisma.config.count()).toBe(1);
      const beforeSettings = await prisma.config.findMany();
      const id = randomUUID();
      // Two browser intentions compete for one exact source/decision, not two jobs.
      const replies = await Promise.all([
        review.confirmTvSource(preview.selector, preview.fingerprint, id),
        review.confirmTvSource(preview.selector, preview.fingerprint, randomUUID()),
      ]);
      expect(new Set(replies.map((reply) => reply.id)).size).toBe(1);
      const jobId = replies[0].id;
      expect(await prisma.download.count()).toBe(1);
      const job = await prisma.download.findUniqueOrThrow({ where: { id: jobId } });
      const expectations = JSON.parse(job.mediaExpectations!);
      expect(expectations).toMatchObject({
        version: 4,
        approval: { jobId, fingerprint: preview.fingerprint },
        durations: {
          source: { seconds: 3540, tolerancePercent: 10 },
          metadata: { seconds: 3000, tolerancePercent: 15 },
        },
      });
      const receipts = await prisma.config.findMany({
        where: { key: { startsWith: "internal.manual-review." } },
      });
      expect(receipts).toHaveLength(1);
      expect(JSON.parse(receipts[0].value)).toEqual({
        id: jobId,
        fingerprint: preview.fingerprint,
        expectations: job.mediaExpectations,
      });
      expect(
        await prisma.config.findMany({
          where: { key: { not: { startsWith: "internal.manual-review." } } },
        })
      ).toEqual(beforeSettings);
      await review.revalidateApprovedTvJob(job, expectations);
      // Ordinary SAB, fake NZB and history retry cannot carry this internal grant.
      const { addToQueue, retryDownload } = await import("@/services/download");
      await expect(addToQueue(job.url, job.title, "sonarr", expectations)).rejects.toThrow();
      await prisma.download.update({ where: { id: jobId }, data: { status: "failed" } });
      await expect(retryDownload(jobId)).rejects.toThrow();
      expect(await prisma.download.count()).toBe(1);
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
      ({ prisma } = await import("@/lib/db"));
      review = await import("@/services/tv-source-review");
      expect(
        await review.confirmTvSource(preview.selector, preview.fingerprint, randomUUID())
      ).toEqual({ id: jobId, status: "failed" });
      await prisma.download.delete({ where: { id: jobId } });
      expect(
        await review.confirmTvSource(preview.selector, preview.fingerprint, randomUUID())
      ).toEqual({ id: jobId, status: "history_removed" });
      expect(await prisma.download.count()).toBe(0);
      // Reusing an unrelated job ID fails after the receipt statement: both new
      // rows must roll back, without hiding/replacing the original conflict.
      fixture.source.duration = 3530;
      const changed = await review.previewTvSource(found![0].review.selector);
      await prisma.download.create({
        data: {
          id: jobId,
          title: "Existing foreign job",
          url: "https://example.invalid/other.mp4",
          category: "default",
        },
      });
      await expect(
        review.confirmTvSource(changed.selector, changed.fingerprint, jobId)
      ).rejects.toThrow();
      expect(
        await prisma.config.count({ where: { key: { startsWith: "internal.manual-review." } } })
      ).toBe(1);
      expect(await prisma.download.count()).toBe(1);
      await prisma.download.delete({ where: { id: jobId } });
      await prisma.config.deleteMany();
      fixture.source.duration = 3540;
    },
    60000
  );
}
