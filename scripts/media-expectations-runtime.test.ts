import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";
import { generateFakeNzb } from "@/services/nzb-release";
import { unknownMediaExpectations } from "@/lib/media-expectations";

vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: vi.fn(async () => {}) }));
const { queryContent } = vi.hoisted(() => ({ queryContent: vi.fn() }));
vi.mock("@/services/content-search", () => ({ queryContent }));
vi.mock("@/services/category", () => ({ getCategoriesForTopics: vi.fn(async () => new Map()) }));
const enabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (enabled) {
  const url = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
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
    `retains v1 expectations through real ${provider} queue writes, restart and retry`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p09-contract-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const parsed = new URL(pgUrl!);
        parsed.searchParams.set("schema", "p09_runtime");
        url = parsed.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      const migrated = spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
        env: process.env,
        encoding: "utf8",
        timeout: 30_000,
      });
      expect(migrated.status).toBe(0);
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
      let { prisma } = await import("@/lib/db");
      disconnect = () => prisma.$disconnect();
      const expectations = {
        ...unknownMediaExpectations(),
        duration: { seconds: 120, provenance: "episode_metadata" as const },
      };
      const release = {
        title: "Synthetic.S01E01",
        url: "https://example.invalid/media.mp4",
        mediaExpectations: expectations,
      };
      const { POST } = await import("@/app/api/route");
      const response = await POST(
        new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
          method: "POST",
          body: generateFakeNzb(release),
        })
      );
      expect(response.status).toBe(200);
      const id = (await response.json()).nzo_ids[0] as string;
      const stored = await prisma.download.findUniqueOrThrow({ where: { id } });
      expect(stored).toMatchObject({
        title: release.title,
        url: release.url,
        category: "sonarr",
        mediaExpectations: JSON.stringify(expectations),
        mediaValidation: null,
      });
      const sabPaths = ["/api", "/api/download"];
      const sabHandlers = [
        await import("@/app/api/route"),
        await import("@/app/api/download/route"),
      ];
      for (const [index, handler] of sabHandlers.entries()) {
        const queued = await handler.GET(
          new NextRequest(`http://localhost${sabPaths[index]}?mode=queue`)
        );
        expect((await queued.json()).queue.slots).toEqual([
          expect.objectContaining({
            nzo_id: id,
            filename: release.title,
            cat: "sonarr",
            status: "Queued",
          }),
        ]);
        const status = await handler.GET(
          new NextRequest(`http://localhost${sabPaths[index]}?mode=fullstatus`)
        );
        expect((await status.json()).status.noofslots).toBe(1);
      }
      await prisma.download.update({
        where: { id },
        data: { status: "failed", mediaValidation: '{"version":1,"durationSeconds":120}' },
      });
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
      ({ prisma } = await import("@/lib/db"));
      expect((await prisma.download.findUniqueOrThrow({ where: { id } })).mediaExpectations).toBe(
        stored.mediaExpectations
      );
      const { GET: sab } = await import("@/app/api/download/route");
      const failed = await sab(new NextRequest("http://localhost/api/download?mode=history"));
      expect((await failed.json()).history.slots).toEqual([
        expect.objectContaining({
          nzo_id: id,
          name: release.title,
          category: "sonarr",
          status: "Failed",
        }),
      ]);
      const { retryDownload, addToQueue } = await import("@/services/download");
      const retry = await sab(
        new NextRequest(`http://localhost/api/download?mode=history&name=retry&value=${id}`)
      );
      expect(retry.status).toBe(200);
      const retried = { id: (await retry.json()).nzo_id as string };
      expect(retried?.id).not.toBe(id);
      expect(await prisma.download.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.download.findUniqueOrThrow({ where: { id: retried!.id } })).toMatchObject(
        { status: "queued", mediaExpectations: stored.mediaExpectations, mediaValidation: null }
      );
      const legacy = await addToQueue(release.url, release.title, "sonarr");
      expect(
        (await prisma.download.findUniqueOrThrow({ where: { id: legacy.id } })).mediaExpectations
      ).toBeNull();
      await prisma.download.update({
        where: { id: legacy.id },
        data: { status: "failed", mediaExpectations: "{}" },
      });
      await expect(retryDownload(legacy.id)).rejects.toThrow("Invalid media expectations");
      expect(await prisma.download.findUnique({ where: { id: legacy.id } })).not.toBeNull();
      const rejectedRetry = await sab(
        new NextRequest(`http://localhost/api/download?mode=history&name=retry&value=${legacy.id}`)
      );
      expect(rejectedRetry.status).toBe(409);
      expect(await prisma.download.findUnique({ where: { id: legacy.id } })).not.toBeNull();
      queryContent.mockResolvedValue([
        {
          channel: "Synthetic",
          topic: "Synthetic UI",
          title: "Example",
          description: "",
          duration: 120,
          size: 1000,
          filmlisteTimestamp: 1700000000,
          url_website: "https://example.invalid/page",
          url_video: release.url,
          url_video_hd: "https://example.invalid/hd.mp4",
          url_video_low: "https://example.invalid/low.mp4",
        },
      ]);
      const { GET: search } = await import("@/app/api/search/route");
      await prisma.config.create({ data: { key: "matching.minDuration", value: "0" } });
      const uiIds: string[] = [];
      for (const type of ["", "&type=movie"]) {
        const found = await search(
          new NextRequest(`http://localhost/api/search?q=Synthetic${type}`)
        );
        const uiItem = (await found.json()).results[0];
        for (const key of ["hd", "sd", "low"]) {
          const queued = await POST(
            new NextRequest("http://localhost/api?mode=addfile&cat=default", {
              method: "POST",
              body: uiItem.nzbDownloads[key],
            })
          );
          expect(queued.status).toBe(200);
          const uiId = (await queued.json()).nzo_ids[0];
          uiIds.push(uiId);
          const actual = await prisma.download.findUniqueOrThrow({ where: { id: uiId } });
          expect(actual.title).toBe("Synthetic UI - Example");
          expect(actual.url).toBe(
            key === "sd" ? release.url : `https://example.invalid/${key}.mp4`
          );
          expect(JSON.parse(actual.mediaExpectations!)).toEqual({
            version: 1,
            duration: { seconds: 120, provenance: "source_catalogue" },
            audio: null,
            resolution: null,
          });
        }
      }
      // Removal is exercised through both shipped URLs against persisted rows;
      // real completed-file ownership and media validity have separate image gates.
      for (const [index, handler] of sabHandlers.entries()) {
        const removedId = uiIds.pop()!;
        await prisma.download.update({ where: { id: removedId }, data: { status: "failed" } });
        const removal = await handler.GET(
          new NextRequest(
            `http://localhost${sabPaths[index]}?mode=history&name=delete&value=${removedId}`
          )
        );
        expect(removal.status).toBe(200);
        expect(await removal.json()).toEqual({ status: true });
        expect(await prisma.download.findUnique({ where: { id: removedId } })).toBeNull();
        expect(await prisma.download.findUnique({ where: { id: uiIds[0] } })).not.toBeNull();
      }
      await prisma.download.deleteMany({
        where: { id: { in: [retried!.id, legacy.id, ...uiIds] } },
      });
      await prisma.config.delete({ where: { key: "matching.minDuration" } });
    }
  );
}
