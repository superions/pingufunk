import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { parseDownloadRead } from "@/lib/download-read";

const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pgEnabled) {
  const target = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
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
});

for (const provider of ["sqlite", "postgresql"] as const) {
  it.skipIf(provider === "postgresql" && !pgEnabled)(
    `reads bounded stable pages, native all-queue and old IDs on real ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p15-reads-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p15_reads");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
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
      const prefix = `qa-${randomUUID()}`;
      const time = new Date("2026-10-08T01:00:00Z");
      const ids = Array.from({ length: 1050 }, (_, i) => `${prefix}-${String(i).padStart(5, "0")}`);
      try {
        await prisma.config.upsert({
          where: { key: "download.path" },
          create: { key: "download.path", value: "/synthetic" },
          update: { value: "/synthetic" },
        });
        for (let start = 0; start < ids.length; start += 100)
          await prisma.download.createMany({
            data: ids.slice(start, start + 100).map((id, index) => ({
              id,
              title: `Synthetic Episode ${String(start + index).padStart(5, "0")}`,
              url: "https://example.invalid/never-download",
              category: (start + index) % 2 ? "radarr" : "sonarr/legacy-folder",
              status: (start + index) % 10 === 0 ? "failed" : "completed",
              createdAt: time,
              completedAt: time,
              size: BigInt(1000),
              filePath: `/synthetic/${(start + index) % 2 ? "radarr" : "sonarr/legacy-folder"}/file.mkv`,
            })),
          });
        await prisma.download.createMany({
          data: Array.from({ length: 60 }, (_, i) => ({
            id: `${prefix}-queue-${i}`,
            title: "Synthetic active",
            url: "https://example.invalid/never-download",
            category: "sonarr",
            status: "queued",
            createdAt: time,
          })),
        });
        const { getHistory, getQueue } = await import("@/services/download");
        const { GET } = await import("@/app/api/download/route");
        const options = (text: string) => parseDownloadRead(new URLSearchParams(text), "history");
        const page = await getHistory(options("start=50&limit=50"));
        expect(page).toMatchObject({
          start: 50,
          limit: 50,
          noofslots: 1050,
          noofslots_total: 1050,
        });
        expect(page.slots.map((item) => item.nzo_id)).toEqual(ids.slice(50, 100));
        expect((await getHistory(options("start=50&limit=50"))).slots).toEqual(page.slots);
        expect(
          (await getHistory(options("category=sonarr&limit=50&failed_only=1"))).noofslots
        ).toBe(105);
        expect(
          (await getHistory(options("search=episode 01049&limit=50"))).slots.map(
            (item) => item.nzo_id
          )
        ).toEqual([ids[1049]]);
        const old = await GET(
          new NextRequest(
            `http://localhost/api/download?mode=history&nzo_ids=${ids[1049]}&limit=50`
          )
        );
        expect(old.status).toBe(200);
        expect((await old.json()).history.slots).toEqual([
          expect.objectContaining({
            nzo_id: ids[1049],
            status: "Completed",
            bytes: 1000,
            storage: "/synthetic/radarr",
          }),
        ]);
        const all = await getHistory();
        expect(all.slots).toHaveLength(1050);
        expect(
          (
            await getQueue(
              parseDownloadRead(new URLSearchParams("limit=0&category=sonarr"), "queue")
            )
          ).slots
        ).toHaveLength(60);
        const compact = await getQueue(parseDownloadRead(new URLSearchParams("limit=50"), "queue"));
        expect(compact.slots).toHaveLength(50);
        expect(compact.noofslots_total).toBe(60);
        // A new completion changes later snapshots, not the older response's
        // count/window. All old IDs remain stored and individually reachable.
        const completion = prisma.download.update({
          where: { id: `${prefix}-queue-0` },
          data: { status: "completed", completedAt: new Date(time.getTime() + 1000) },
        });
        const concurrentPage = getHistory(options("start=50&limit=50"));
        const [, concurrent] = await Promise.all([completion, concurrentPage]);
        expect([1050, 1051]).toContain(concurrent.noofslots);
        expect(concurrent.slots.map((item) => item.nzo_id)).toEqual(
          concurrent.noofslots === 1051 ? ids.slice(49, 99) : ids.slice(50, 100)
        );
        expect((await getHistory(options("limit=50"))).slots[0].nzo_id).toBe(`${prefix}-queue-0`);
        expect((await getHistory(options(`nzo_ids=${ids[1049]}&limit=50`))).slots[0].nzo_id).toBe(
          ids[1049]
        );
        expect(await prisma.download.count()).toBe(1110);
        const bytesAll = Buffer.byteLength(JSON.stringify(all));
        const bytesPage = Buffer.byteLength(JSON.stringify(page));
        expect(bytesPage).toBeLessThan(bytesAll / 15);
        console.info(
          `[P15 read fixture ${provider}] 1050 -> ${page.slots.length} rows; response ${bytesAll} -> ${bytesPage} bytes; no retention changes`
        );
        for (const query of ["limit=10001", "start=-1", "nzo_ids=../job"])
          expect(
            (await GET(new NextRequest(`http://localhost/api/download?mode=history&${query}`)))
              .status
          ).toBe(400);
        expect(await prisma.download.count()).toBe(1110);
      } finally {
        await prisma.download.deleteMany({ where: { id: { startsWith: prefix } } });
      }
    },
    30000
  );
}
