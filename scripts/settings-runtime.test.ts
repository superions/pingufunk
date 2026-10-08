import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { NextRequest } from "next/server";

// Network providers are not part of the persistence contract.
vi.mock("@/services/srgssr-api", () => ({ clearTokenCache: vi.fn() }));
vi.mock("@/services/tvdb", () => ({ clearTvdbTokenCache: vi.fn() }));
const pgEnabled = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
const pgUrl = process.env.PINGUFUNK_TEST_DATABASE_URL;
if (pgEnabled) {
  const target = new URL(pgUrl ?? "");
  if (
    !["postgres:", "postgresql:"].includes(target.protocol) ||
    !["localhost", "127.0.0.1"].includes(target.hostname) ||
    target.pathname !== "/pingufunk_qa"
  ) {
    throw new Error("Disposable loopback PostgreSQL required");
  }
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
    `atomically persists normalized settings on real ${provider}, including second-write failure and restart`,
    async () => {
      directory = mkdtempSync(path.join(tmpdir(), "pingufunk-p12-settings-"));
      let url = `file:${path.join(directory, "database.sqlite")}`;
      if (provider === "postgresql") {
        const target = new URL(pgUrl!);
        target.searchParams.set("schema", "p12_settings");
        url = target.href;
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
      // Do not print connection diagnostics, even on a failed test.
      expect(migrated.status).toBe(0);
      vi.resetModules();
      let { prisma } = await import("@/lib/db");
      disconnect = () => prisma.$disconnect();
      const { POST, GET } = await import("@/app/api/settings/route");
      const { getSetting, clearSettingsCache } = await import("@/lib/settings");
      const post = (body: unknown) =>
        POST(
          new NextRequest("http://localhost/api/settings", {
            method: "POST",
            body: JSON.stringify(body),
          })
        );
      await prisma.config.deleteMany(); // Only the disposable owned schema/file.
      const saved = await post({
        "matching.strategy": "fuzzy",
        "matching.sonarr.tolerancePercent": "015",
      });
      expect(saved.status).toBe(200);
      expect((await saved.json()).settings).toEqual({
        "matching.strategy": "fuzzy",
        "matching.sonarr.tolerancePercent": "15",
      });
      expect(await getSetting("matching.strategy")).toBe("fuzzy");

      // Database-native fault: the first statement is legal; only the second
      // fails. Promise.all without a transaction leaves a partial policy.
      if (provider === "sqlite") {
        await prisma.$executeRawUnsafe(
          `CREATE TRIGGER p12_reject_setting BEFORE INSERT ON Config WHEN NEW.key = 'matching.movie.tolerancePercent' BEGIN SELECT RAISE(ABORT, 'synthetic settings fault'); END`
        );
      } else {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Config" ADD CONSTRAINT p12_reject_setting CHECK (key <> 'matching.movie.tolerancePercent')`
        );
      }
      try {
        const failed = await post({
          "matching.strategy": "strict",
          "matching.movie.tolerancePercent": "12",
        });
        expect(failed.status).toBe(500);
        expect((await failed.json()).committed).toBe("unknown");
        expect(await getSetting("matching.strategy")).toBe("fuzzy");
        expect(
          await prisma.config.findUnique({ where: { key: "matching.movie.tolerancePercent" } })
        ).toBeNull();
      } finally {
        await prisma.$executeRawUnsafe(
          provider === "sqlite"
            ? "DROP TRIGGER p12_reject_setting"
            : `ALTER TABLE "Config" DROP CONSTRAINT p12_reject_setting`
        );
      }
      for (const body of [
        { "matching.strategy": null },
        { "matching.strategy": {} },
        { "unknown.product": "true" },
        { "matching.movie.yearTolerance": "0" },
      ]) {
        expect((await post(body)).status).toBe(400);
      }
      expect(await getSetting("matching.strategy")).toBe("fuzzy");
      expect(
        (await post({ "matching.strategy": "strict", "matching.movie.yearTolerance": "02" })).status
      ).toBe(200);
      expect(await getSetting("matching.strategy")).toBe("strict");
      await prisma.config.create({ data: { key: "legacy.retained", value: "keep" } });
      await prisma.config.create({
        data: { key: "matching.movie.tolerancePercent", value: "invalid" },
      });
      clearSettingsCache();
      const readback = await GET(new NextRequest("http://localhost/api/settings"));
      expect(readback.headers.get("X-Pingufunk-Invalid-Settings")).toBe(
        "matching.movie.tolerancePercent"
      );
      expect(await readback.json()).toMatchObject({
        "legacy.retained": "keep",
        "matching.movie.tolerancePercent": "invalid",
        "matching.movie.yearTolerance": "2",
      });
      await prisma.$disconnect();
      delete (globalThis as { prisma?: unknown }).prisma;
      vi.resetModules();
      ({ prisma } = await import("@/lib/db"));
      expect(
        await prisma.config.findUniqueOrThrow({
          where: { key: "matching.sonarr.tolerancePercent" },
        })
      ).toMatchObject({ value: "15" });
      expect(
        await prisma.config.findUniqueOrThrow({ where: { key: "legacy.retained" } })
      ).toMatchObject({ value: "keep" });
      await prisma.config.deleteMany();
    },
    45_000
  );
}
