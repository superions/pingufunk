import { applySourceAdmission, type SourceAdmission } from "@/lib/source-admission";
import { createHash } from "node:crypto";
import { databaseProvider, prisma } from "@/lib/db";
import { serialSqliteEnqueue } from "@/lib/serial-enqueue";
import { assertWritesEnabled } from "@/lib/write-gate";
import {
  ENQUEUE_KEY_RETENTION_MS,
  EnqueueConflictError,
  EnqueueRequestError,
  parseEnqueueKey,
} from "@/lib/enqueue-request";

export interface EnqueuePayload {
  id: string;
  title: string;
  url: string;
  category: string;
  status: "queued";
  progress: number;
  mediaExpectations: string | null;
}
type IntentRow = {
  downloadId: string;
  payloadHash: string;
  expiresAt: Date;
};

function confirmed(row: IntentRow, payloadHash: string, now: Date): { id: string } {
  if (row.payloadHash !== payloadHash || row.expiresAt <= now) throw new EnqueueConflictError();
  return { id: row.downloadId };
}

/** Atomic receipt/job commit, never retrying after an uncertain transaction. */
export async function createEnqueueIntent(
  data: EnqueuePayload,
  rawKey: string,
  admit?: () => Promise<SourceAdmission | undefined>
): Promise<{ id: string; created: boolean }> {
  assertWritesEnabled();
  // SQLite has one writer. Admit local requests before entering a transaction,
  // never retry a BUSY/uncertain commit. The durable unique receipt remains the
  // cross-process authority; native unkeyed clients keep their own contract.
  return databaseProvider === "sqlite"
    ? serialSqliteEnqueue(() => commitEnqueueIntent(data, rawKey, admit))
    : commitEnqueueIntent(data, rawKey, admit);
}

async function commitEnqueueIntent(
  data: EnqueuePayload,
  rawKey: string,
  admit?: () => Promise<SourceAdmission | undefined>
): Promise<{ id: string; created: boolean }> {
  assertWritesEnabled();
  const key = parseEnqueueKey(rawKey);
  if (key === undefined) throw new EnqueueRequestError("Invalid enqueue key");
  const id = createHash("sha256").update(`ui-enqueue-v1\0${key}`).digest("hex");
  const payloadHash = createHash("sha256")
    .update(JSON.stringify([1, data.url, data.title, data.category, data.mediaExpectations]))
    .digest("hex");
  const now = new Date();
  const previous = await prisma.enqueueIntent.findUnique({ where: { id } });
  if (previous) return { ...confirmed(previous, payloadHash, now), created: false };
  // A matching durable receipt acknowledges an accepted job without reapplying
  // today's source policy. New admission must pass before cleanup or insertion.
  const admission = await admit?.();
  // Retention removes only expired receipts, never a job/history/file.
  // At most 100 rows per keyed enqueue; expiry is also checked on every read.
  const expired = await prisma.enqueueIntent.findMany({
    where: { expiresAt: { lte: now } },
    select: { id: true },
    orderBy: { id: "asc" },
    take: 100,
  });
  // Even an empty cleanup enters the PG first-write checkpoint outside the
  // transaction. Parallel first enqueues must not exhaust the pool while each
  // interactive transaction waits for an independent checkpoint connection.
  await prisma.enqueueIntent.deleteMany({
    where: { id: { in: expired.map((row) => row.id) }, expiresAt: { lte: now } },
  });
  try {
    const row = await prisma.$transaction(async (tx) => {
      await applySourceAdmission(tx, admission);
      await tx.enqueueIntent.create({
        data: {
          id,
          payloadHash,
          downloadId: data.id,
          expiresAt: new Date(Number(key.split(":")[1]) + ENQUEUE_KEY_RETENTION_MS),
        },
      });
      return tx.download.create({ data, select: { id: true } });
    });
    return { id: row.id, created: true };
  } catch (error) {
    // Only a proved unique conflict permits an acknowledgement lookup. Network/
    // commit uncertainty is returned to the caller, never retried blindly.
    if (!error || typeof error !== "object" || Reflect.get(error, "code") !== "P2002") throw error;
    const row = await prisma.enqueueIntent.findUnique({
      where: { id },
    });
    if (!row) throw error;
    return { ...confirmed(row, payloadHash, now), created: false };
  }
}
