import { expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  youtubeRenditionFingerprint,
  youtubeWatchUrl,
  type YoutubeSourceReference,
} from "../src/lib/youtube-source";
import { unknownJobMediaExpectations } from "../src/lib/media-expectations";

// Real database, queue and file owners; source network adapters are synthetic.
const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pgEnabled) {
  const url = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.pathname !== "/pingufunk_qa"
  )
    throw Error("Disposable loopback PostgreSQL required");
}

for (const [provider, stop, mp4Limit] of [
  ["sqlite", "abort", 4],
  ["sqlite", "drain", 2],
  ["postgresql", "abort", 4],
  ["postgresql", "drain", 2],
] as const)
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `${stop}s three source workers with ${mp4Limit} MP4 slots under one real ${provider} fence`,
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "pingufunk-source-workers-"));
      const pg = provider === "postgresql" ? new URL(pgUrl!) : null;
      pg?.searchParams.set("schema", "p17_source_workers");
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
      const { acquireWorkerLease, WORKER_LEASE_KEY } = await import("../src/server/worker-lease");
      const { getDownloadWorkerState } = await import("../src/server/download-worker-state");
      const { youtubeDownloadAdapter } = await import("../src/providers/youtube/download");
      const { mediathekDownloadAdapter } = await import("../src/providers/mediathek/download");
      const { hlsDownloadAdapter } = await import("../src/providers/hls/download");
      const source: YoutubeSourceReference = {
        version: 1,
        family: "youtube",
        videoId: "abcdefghijk",
        channelId: "UC" + "a".repeat(22),
        mappingRevision: "a".repeat(64),
        originalTitle: "Synthetic",
        programme: { kind: "movie", targetId: 42 },
        selection: {
          videoFormat: "137",
          audioFormat: "140",
          audioTrack: "140",
          language: "de",
          width: 1920,
          height: 1080,
          duration: 120,
        },
      };
      const expectations = {
        ...unknownJobMediaExpectations(),
        version: 5,
        mediaKind: "movie",
        sourceRef: source,
        durations: {
          source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
          metadata: null,
        },
        sourceAudio: {
          provider: "youtube",
          videoId: source.videoId,
          channelId: source.channelId,
          mediaIdentity: youtubeRenditionFingerprint(source),
          language: "de",
          selection: source.selection,
        },
        resolution: { width: 1920, height: 1080, provenance: "provider_dimensions" },
      };
      const begun = new Set<string>();
      const mp4Started = new Set<string>();
      const mp4Admissions: string[] = [];
      const aborted = new Set<string>();
      let finishMedia!: () => void;
      let finishYoutube!: () => void;
      let finishSecondMedia!: () => void;
      let finishHls!: () => void;
      const mediaGate = new Promise<void>((resolve) => {
        finishMedia = resolve;
      });
      const youtube = vi
        .spyOn(youtubeDownloadAdapter, "transfer")
        .mockImplementation(async (_source, context) => {
          begun.add("youtube");
          await new Promise<void>((resolve, reject) => {
            finishYoutube = resolve;
            context.signal.addEventListener(
              "abort",
              () => {
                aborted.add("youtube");
                reject(new Error("Owned shutdown"));
              },
              { once: true }
            );
          });
          const file = path.join(context.stagingDirectory, context.filename + ".webm");
          await writeFile(file, "finished youtube bytes");
          return { path: file, extension: ".webm" };
        });
      const mediathek = vi
        .spyOn(mediathekDownloadAdapter, "transfer")
        .mockImplementation(async (_source, context) => {
          mp4Started.add(context.filename);
          mp4Admissions.push(context.filename);
          begun.add("mediathek");
          if (context.filename === "Synthetic.Second.Mediathek") {
            begun.add("second-media");
            await new Promise<void>((resolve, reject) => {
              finishSecondMedia = resolve;
              context.signal.addEventListener(
                "abort",
                () => {
                  aborted.add("mediathek");
                  reject(new Error("Owned shutdown"));
                },
                { once: true }
              );
            });
          }
          await mediaGate;
          const file = path.join(context.stagingDirectory, context.filename + ".webm");
          await writeFile(file, "synthetic media");
          return { path: file, extension: ".webm" };
        });
      let running: Promise<void> | undefined;
      const hls = vi
        .spyOn(hlsDownloadAdapter, "transfer")
        .mockImplementation(async (_source, context) => {
          begun.add("hls");
          await new Promise<void>((resolve, reject) => {
            finishHls = resolve;
            context.signal.addEventListener(
              "abort",
              () => {
                aborted.add("hls");
                reject(new Error("Owned shutdown"));
              },
              { once: true }
            );
          });
          const file = path.join(context.stagingDirectory, context.filename + ".mkv");
          await writeFile(file, "synthetic HLS bytes");
          return { path: file, extension: ".mkv" };
        });
      try {
        await prisma.config.createMany({
          data: [
            { key: "download.path", value: root },
            { key: "download.convertToMkv", value: "false" },
            ...(mp4Limit === 4 ? [] : [{ key: "download.parallel.mp4", value: String(mp4Limit) }]),
          ],
        });
        await prisma.download.createMany({
          data: [
            {
              id: "youtube",
              title: "Synthetic.YouTube",
              url: youtubeWatchUrl(source),
              category: "radarr",
              mediaExpectations: JSON.stringify(expectations),
              createdAt: new Date(0),
            },
            {
              id: "media",
              title: "Synthetic.Mediathek",
              url: "https://synthetic.invalid/media.mp4",
              category: "sonarr",
              createdAt: new Date(1),
            },
            {
              id: "next-youtube",
              title: "Synthetic.Next",
              url: youtubeWatchUrl(source),
              category: "radarr",
              mediaExpectations: JSON.stringify(expectations),
              createdAt: new Date(2),
            },
            {
              id: "hls",
              title: "Synthetic.HLS",
              url: "https://synthetic.invalid/master.m3u8",
              category: "sonarr",
              createdAt: new Date(3),
            },
            ...Array.from({ length: 4 }, (_, i) => ({
              id: `parallel-media-${i}`,
              title: `Parallel.MP4.${i}`,
              url: `https://synthetic.invalid/media-${i}.mp4`,
              category: "sonarr",
              createdAt: new Date(10 + i),
            })),
          ],
        });
        const queued = await prisma.download.findUniqueOrThrow({ where: { id: "next-youtube" } });
        const sentinel = path.join(root, "existing.partial");
        await writeFile(sentinel, "preserved bytes");
        running = manager.startDownloadProcessing();
        await vi.waitFor(() => expect(begun).toEqual(new Set(["youtube", "mediathek", "hls"])));
        await vi.waitFor(() => expect(mp4Started.size).toBe(mp4Limit));
        expect(manager.getWorkerRuntimeState().workerLimits.mediathek).toBe(mp4Limit);
        expect(
          (await prisma.download.findUniqueOrThrow({ where: { id: "parallel-media-3" } })).status
        ).toBe("queued");
        expect(await acquireWorkerLease()).toBeNull();
        expect(await prisma.download.findUnique({ where: { id: "next-youtube" } })).toEqual(queued);
        finishMedia();
        await vi.waitFor(async () =>
          expect((await prisma.download.findUnique({ where: { id: "media" } }))?.status).toBe(
            "completed"
          )
        );
        const imported = await prisma.download.findUniqueOrThrow({ where: { id: "media" } });
        expect(imported.filePath).toContain(path.join(root, "sonarr"));
        expect(await readFile(imported.filePath!, "utf8")).toBe("synthetic media");
        expect(mp4Admissions.length).toBe(new Set(mp4Admissions).size);
        expect((await prisma.download.findUnique({ where: { id: "youtube" } }))?.status).toBe(
          "downloading"
        );
        await prisma.download.create({
          data: {
            id: "second-media",
            title: "Synthetic.Second.Mediathek",
            category: "sonarr",
            url: "https://synthetic.invalid/second.mp4",
          },
        });
        void manager.startDownloadProcessing();
        await vi.waitFor(() => expect(begun.has("second-media")).toBe(true), { timeout: 3000 });
        if (stop === "drain") {
          let drained = false;
          const draining = manager.drainDownloadProcessing().then(() => {
            drained = true;
          });
          await manager.startDownloadProcessing();
          expect(drained).toBe(false);
          expect(aborted.size).toBe(0);
          expect(await acquireWorkerLease()).toBeNull();
          finishYoutube();
          await vi.waitFor(async () =>
            expect(
              (await prisma.download.findUniqueOrThrow({ where: { id: "youtube" } })).status
            ).toBe("completed")
          );
          expect(drained).toBe(false);
          expect(await prisma.download.findUnique({ where: { id: "next-youtube" } })).toEqual(
            queued
          );
          finishSecondMedia();
          await vi.waitFor(async () =>
            expect(
              (await prisma.download.findUniqueOrThrow({ where: { id: "second-media" } })).status
            ).toBe("completed")
          );
          expect(drained).toBe(false);
          expect(await acquireWorkerLease()).toBeNull();
          finishHls();
          await draining;
          expect(aborted.size).toBe(0);
          expect(manager.getWorkerRuntimeState()).toMatchObject({
            drainRequested: true,
            state: "paused",
            exclusiveOwnership: "idle",
          });
          for (const id of ["youtube", "second-media", "hls"]) {
            const row = await prisma.download.findUniqueOrThrow({ where: { id } });
            expect(row.status).toBe("completed");
            expect((await readFile(row.filePath!, "utf8")).length).toBeGreaterThan(0);
          }
        } else await manager.shutdownDownloadProcessing();
        await running;
        expect(aborted).toEqual(
          stop === "abort" ? new Set(["youtube", "mediathek", "hls"]) : new Set()
        );
        expect((await prisma.download.findUnique({ where: { id: "youtube" } }))?.status).toBe(
          stop === "abort" ? "failed" : "completed"
        );
        expect(await prisma.download.findUnique({ where: { id: "next-youtube" } })).toEqual(queued);
        expect(await readFile(sentinel, "utf8")).toBe("preserved bytes");
        expect(await readFile(imported.filePath!, "utf8")).toBe("synthetic media");
        expect(
          JSON.parse(
            (await prisma.config.findUniqueOrThrow({ where: { key: WORKER_LEASE_KEY } })).value
          ).owner
        ).toBe("");
      } finally {
        finishMedia();
        finishYoutube?.();
        finishSecondMedia?.();
        finishHls?.();
        await manager.shutdownDownloadProcessing();
        await running;
        getDownloadWorkerState().shuttingDown = false;
        getDownloadWorkerState().drainRequested = false;
        youtube.mockRestore();
        mediathek.mockRestore();
        hls.mockRestore();
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
    30000
  );
