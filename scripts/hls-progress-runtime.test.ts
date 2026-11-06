import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Keep the actual HLS progress parser, child lifecycle, scheduler and database.
// Only source bytes and the final media mux are synthetic.
vi.mock("../src/server/ffmpeg", () => ({
  ensureFfmpegExists: async () => true,
  getFfmpegPath: () => "/synthetic/ffmpeg",
  mergeVideoAudio: async (video: string, _audio: string, outputPath: string) => {
    await copyFile(video, outputPath);
    return { success: true, outputPath };
  },
}));

const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `persists decimal HLS rates and completes three simultaneous jobs on ${provider}`,
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "pingufunk-hls-progress-"));
      const pg = provider === "postgresql" ? new URL(pgUrl ?? "") : null;
      if (pg) {
        if (
          !["postgres:", "postgresql:"].includes(pg.protocol) ||
          !["localhost", "127.0.0.1"].includes(pg.hostname) ||
          pg.pathname !== "/pingufunk_qa"
        )
          throw Error("Disposable loopback PostgreSQL required");
        pg.searchParams.set("schema", "hls_progress");
      }
      vi.stubEnv("DATABASE_URL", pg?.href ?? `file:${path.join(root, "jobs.sqlite")}`);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      vi.stubEnv("DOWNLOAD_TEMP_PATH", path.join(root, "incomplete"));
      vi.resetModules();
      delete (globalThis as { prisma?: unknown }).prisma;
      expect(
        spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
          env: process.env,
          encoding: "utf8",
          timeout: 30000,
        }).status
      ).toBe(0);
      const { prisma } = await import("../src/lib/db");
      const manager = await import("../src/server/download-manager");
      const { getDownloadWorkerState } = await import("../src/server/download-worker-state");
      const release = path.join(root, "release");
      const tool = path.join(root, "yt-dlp-fixture");
      await writeFile(
        tool,
        `#!${process.execPath}
const fs = require('node:fs');
const output = process.argv[process.argv.indexOf('-o') + 1];
const units = ['KiB', 'MiB', 'GiB'];
const index = Number(output.match(/Synthetic.HLS.([0-2])/)[1]);
console.log('[download]  45.2% of 500.00MiB at 1.23' + units[index] + '/s ETA 00:25');
const timer = setInterval(() => {
  if (fs.existsSync(${JSON.stringify(release)})) {
    clearInterval(timer);
    fs.writeFileSync(output, 'synthetic stream bytes');
  }
}, 20);
`,
        { mode: 0o700 }
      );
      let running: Promise<unknown> | undefined;
      try {
        await prisma.config.createMany({
          data: [
            { key: "download.path", value: root },
            { key: "download.ytdlpPath", value: tool },
            { key: "download.parallel.hls", value: "3" },
          ],
        });
        await prisma.download.createMany({
          data: Array.from({ length: 3 }, (_, i) => ({
            id: `hls-${i}`,
            title: `Synthetic.HLS.${i}`,
            category: "movies",
            url: `https://synthetic.invalid/${i}.m3u8`,
          })),
        });
        running = manager.startDownloadProcessing().catch((error: unknown) => error);
        await vi.waitFor(
          async () => {
            const rows = await prisma.download.findMany();
            expect(rows).toHaveLength(3);
            for (const row of rows) {
              expect(row.status).toBe("downloading");
              const power = Number(row.id.slice(-1)) + 1;
              expect(row.speed).toBe(BigInt(Math.round(1.23 * 1024 ** power)));
              expect(row.progress).toBeGreaterThan(0);
            }
          },
          { timeout: 2000 }
        );
        await writeFile(release, "finish");
        expect(await running).toBeUndefined();
        for (const row of await prisma.download.findMany()) {
          expect(row.status).toBe("completed");
          expect(await readFile(row.filePath!, "utf8")).toBe("synthetic stream bytes");
        }
      } finally {
        await manager.shutdownDownloadProcessing();
        await running;
        getDownloadWorkerState().shuttingDown = false;
        getDownloadWorkerState().drainRequested = false;
        if (pg) {
          await prisma.download.deleteMany();
          await prisma.config.deleteMany();
        }
        await prisma.$disconnect();
        delete (globalThis as { prisma?: unknown }).prisma;
        vi.unstubAllEnvs();
        vi.resetModules();
        await rm(root, { recursive: true, force: true });
      }
    },
    15000
  );
