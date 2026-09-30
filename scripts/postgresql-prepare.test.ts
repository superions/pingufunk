import { expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSmokeSource } from "./postgresql-smoke-fixture.mjs";
import { createSnapshot } from "./postgresql-snapshot.mjs";
import { hashSnapshotFile } from "./postgresql-import.mjs";
import { preparePostgresqlTarget } from "./postgresql-prepare.mjs";

const required = process.env.PINGUFUNK_REQUIRE_PG_TESTS === "1";
it.skipIf(!required)(
  "prepares only an empty owned schema and never deploys into foreign or written targets",
  async () => {
    const url = new URL(process.env.PINGUFUNK_TEST_DATABASE_URL ?? "");
    if (
      !["postgres:", "postgresql:"].includes(url.protocol) ||
      url.hostname !== "127.0.0.1" ||
      url.pathname !== "/pingufunk_qa" ||
      url.username !== "pingufunk_qa_runtime"
    )
      throw new Error("Disposable preparation role required");
    url.searchParams.set("schema", "p11_prepare");
    vi.stubEnv("DATABASE_URL", url.href);
    vi.stubEnv("DATABASE_URL_FILE", undefined);
    const dir = mkdtempSync(join(tmpdir(), "pingufunk-prepare-"));
    const pg = new PrismaClient({ datasourceUrl: url.href, log: [] });
    try {
      const source = join(dir, "source.sqlite");
      createSmokeSource(source);
      const snapshot = await createSnapshot(source, join(dir, "backup"));
      const args = {
        snapshotPath: snapshot.snapshotPath,
        expectedHash: snapshot.sha256,
        database: "pingufunk_qa",
        role: "pingufunk_qa_runtime",
        host: "127.0.0.1",
        requireTls: false,
      };
      const deploy = vi.fn();
      const missing = new URL(url);
      missing.searchParams.set("schema", "p11_missing_schema");
      vi.stubEnv("DATABASE_URL", missing.href);
      await expect(preparePostgresqlTarget({ ...args, deploy })).rejects.toThrow(
        "Unexpected or unprovisioned PostgreSQL schema"
      );
      expect(deploy).not.toHaveBeenCalled();
      vi.stubEnv("DATABASE_URL", url.href);
      await pg.$executeRawUnsafe("CREATE TABLE synthetic_foreign (id INTEGER PRIMARY KEY)");
      await pg.$executeRawUnsafe("INSERT INTO synthetic_foreign VALUES (1)");
      await expect(preparePostgresqlTarget({ ...args, deploy })).rejects.toThrow(
        "Unowned PostgreSQL schema"
      );
      expect(deploy).not.toHaveBeenCalled();
      expect(await pg.$queryRawUnsafe("SELECT id FROM synthetic_foreign")).toEqual([{ id: 1 }]);
      await pg.$executeRawUnsafe("DROP TABLE synthetic_foreign");
      await pg.$executeRawUnsafe("CREATE SEQUENCE synthetic_foreign_sequence");
      await expect(preparePostgresqlTarget({ ...args, deploy })).rejects.toThrow(
        "Unowned PostgreSQL schema"
      );
      expect(deploy).not.toHaveBeenCalled();
      await pg.$executeRawUnsafe("DROP SEQUENCE synthetic_foreign_sequence");
      expect((await preparePostgresqlTarget(args)).prepared).toBe(true);
      expect((await preparePostgresqlTarget({ ...args, deploy })).prepared).toBe(false);
      expect(deploy).not.toHaveBeenCalled();
      await pg.config.create({ data: { key: "synthetic-owned", value: "preserved" } });
      await expect(preparePostgresqlTarget({ ...args, deploy })).rejects.toThrow(
        "Prepare target is not empty"
      );
      expect(deploy).not.toHaveBeenCalled();
      expect((await pg.config.findUnique({ where: { key: "synthetic-owned" } }))?.value).toBe(
        "preserved"
      );
      expect(await hashSnapshotFile(snapshot.snapshotPath)).toBe(snapshot.sha256);
    } finally {
      await pg.$disconnect();
      rmSync(dir, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  },
  30000
);
