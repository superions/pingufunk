import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";

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
afterEach(() => {
  delete (globalThis as { prisma?: unknown }).prisma;
  vi.unstubAllEnvs();
  vi.resetModules();
});

function fixture(env: NodeJS.ProcessEnv) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", path.resolve("scripts/worker-lease-fixture.ts")],
    {
      env,
      stdio: ["ignore", "ignore", "ignore", "ipc"],
    }
  );
  let next = 0;
  const pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    readyResolve = resolve;
    readyReject = reject;
  });
  const readyTimer = setTimeout(
    () => readyReject(new Error("Fixture readiness deadline exceeded")),
    10000
  );
  child.on(
    "message",
    (message: { ready?: boolean; id: number; value?: unknown; error?: string }) => {
      if (message.ready) {
        clearTimeout(readyTimer);
        readyResolve();
        return;
      }
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error("Fixture operation unavailable"));
      else request.resolve(message.value);
    }
  );
  child.on("error", () => readyReject(new Error("Fixture failed to spawn")));
  child.on("exit", () => {
    clearTimeout(readyTimer);
    readyReject(new Error("Fixture exited before readiness"));
    for (const request of pending.values()) request.reject(new Error("Fixture exited"));
    pending.clear();
  });
  return {
    child,
    ready,
    call: (action: string, job?: string) =>
      new Promise<unknown>((resolve, reject) => {
        const id = ++next;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error("Fixture deadline exceeded"));
        }, 12000);
        pending.set(id, {
          resolve: (value) => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        });
        child.send({ id, action, job });
      }),
  };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const limit = setTimeout(() => child.kill("SIGKILL"), 2000);
  try {
    await exited;
  } finally {
    clearTimeout(limit);
  }
}

for (const provider of ["sqlite", "postgresql"] as const)
  it.skipIf(provider === "postgresql" && !enabled)(
    `fences two real worker processes, expiry, late owner and recovery on ${provider}`,
    async () => {
      const root = mkdtempSync(path.join(tmpdir(), "pingufunk-worker-lease-"));
      const target = provider === "postgresql" ? new URL(pgUrl!) : null;
      target?.searchParams.set("schema", "p15_workers");
      const url = target?.href ?? `file:${path.join(root, "db.sqlite")}`;
      vi.stubEnv("DATABASE_URL", url);
      vi.stubEnv("DATABASE_URL_FILE", undefined);
      vi.stubEnv("DATABASE_PROVIDER", provider);
      vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
      vi.resetModules();
      expect(
        spawnSync(process.execPath, [path.resolve("scripts/database-migrate.mjs")], {
          env: process.env,
          encoding: "utf8",
          timeout: 30000,
        }).status
      ).toBe(0);
      const { prisma } = await import("../src/lib/db");
      const { jobDirectoryName } = await import("../src/lib/download-paths");
      const { WORKER_LEASE_KEY } = await import("../src/server/worker-lease");
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        DOWNLOAD_TEMP_PATH: path.join(root, "incomplete"),
      };
      delete env.DATABASE_URL_FILE;
      const first = fixture(env);
      const second = fixture(env);
      const requests: string[] = [];
      const server = createServer((req, res) => {
        requests.push(req.url!);
        if (req.url === "/hold.mp4") {
          res.writeHead(200, { "content-length": "100" });
          res.write(Buffer.from([1]));
          return;
        }
        res.writeHead(200, { "content-length": "4" });
        res.end(Buffer.from([1, 2, 3, 4]));
      });
      try {
        await Promise.all([first.ready, second.ready]);
        await prisma.config.createMany({
          data: [
            { key: "download.path", value: root },
            { key: "download.convertToMkv", value: "false" },
          ],
        });
        await prisma.download.createMany({
          data: [
            {
              id: "active",
              title: "Synthetic",
              status: "converting",
              category: "tv",
              url: "https://example.invalid/never",
            },
            {
              id: "completed",
              title: "Synthetic",
              status: "completed",
              category: "tv",
              url: "https://example.invalid/never",
              filePath: "/synthetic/preserved",
              size: 42,
            },
          ],
        });
        expect(await first.call("acquire")).toEqual({ acquired: true });
        const acquiredValue = (await prisma.config.findUnique({
          where: { key: WORKER_LEASE_KEY },
        }))!.value;
        await vi.waitFor(
          async () => {
            expect(
              (await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } }))!.value
            ).not.toBe(acquiredValue);
          },
          { timeout: 6500, interval: 100 }
        );
        expect(await second.call("acquire")).toEqual({ acquired: false });
        expect(await second.call("recover")).toEqual({ count: 0 });
        expect((await prisma.download.findUnique({ where: { id: "active" } }))?.status).toBe(
          "converting"
        );
        expect(await first.call("mutate", "active")).toEqual({ written: true });
        const before = (await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } }))!;
        const record = JSON.parse(before.value);
        // This isolated clock-expiry injection must invalidate the old exact CAS.
        await prisma.config.update({
          where: { key: WORKER_LEASE_KEY },
          data: { value: JSON.stringify({ ...record, expiresAt: 0 }) },
        });
        expect(await second.call("acquire")).toEqual({ acquired: true });
        await expect(first.call("mutate", "active")).rejects.toThrow("unavailable");
        expect((await prisma.download.findUnique({ where: { id: "active" } }))?.progress).toBe(77);
        const newLease = (await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } }))!
          .value;
        await first.call("release");
        expect((await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } }))!.value).toBe(
          newLease
        );
        expect(await second.call("recover")).toEqual({ count: 1 });
        expect(await prisma.download.findUnique({ where: { id: "completed" } })).toMatchObject({
          status: "completed",
          filePath: "/synthetic/preserved",
          size: BigInt(42),
        });
        await second.call("release");
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const address = server.address() as { port: number };
        await prisma.download.create({
          data: {
            id: "following",
            title: "Synthetic.Next",
            category: "tv",
            url: `http://127.0.0.1:${address.port}/fixture.mp4`,
          },
        });
        expect(await first.call("queue")).toEqual({ drained: true });
        expect(await prisma.download.findUnique({ where: { id: "following" } })).toMatchObject({
          status: "failed",
          error: expect.stringContaining("Local media validation failed"),
        });
        const neighbor = path.join(root, "neighbor.sentinel");
        writeFileSync(neighbor, "untouched");
        await prisma.download.createMany({
          data: [
            {
              id: "shutdown",
              createdAt: new Date(0),
              title: "Synthetic.Shutdown",
              category: "tv",
              url: `http://127.0.0.1:${address.port}/hold.mp4`,
            },
            {
              id: "after-shutdown",
              title: "Synthetic.After",
              category: "tv",
              url: `http://127.0.0.1:${address.port}/after.mp4`,
            },
          ],
        });
        const firstDrain = first.call("queue");
        await vi.waitFor(
          async () => {
            expect((await prisma.download.findUnique({ where: { id: "shutdown" } }))?.status).toBe(
              "downloading"
            );
            expect(requests.filter((r) => r === "/hold.mp4")).toHaveLength(1);
          },
          { timeout: 5000 }
        );
        const secondDrain = second.call("queue");
        expect(await second.call("recover")).toEqual({ count: 0 });
        expect((await prisma.download.findUnique({ where: { id: "shutdown" } }))?.status).toBe(
          "downloading"
        );
        expect(await first.call("shutdown")).toEqual({ stopped: true });
        expect(await firstDrain).toEqual({ drained: true });
        expect(await secondDrain).toEqual({ drained: true });
        expect((await prisma.download.findUnique({ where: { id: "shutdown" } }))?.status).toBe(
          "failed"
        );
        expect(
          (await prisma.download.findUnique({ where: { id: "after-shutdown" } }))?.status
        ).toBe("failed");
        expect(requests.filter((r) => r === "/hold.mp4")).toHaveLength(1);
        expect(requests.filter((r) => r === "/after.mp4")).toHaveLength(1);
        expect(readFileSync(neighbor, "utf8")).toBe("untouched");
        expect(
          existsSync(
            path.join(
              root,
              "incomplete",
              jobDirectoryName("Synthetic.Shutdown", "shutdown"),
              "Synthetic.Shutdown.mp4"
            )
          )
        ).toBe(false);
        // Actual crash: no release, a contender must not recover before DB expiry.
        expect(await first.call("acquire")).toEqual({ acquired: true });
        const crashed = (await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } }))!;
        const died = once(first.child, "exit");
        first.child.kill("SIGKILL");
        await died;
        expect(await second.call("acquire")).toEqual({ acquired: false });
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, JSON.parse(crashed.value).expiresAt - Date.now() + 50))
        );
        expect(await second.call("acquire")).toEqual({ acquired: true });
        await second.call("release");
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
        await expect(
          (await import("../src/server/worker-lease")).acquireWorkerLease()
        ).rejects.toThrow("writes are disabled");
      } finally {
        await Promise.all([stop(first.child), stop(second.child)]);
        server.closeAllConnections();
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
        vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
        if (provider === "postgresql") {
          await prisma.download.deleteMany();
          await prisma.config.deleteMany();
        }
        await prisma.$disconnect();
        rmSync(root, { recursive: true, force: true });
      }
    },
    60000
  );
