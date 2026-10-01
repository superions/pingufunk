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
      const { retryDownload, addToQueue } = await import("@/services/download");
      const retried = await retryDownload(id);
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
      await prisma.download.deleteMany({
        where: { id: { in: [retried!.id, legacy.id, ...uiIds] } },
      });
      await prisma.config.delete({ where: { key: "matching.minDuration" } });
    }
  );
}
