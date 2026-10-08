import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { databaseProvider, prisma } from "@/lib/db";
import { assertWritesEnabled } from "@/lib/write-gate";

export const WORKER_LEASE_KEY = "internal.workerLease.v1";
const TTL_MS = 30_000;
const MARGIN_MS = 5000;
type Transaction = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
type RawDatabase = Pick<Transaction, "$queryRaw" | "$executeRaw">;
type LeaseRecord = { version: 1; owner: string; fence: string; expiresAt: number };
export class WorkerOwnershipError extends Error {
  constructor() {
    super("Worker ownership unavailable");
  }
}

function parseRecord(value: string): LeaseRecord {
  try {
    const row = JSON.parse(value);
    if (
      row.version !== 1 ||
      typeof row.owner !== "string" ||
      !/^(?:|[a-f\d-]{36})$/.test(row.owner) ||
      typeof row.fence !== "string" ||
      !/^\d{1,40}$/.test(row.fence) ||
      !Number.isSafeInteger(row.expiresAt) ||
      row.expiresAt < 0 ||
      Object.keys(row).sort().join() !== "expiresAt,fence,owner,version"
    )
      throw new Error();
    return row;
  } catch {
    throw new WorkerOwnershipError();
  }
}

async function databaseNow(db: RawDatabase = prisma): Promise<number> {
  const rows =
    databaseProvider === "postgresql"
      ? await db.$queryRaw<
          Array<{ now: bigint }>
        >`SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint AS now`
      : await db.$queryRaw<
          Array<{ now: bigint }>
        >`SELECT CAST(strftime('%s','now') AS INTEGER)*1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER) AS now`;
  const now = Number(rows[0]?.now);
  if (!Number.isSafeInteger(now) || now <= 0) throw new WorkerOwnershipError();
  return now;
}

/** Exact-value CAS plus authoritative database time in the mutation itself. */
async function cas(
  db: RawDatabase,
  before: string,
  after: string,
  boundary: number,
  mode: "expired" | "owned"
): Promise<number> {
  return databaseProvider === "postgresql"
    ? mode === "expired"
      ? db.$executeRaw`UPDATE "Config" SET value=${after} WHERE key=${WORKER_LEASE_KEY} AND value=${before} AND ${boundary} <= FLOOR(EXTRACT(EPOCH FROM clock_timestamp())*1000)`
      : db.$executeRaw`UPDATE "Config" SET value=${after} WHERE key=${WORKER_LEASE_KEY} AND value=${before} AND ${boundary} > FLOOR(EXTRACT(EPOCH FROM clock_timestamp())*1000)+${MARGIN_MS}`
    : mode === "expired"
      ? db.$executeRaw`UPDATE "Config" SET value=${after} WHERE key=${WORKER_LEASE_KEY} AND value=${before} AND ${boundary} <= CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)`
      : db.$executeRaw`UPDATE "Config" SET value=${after} WHERE key=${WORKER_LEASE_KEY} AND value=${before} AND ${boundary} > CAST(strftime('%s','now') AS INTEGER)*1000+CAST(substr(strftime('%f','now'),4,3) AS INTEGER)+${MARGIN_MS}`;
}

/** One database-wide worker. Expiry never authorizes automatic retransfers. */
export async function acquireWorkerLease(): Promise<WorkerLease | null> {
  assertWritesEnabled();
  await prisma.$prepareMutation();
  let existing = await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } });
  if (!existing) {
    try {
      existing = await prisma.config.create({
        data: {
          key: WORKER_LEASE_KEY,
          value: JSON.stringify({ version: 1, owner: "", fence: "0", expiresAt: 0 }),
        },
      });
    } catch (error) {
      // Only a proved concurrent insert permits a read, not an uncertain retry.
      if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "P2002")
        throw error;
      existing = await prisma.config.findUnique({ where: { key: WORKER_LEASE_KEY } });
      if (!existing) throw new WorkerOwnershipError();
    }
  }
  const previous = parseRecord(existing.value);
  const started = performance.now();
  const now = await databaseNow();
  if (previous.expiresAt > now) return null;
  const record: LeaseRecord = {
    version: 1,
    owner: randomUUID(),
    fence: String(BigInt(previous.fence) + BigInt(1)),
    expiresAt: now + TTL_MS,
  };
  const value = JSON.stringify(record);
  if ((await cas(prisma, existing.value, value, previous.expiresAt, "expired")) !== 1) return null;
  return new WorkerLease(record, value, performance.now() - started);
}

export class WorkerLease {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private tail: Promise<void> = Promise.resolve();
  private heartbeat: ReturnType<typeof setInterval>;
  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private released = false;
  private lost = false;

  constructor(
    private record: LeaseRecord,
    private value: string,
    elapsedMs: number
  ) {
    this.armWatchdog(elapsedMs);
    this.heartbeat = setInterval(() => {
      void this.serial(async () => {
        this.check();
        const started = performance.now();
        const now = await databaseNow();
        const next = { ...this.record, expiresAt: now + TTL_MS };
        const value = JSON.stringify(next);
        if ((await cas(prisma, this.value, value, this.record.expiresAt, "owned")) !== 1)
          throw new WorkerOwnershipError();
        this.record = next;
        this.value = value;
        this.armWatchdog(performance.now() - started);
      }).catch(() => this.lose());
    }, 5000);
    this.heartbeat.unref();
  }

  private armWatchdog(elapsedMs: number) {
    clearTimeout(this.watchdog);
    // Monotonic local watchdog is conservative; SQL time remains authoritative.
    const remaining = Math.max(0, TTL_MS - MARGIN_MS - elapsedMs);
    const deadline = performance.now() + remaining;
    const expire = () => {
      const left = deadline - performance.now();
      if (left <= 0) this.lose();
      else {
        // Timer rounding must not consume the only watchdog callback early.
        this.watchdog = setTimeout(expire, Math.ceil(left));
        this.watchdog.unref();
      }
    };
    this.watchdog = setTimeout(expire, Math.ceil(remaining));
    this.watchdog.unref();
  }
  get ownershipLost() {
    return this.lost;
  }
  private lose() {
    this.lost = true;
    this.controller.abort(new WorkerOwnershipError());
    clearInterval(this.heartbeat);
    clearTimeout(this.watchdog);
  }
  check() {
    assertWritesEnabled();
    if (this.lost || this.released) throw new WorkerOwnershipError();
  }
  checkTransfer() {
    this.check();
    this.signal.throwIfAborted();
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.tail.then(operation);
    this.tail = pending.then(
      () => {},
      () => {}
    );
    return pending;
  }

  /** Hold the lease-row lock through the job write, fencing late old owners. */
  async mutate<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      this.check();
      try {
        await prisma.$prepareMutation();
        return await prisma.$transaction(
          async (tx) => {
            this.check();
            if ((await cas(tx, this.value, this.value, this.record.expiresAt, "owned")) !== 1)
              throw new WorkerOwnershipError();
            return operation(tx);
          },
          { maxWait: 5000, timeout: 5000 }
        );
      } catch (error) {
        this.lose();
        throw error;
      }
    });
  }

  /** Abort transfers first; release only after the caller has drained children. */
  abort() {
    this.controller.abort();
  }
  async release(): Promise<void> {
    clearInterval(this.heartbeat);
    clearTimeout(this.watchdog);
    await this.serial(async () => {
      if (this.released) return;
      this.released = true;
      const idle = JSON.stringify({ ...this.record, owner: "", expiresAt: 0 });
      // A stale process must never clear a newer owner's lease.
      await prisma.$prepareMutation();
      await prisma.config.updateMany({
        where: { key: WORKER_LEASE_KEY, value: this.value },
        data: { value: idle },
      });
    });
  }
}
