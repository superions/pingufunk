import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { ENQUEUE_KEY_HEADER, ENQUEUE_KEY_RETENTION_MS } from "@/lib/enqueue-request";
import { generateFakeNzb } from "@/services/nzb-release";
import { unknownJobMediaExpectations, unknownMediaExpectations } from "@/lib/media-expectations";

const { startDownloadProcessing } = vi.hoisted(() => ({
  startDownloadProcessing: vi.fn(async () => {}),
}));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing }));
const enabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (enabled) {
  const target = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    target.pathname !== "/pingufunk_qa"
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
  vi.restoreAllMocks();
});

for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !enabled)(
    `persists one atomic receipt/job for parallel, lost-response and restarted enqueues on ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p15-enqueues-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p15_enqueues");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      expect(
        spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
          env: process.env,
          encoding: "utf8",
          timeout: 30000,
        }).status
      ).toBe(0);
      vi.resetModules();
      const { prisma } = await import("@/lib/db");
      disconnect = () => prisma.$disconnect();
      const { addToQueue, retryDownload, deleteHistoryItem } = await import("@/services/download");
      const { POST } = await import("@/app/api/download/route");
      const { POST: rootPost } = await import("@/app/api/route");
      const key = () => `${randomUUID()}:${Date.now()}`;
      const release = {
        title: "Synthetic Series S01E01",
        url: "https://example.invalid/never-fetch",
        mediaExpectations: unknownJobMediaExpectations(),
      };
      const nzb = generateFakeNzb(release);
      const post = (intent: string, body = nzb, cat = "tv", handler = POST) =>
        handler(
          new NextRequest(`http://localhost/api/download?mode=addfile&cat=${cat}`, {
            method: "POST",
            body,
            headers: { [ENQUEUE_KEY_HEADER]: intent },
          })
        );
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("Network forbidden in enqueue fixture"));
      startDownloadProcessing.mockClear();
      try {
        // A visible review candidate cannot write either a job or its receipt,
        // through addfile on either endpoint or direct addToQueue.
        const conflict = unknownJobMediaExpectations();
        conflict.mediaKind = "series";
        conflict.durations.source = {
          seconds: 3540,
          provenance: "source_catalogue",
          tolerancePercent: 10,
        };
        conflict.durations.metadata = {
          seconds: 3000,
          provenance: "episode_metadata",
          tolerancePercent: 15,
        };
        const conflictNzb = generateFakeNzb({ ...release, mediaExpectations: conflict });
        for (const handler of [POST, rootPost]) {
          expect((await post(key(), conflictNzb, "tv", handler)).status).toBe(409);
          expect(
            (
              await handler(
                new NextRequest("http://localhost/api/download?mode=addfile&cat=tv", {
                  method: "POST",
                  body: conflictNzb,
                })
              )
            ).status
          ).toBe(409);
        }
        await expect(addToQueue(release.url, release.title, "tv", conflict)).rejects.toThrow(
          "Source duration conflicts"
        );
        expect(await prisma.download.count()).toBe(0);
        expect(await prisma.enqueueIntent.count()).toBe(0);
        expect(startDownloadProcessing).not.toHaveBeenCalled();
        const intent = key();
        const responses = await Promise.all(Array.from({ length: 8 }, () => post(intent)));
        expect(responses.map((r) => r.status)).toEqual(Array(8).fill(200));
        const ids = await Promise.all(responses.map(async (r) => (await r.json()).nzo_ids[0]));
        expect(new Set(ids).size).toBe(1);
        expect(await prisma.download.count()).toBe(1);
        expect(await prisma.enqueueIntent.count()).toBe(1);
        await vi.waitFor(() => expect(startDownloadProcessing).toHaveBeenCalledTimes(1));
        expect(await prisma.download.findUnique({ where: { id: ids[0] } })).toMatchObject({
          ...release,
          mediaExpectations: JSON.stringify(release.mediaExpectations),
          category: "tv",
          status: "queued",
        });
        // The original response can be completely lost; durable receipt still
        // acknowledges the exact original ID through either native endpoint.
        expect((await (await post(intent, nzb, "tv", rootPost)).json()).nzo_ids).toEqual([ids[0]]);
        await prisma.$disconnect();
        delete (globalThis as { prisma?: unknown }).prisma;
        vi.resetModules();
        const restartedDb = (await import("@/lib/db")).prisma;
        disconnect = () => restartedDb.$disconnect();
        const restartedPost = (await import("@/app/api/download/route")).POST;
        expect((await (await post(intent, nzb, "tv", restartedPost)).json()).nzo_ids).toEqual([
          ids[0],
        ]);
        expect(await restartedDb.download.count()).toBe(1);
        for (const [body, cat] of [
          [generateFakeNzb({ ...release, title: "Changed title" }), "tv"],
          [generateFakeNzb({ ...release, url: "https://example.invalid/other" }), "tv"],
          [nzb, "movie"],
          [generateFakeNzb({ ...release, mediaExpectations: unknownMediaExpectations() }), "tv"],
        ])
          expect((await post(intent, body, cat, restartedPost)).status).toBe(409);
        expect(await restartedDb.download.count()).toBe(1);
        expect(startDownloadProcessing).toHaveBeenCalledTimes(1);
        expect((await post(key(), nzb, "tv", restartedPost)).status).toBe(200);
        expect(await restartedDb.download.count()).toBe(2);
        // Native clients opt out of the receipt contract. All shipped protocols
        // remain separate deliberate jobs, including byte-equivalent repeats.
        const versions = [
          undefined,
          unknownMediaExpectations(),
          {
            version: 2 as const,
            duration: null,
            audio: null,
            resolution: null,
            sourceAudio: {
              provider: "arte_hbbtv" as const,
              videoId: "123456-001-A",
              mediaIdentity: "a".repeat(64),
              language: "de",
            },
          },
          unknownJobMediaExpectations(),
        ];
        for (const mediaExpectations of versions)
          for (let i = 0; i < 2; i++) {
            const response = await restartedPost(
              new NextRequest("http://localhost/api/download?mode=addfile&cat=sonarr", {
                method: "POST",
                body: generateFakeNzb({ ...release, mediaExpectations }),
              })
            );
            expect(response.status).toBe(200);
            const id = (await response.json()).nzo_ids[0];
            expect(
              (await restartedDb.download.findUnique({ where: { id } }))?.mediaExpectations
            ).toBe(mediaExpectations === undefined ? null : JSON.stringify(mediaExpectations));
          }
        expect(await restartedDb.download.count()).toBe(10);
        expect(await restartedDb.enqueueIntent.count()).toBe(2);
        const { createEnqueueIntent } = await import("@/services/enqueue-intent");
        // Receipt must roll back with a failed job insert; no orphan can claim
        // an unrelated historical ID as acknowledgement.
        await expect(
          createEnqueueIntent(
            {
              id: ids[0],
              title: release.title,
              url: release.url,
              category: "tv",
              status: "queued",
              progress: 0,
              mediaExpectations: null,
            },
            key()
          )
        ).rejects.toThrow();
        expect(await restartedDb.enqueueIntent.count()).toBe(2);
        expect(await restartedDb.download.count()).toBe(10);
        for (const body of ["malformed NZB", "x".repeat(256 * 1024 + 1)]) {
          const response = await restartedPost(
            new NextRequest("http://localhost/api/download?mode=addfile", { method: "POST", body })
          );
          expect(response.status).toBeGreaterThanOrEqual(400);
        }
        expect(await restartedDb.download.count()).toBe(10);
        // A deliberate retry/removal changes history but not the prior receipt.
        await restartedDb.download.update({ where: { id: ids[0] }, data: { status: "failed" } });
        const restartedDownload = await import("@/services/download");
        const retried = await restartedDownload.retryDownload(ids[0]);
        expect(retried?.id).not.toBe(ids[0]);
        expect((await (await post(intent, nzb, "tv", restartedPost)).json()).nzo_ids).toEqual([
          ids[0],
        ]);
        expect(await restartedDb.download.count()).toBe(10);
        const removalKey = key();
        const removalId = (await (await post(removalKey, nzb, "tv", restartedPost)).json())
          .nzo_ids[0];
        await restartedDb.download.update({
          where: { id: removalId },
          data: { status: "completed" },
        });
        expect(await restartedDownload.deleteHistoryItem(removalId, false)).toBe(true);
        expect((await (await post(removalKey, nzb, "tv", restartedPost)).json()).nzo_ids).toEqual([
          removalId,
        ]);
        expect(await restartedDb.download.count()).toBe(10);
        // Cleanup is receipt-only, bounded, and cannot make an expired key valid.
        await restartedDb.enqueueIntent.createMany({
          data: Array.from({ length: 101 }, (_, i) => ({
            id: `expired-${i}`,
            payloadHash: "synthetic",
            downloadId: retried!.id,
            expiresAt: new Date(Date.now() - 1),
          })),
        });
        expect((await post(key(), nzb, "tv", restartedPost)).status).toBe(200);
        expect(
          await restartedDb.enqueueIntent.count({ where: { id: { startsWith: "expired-" } } })
        ).toBe(1);
        expect(await restartedDb.download.count()).toBe(11);
        const expired = `${randomUUID()}:${Date.now() - ENQUEUE_KEY_RETENTION_MS}`;
        expect((await post(expired, nzb, "tv", restartedPost)).status).toBe(400);
        await expect(
          addToQueue(release.url, release.title, "tv", release.mediaExpectations, "")
        ).rejects.toThrow("Invalid enqueue key");
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
        expect((await post(key(), nzb, "tv", restartedPost)).status).toBe(503);
        await expect(
          addToQueue(release.url, release.title, "tv", release.mediaExpectations, key())
        ).rejects.toThrow("writes");
        expect(await restartedDb.download.count()).toBe(11);
        expect(fetchSpy).not.toHaveBeenCalled();
        // Keep imports live: no accidental test-only replacement for real history owners.
        expect(typeof retryDownload).toBe("function");
        expect(typeof deleteHistoryItem).toBe("function");
      } finally {
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
        const current = (await import("@/lib/db")).prisma;
        await current.enqueueIntent.deleteMany();
        await current.download.deleteMany();
        await current.$disconnect();
      }
    },
    60000
  );
