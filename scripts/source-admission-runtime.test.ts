import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { syntheticYoutubeExpectations } from "../src/lib/__fixtures__/youtube";
const state = vi.hoisted(() => ({ worker: vi.fn(async () => {}) }));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: state.worker }));
const pg = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1",
  pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pg) {
  const target = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/pingufunk_qa"
  )
    throw Error("Disposable loopback PostgreSQL required");
}
let directory: string | undefined, cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  if (directory) rmSync(directory, { recursive: true });
  directory = undefined;
});
for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !pg)(
    `atomically binds new admission, preserves accepted receipts across disable/restart, and retains frozen retry on ${provider}`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-source-admission-"));
      let url = `file:${directory}/database.sqlite`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p17_jobs");
        url = target.href;
      }
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      const migrated = spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
        env: process.env,
        encoding: "utf8",
        timeout: 30000,
      });
      expect(migrated.status).toBe(0);
      vi.resetModules();
      let { prisma } = await import("../src/lib/db");
      cleanup = async () => {
        if (provider === "postgresql")
          await prisma.$executeRawUnsafe('DROP SCHEMA "p17_jobs" CASCADE');
        await prisma.$disconnect();
      };
      const policy = { key: "synthetic.source-policy", value: "enabled" };
      await prisma.config.upsert({ where: { key: policy.key }, create: policy, update: policy });
      const { createEnqueueIntent } = await import("../src/services/enqueue-intent");
      const { serializeMediaExpectations } = await import("../src/lib/media-expectations");
      const data = {
        id: randomUUID(),
        title: "Synthetic source.S01E01",
        url: "https://www.youtube.com/watch?v=abcdefghijk",
        category: "sonarr",
        status: "queued" as const,
        progress: 0,
        mediaExpectations: serializeMediaExpectations(syntheticYoutubeExpectations()),
      };
      const key = () => `${randomUUID()}:${Date.now()}`,
        intent = key(),
        admit = vi.fn(async () => [policy]);
      const accepted = await createEnqueueIntent(data, intent, admit);
      expect(accepted).toEqual({ id: data.id, created: true });
      expect(admit).toHaveBeenCalledTimes(1);
      expect(await prisma.config.findUnique({ where: { key: policy.key } })).toEqual(policy);
      await prisma.config.update({ where: { key: policy.key }, data: { value: "disabled" } });
      admit.mockRejectedValue(Error("current policy forbids new admission"));
      expect(await createEnqueueIntent({ ...data, id: randomUUID() }, intent, admit)).toEqual({
        id: data.id,
        created: false,
      });
      expect(admit).toHaveBeenCalledTimes(1);
      await expect(
        createEnqueueIntent({ ...data, id: randomUUID() }, key(), async () => [policy])
      ).rejects.toThrow("Source binding changed");
      expect(await prisma.download.count()).toBe(1);
      expect(await prisma.enqueueIntent.count()).toBe(1);
      await prisma.config.update({ where: { key: policy.key }, data: { value: "enabled" } });
      await expect(
        createEnqueueIntent({ ...data, id: randomUUID() }, key(), async () => {
          await prisma.config.update({ where: { key: policy.key }, data: { value: "disabled" } });
          return [policy];
        })
      ).rejects.toThrow("Source binding changed");
      expect(await prisma.download.count()).toBe(1);
      expect(await prisma.enqueueIntent.count()).toBe(1);
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
      ({ prisma } = await import("../src/lib/db"));
      const restarted = await import("../src/services/enqueue-intent");
      expect(
        await restarted.createEnqueueIntent({ ...data, id: randomUUID() }, intent, async () => {
          throw Error("Must not re-admit accepted intent");
        })
      ).toEqual({ id: data.id, created: false });
      const before = await prisma.download.findUniqueOrThrow({ where: { id: data.id } });
      expect(before.mediaExpectations).toBe(data.mediaExpectations);
      await prisma.download.update({ where: { id: data.id }, data: { status: "failed" } });
      const { retryDownload } = await import("../src/services/download");
      const retry = await retryDownload(data.id);
      expect(retry?.id).not.toBe(data.id);
      const retried = await prisma.download.findUniqueOrThrow({ where: { id: retry!.id } });
      expect(retried.mediaExpectations).toBe(data.mediaExpectations);
      expect(retried.url).toBe(data.url);
      expect(retried.status).toBe("queued");
      expect(await prisma.enqueueIntent.count()).toBe(1);
    },
    60000
  );
