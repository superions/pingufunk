import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const required = process.env.PINGUFUNK_REQUIRE_PG_RECONNECT_TESTS === "1";
const configured = process.env.PINGUFUNK_TEST_DATABASE_URL;
const container = process.env.PINGUFUNK_TEST_RECONNECT_CONTAINER;

it.skipIf(!required)(
  "fails closed on an owned PG outage and reconnects without SQLite or maintenance writes",
  async () => {
    const url = new URL(configured ?? "");
    if (
      !container ||
      !/^pingufunk-ci-pg-\d+-\d+$/.test(container) ||
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/pingufunk_qa" ||
      url.username !== "pingufunk_qa_runtime"
    )
      throw new Error("Owned disposable reconnect target required");
    const published = execFileSync("docker", ["port", container, "5432/tcp"], {
      encoding: "utf8",
      timeout: 5000,
    }).trim();
    if (published !== `127.0.0.1:${url.port}`)
      throw new Error("Reconnect container and endpoint disagree");
    for (const key of ["connect_timeout", "pool_timeout", "socket_timeout"])
      url.searchParams.set(key, "1");
    vi.stubEnv("DATABASE_URL", url.href);
    vi.stubEnv("DATABASE_PROVIDER", undefined);
    vi.stubEnv("DATABASE_URL_FILE", undefined);
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
    const { prisma, databaseProvider } = await import("@/lib/db");
    const { GET } = await import("@/app/api/system/route");
    const { GET: health } = await import("@/app/api/health/route");
    const inspection = new PrismaClient({ datasourceUrl: url.href, log: [] });
    const sqlite = path.resolve("prisma/data/rundfunkarr.db");
    const fingerprint = () =>
      existsSync(sqlite) ? createHash("sha256").update(readFileSync(sqlite)).digest("hex") : null;
    let paused = false;
    try {
      const beforeSqlite = fingerprint();
      const count = await prisma.config.count();
      const checkpoint = await inspection.migrationCheckpoint.count();
      expect((await GET()).status).toBe(200);
      expect((await health(new NextRequest("http://localhost/api/health"))).status).toBe(200);
      execFileSync("docker", ["pause", container], { timeout: 5000, stdio: "ignore" });
      paused = true;
      expect((await GET()).status).toBe(500);
      expect((await health(new NextRequest("http://localhost/api/health?mode=live"))).status).toBe(
        200
      );
      expect((await health(new NextRequest("http://localhost/api/health"))).status).toBe(503);
      expect(databaseProvider).toBe("postgresql");
      expect(fingerprint()).toBe(beforeSqlite);
      execFileSync("docker", ["unpause", container], { timeout: 5000, stdio: "ignore" });
      paused = false;
      expect((await GET()).status).toBe(200);
      expect((await health(new NextRequest("http://localhost/api/health"))).status).toBe(200);
      expect(await prisma.config.count()).toBe(count);
      expect(await inspection.migrationCheckpoint.count()).toBe(checkpoint);
      expect(fingerprint()).toBe(beforeSqlite);
    } finally {
      if (paused)
        execFileSync("docker", ["unpause", container], { timeout: 5000, stdio: "ignore" });
      await prisma.$disconnect();
      await inspection.$disconnect();
      vi.unstubAllEnvs();
    }
  },
  20000
);
