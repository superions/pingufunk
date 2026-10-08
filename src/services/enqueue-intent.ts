import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
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
  rawKey: string
): Promise<{ id: string; created: boolean }> {
  assertWritesEnabled();
  const key = parseEnqueueKey(rawKey);
  if (key === undefined) throw new EnqueueRequestError("Invalid enqueue key");
  const id = createHash("sha256").update(`ui-enqueue-v1\0${key}`).digest("hex");
  const payloadHash = createHash("sha256")
    .update(JSON.stringify([1, data.url, data.title, data.category, data.mediaExpectations]))
    .digest("hex");
  const now = new Date();
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
  const previous = await prisma.enqueueIntent.findUnique({
    where: { id },
  });
  if (previous) {
    // Never silently create another transfer for an expired or different intent.
    return { ...confirmed(previous, payloadHash, now), created: false };
  }
  try {
    const row = await prisma.$transaction(async (tx) => {
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
