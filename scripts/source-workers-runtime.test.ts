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

// Real database/fence/queue/file owners; only network adapters and media probing
// are synthetic. Public sources and actual library services are never contacted.
vi.mock("../src/server/media-probe", () => ({
  MediaProbeError: class extends Error {},
  probeJobMedia: vi.fn(async () => ({
    durationSeconds: 120,
    video: [{ width: 1920, height: 1080 }],
    audioLanguages: ["de"],
  })),
}));
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

for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `runs both source workers under one real ${provider} fence and drains them before release`,
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
      const aborted = new Set<string>();
      let finishMedia!: () => void;
      const mediaGate = new Promise<void>((resolve) => {
        finishMedia = resolve;
      });
      const youtube = vi
        .spyOn(youtubeDownloadAdapter, "transfer")
        .mockImplementation(async (_source, context) => {
          begun.add("youtube");
          await new Promise<void>((_resolve, reject) =>
            context.signal.addEventListener(
              "abort",
              () => {
                aborted.add("youtube");
                reject(new Error("Owned shutdown"));
              },
              { once: true }
            )
          );
          throw Error("Unreachable");
        });
      const mediathek = vi
        .spyOn(mediathekDownloadAdapter, "transfer")
        .mockImplementation(async (_source, context) => {
          begun.add("mediathek");
          if (context.filename === "Synthetic.Second.Mediathek") {
            begun.add("second-media");
            await new Promise<void>((_resolve, reject) =>
              context.signal.addEventListener(
                "abort",
                () => {
                  aborted.add("mediathek");
                  reject(new Error("Owned shutdown"));
                },
                { once: true }
              )
            );
          }
          await mediaGate;
          const file = path.join(context.stagingDirectory, context.filename + ".webm");
          await writeFile(file, "synthetic media");
          return { path: file, extension: ".webm" };
        });
      let running: Promise<void> | undefined;
      try {
        await prisma.config.createMany({
          data: [
            { key: "download.path", value: root },
            { key: "download.convertToMkv", value: "false" },
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
          ],
        });
        const queued = await prisma.download.findUniqueOrThrow({ where: { id: "next-youtube" } });
        const sentinel = path.join(root, "existing.partial");
        await writeFile(sentinel, "preserved bytes");
        running = manager.startDownloadProcessing();
        await vi.waitFor(() => expect(begun).toEqual(new Set(["youtube", "mediathek"])));
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
        await manager.shutdownDownloadProcessing();
        await running;
        expect(aborted).toEqual(new Set(["youtube", "mediathek"]));
        expect((await prisma.download.findUnique({ where: { id: "youtube" } }))?.status).toBe(
          "failed"
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
        await manager.shutdownDownloadProcessing();
        await running;
        getDownloadWorkerState().shuttingDown = false;
        youtube.mockRestore();
        mediathek.mockRestore();
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
