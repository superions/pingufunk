import { prisma } from "@/lib/db";
import { DOWNLOAD_CONCURRENCY, getDownloadWorkerState } from "./download-worker-state";
import { acquireWorkerLease, WorkerOwnershipError, type WorkerLease } from "./worker-lease";
import { assertWritesEnabled } from "@/lib/write-gate";
import { isMkvConversionEnabled } from "@/lib/settings";
import { readPersistedMediaExpectations } from "@/lib/media-expectations";
import { MediaProbeError } from "./media-probe";
import { recordDecision } from "./decision-diagnostics";
import { parseDecisionEvent } from "@/lib/decision-diagnostics";
import { transferSource, downloadSource } from "./source-download";
import {
  assertNewOutputPath,
  categoryDirectory,
  ensureOwnedDirectory,
  getDownloadBasePath,
  jobDirectoryName,
  publicDownloadCategory,
  safeReleaseName,
} from "@/lib/download-paths";
import * as fs from "fs/promises";
import { createHash } from "node:crypto";
import * as path from "path";
import { SourceDownloadError } from "./download-failure";
import { completeValidatedDownload, moveIntoJobDir } from "./download-completion";

async function getDownloadTempPath(): Promise<string> {
  const basePath = await getDownloadBasePath();
  return process.env.DOWNLOAD_TEMP_PATH || path.join(basePath, "incomplete");
}

const runtime = getDownloadWorkerState();

/** Closed observation, never exposing lease owner/fence or database values. */
export function getWorkerRuntimeState() {
  return {
    state:
      runtime.pendingFailures.size > 0
        ? "paused"
        : runtime.processingPromise || runtime.directWork.size
          ? "draining"
          : "idle",
    configuredConcurrency: DOWNLOAD_CONCURRENCY,
    exclusiveOwnership: runtime.activeLease
      ? runtime.activeLease.ownershipLost
        ? "lost"
        : "held"
      : runtime.ownershipState,
  };
}

/** Recovery is legal only after exclusive acquisition; a busy owner is untouched. */
export async function recoverInterruptedDownloads(owned?: WorkerLease): Promise<number> {
  assertWritesEnabled();
  const lease = owned ?? (await acquireWorkerLease());
  if (!lease) return 0;
  try {
    const result = await lease.mutate((tx) =>
      tx.download.updateMany({
        where: { status: { in: ["downloading", "converting"] } },
        data: {
          status: "failed",
          error: "Interrupted by server restart; retry this job",
          completedAt: new Date(),
        },
      })
    );
    return result.count;
  } finally {
    if (!owned) await lease.release();
  }
}

export async function startDownloadProcessing(): Promise<void> {
  assertWritesEnabled();
  if (runtime.shuttingDown) throw new Error("Worker is shutting down");
  if (runtime.processingPromise) {
    // A new queue row can arrive just after the last empty poll. Run one
    // additional pass after the current drain rather than losing that wakeup.
    runtime.rerunRequested = true;
    return runtime.processingPromise;
  }

  runtime.processingPromise = (async () => {
    try {
      do {
        runtime.rerunRequested = false;
        await processQueue();
      } while (runtime.rerunRequested);
    } finally {
      runtime.processingPromise = null;
    }
  })();
  return runtime.processingPromise;
}

async function processQueue(): Promise<void> {
  let lease: WorkerLease | null = null;
  while (!runtime.shuttingDown && !lease) {
    lease = await acquireWorkerLease();
    if (!lease) {
      runtime.ownershipState = "waiting";
      if (!(await prisma.download.findFirst({ where: { status: "queued" }, select: { id: true } })))
        return;
      // Waiting follows only a proved busy lease, never an ambiguous DB mutation.
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  if (!lease) return;
  runtime.activeLease = lease;
  runtime.ownershipState = "held";
  try {
    for (const [id, error] of runtime.pendingFailures) {
      const row = await prisma.download.findUnique({ where: { id } });
      if (row && ["queued", "downloading", "converting"].includes(row.status))
        await markAsFailed(id, error, lease);
      else runtime.pendingFailures.delete(id);
    }
    await recoverInterruptedDownloads(lease);
    while (!runtime.shuttingDown) {
      lease.checkTransfer();
      // Get next queued download
      const nextDownload = await prisma.download.findFirst({
        where: { status: "queued" },
        orderBy: { createdAt: "asc" },
      });

      if (!nextDownload) {
        // No more items in queue
        break;
      }

      // The configured concurrency is one; await status persistence before
      // polling again so the same queued row cannot be scheduled repeatedly.
      await processOwnedDownload(nextDownload.id, lease);
    }
  } finally {
    // Transfers/children have settled before ownership can pass to another process.
    try {
      await lease.release();
    } finally {
      runtime.activeLease = null;
      runtime.ownershipState = "idle";
    }
  }
}

/** Stop scheduling and abort only this process's transfers; do not re-grab. */
export async function shutdownDownloadProcessing(): Promise<void> {
  runtime.shuttingDown = true;
  runtime.activeLease?.abort();
  await runtime.processingPromise;
  await Promise.all(runtime.directWork);
}

/** The app composes background cleanup; the queue never needs source-specific shutdown branches. */
export function installWorkerShutdownHandlers(stopBackground?: () => Promise<void>): void {
  if (runtime.shutdownHandlersInstalled) return;
  runtime.shutdownHandlersInstalled = true;
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      // This exact process owns the worker and tools. If persistence is unavailable,
      // leave expiry/recovery to the next owner instead of pretending a release.
      const limit = setTimeout(() => process.exit(1), 12_000);
      void Promise.all([shutdownDownloadProcessing(), stopBackground?.()])
        .then(async () => {
          await prisma.$disconnect();
          clearTimeout(limit);
          process.exit(signal === "SIGINT" ? 130 : 143);
        })
        .catch(() => {
          clearTimeout(limit);
          process.exit(1);
        });
    });
}

async function processDownload(downloadId: string): Promise<void> {
  assertWritesEnabled();
  const work = executeSingleDownload(downloadId);
  runtime.directWork.add(work);
  try {
    await work;
  } finally {
    runtime.directWork.delete(work);
  }
}

async function executeSingleDownload(downloadId: string): Promise<void> {
  assertWritesEnabled();
  await runtime.semaphore.acquire();
  let lease: WorkerLease | null = null;
  try {
    if (runtime.shuttingDown) throw new Error("Worker is shutting down");
    lease = await acquireWorkerLease();
    if (!lease) throw new WorkerOwnershipError();
    runtime.activeLease = lease;
    await recoverInterruptedDownloads(lease);
    await processOwnedDownload(downloadId, lease);
  } finally {
    try {
      await lease?.release();
    } finally {
      if (runtime.activeLease === lease) runtime.activeLease = null;
      runtime.semaphore.release();
    }
  }
}

async function processOwnedDownload(downloadId: string, lease: WorkerLease): Promise<void> {
  lease.checkTransfer();

  const startTime = Date.now();
  let tempJobDir: string | null = null;
  let completeJobDir: string | null = null;
  let failureMessage = "Download processing failed";

  try {
    // Get download info
    const download = await prisma.download.findUnique({
      where: { id: downloadId },
    });

    if (!download || download.status !== "queued") {
      return;
    }
    const expectations = readPersistedMediaExpectations(download.mediaExpectations);
    if (expectations?.version === 4) {
      // Approval belongs to this durable job and exact source, including after
      // restart. Revalidate before transferring any bytes, not just at UI time.
      const { revalidateApprovedTvJob } = await import("@/services/tv-source-review");
      await revalidateApprovedTvJob(download, expectations);
    }

    console.log(`[Download] Starting: ${download.title}`);

    // Mark as downloading
    await lease.mutate((tx) =>
      tx.download.update({
        where: { id: downloadId, status: "queued" },
        data: { status: "downloading" },
      })
    );

    // A job owns both staging and completed output, even if another job has
    // the same public release title or a consumer removes an imported folder.
    const downloadBasePath = await getDownloadBasePath();
    const downloadTempPath = await getDownloadTempPath();
    const categoryDir = categoryDirectory(
      downloadBasePath,
      publicDownloadCategory(download.category)
    );
    const jobDirName = jobDirectoryName(download.title, download.id);
    tempJobDir = path.join(downloadTempPath, jobDirName);
    completeJobDir = path.join(categoryDir, jobDirName);
    const filename = safeReleaseName(download.title);
    await ensureOwnedDirectory(downloadTempPath, tempJobDir);
    await ensureOwnedDirectory(downloadBasePath, categoryDir);
    await ensureOwnedDirectory(categoryDir, completeJobDir);

    let selectedContainer: Promise<"mkv" | "mp4"> | undefined;
    const getContainer = () =>
      (selectedContainer ??= isMkvConversionEnabled().then((enabled) =>
        enabled ? ("mkv" as const) : ("mp4" as const)
      ));
    // The validated durable payload selects its source; the worker stays source-agnostic.
    const artifact = await transferSource(downloadSource(download.url, expectations), {
      stagingDirectory: tempJobDir,
      filename,
      getContainer,
      expectations,
      signal: lease.signal,
      onProgress: async (progress, downloadedBytes, totalBytes, speed) => {
        lease.checkTransfer();
        await lease.mutate((tx) =>
          tx.download.update({
            where: { id: downloadId },
            data: { progress, downloadedBytes, totalSize: totalBytes, speed },
          })
        );
      },
    });
    lease.checkTransfer();
    let stagedPath = artifact.path;
    let extension = artifact.extension;
    let convertedInput: string | undefined;
    if (extension.toLowerCase() === ".mp4" && (await getContainer()) === "mkv") {
      const convertedPath = path.join(tempJobDir, `${filename}.mkv`);
      await assertNewOutputPath(convertedPath);
      lease.checkTransfer();
      await lease.mutate((tx) =>
        tx.download.update({ where: { id: downloadId }, data: { status: "converting" } })
      );
      const { convertMp4ToMkv } = await import("./ffmpeg");
      const conversion = await convertMp4ToMkv(stagedPath, convertedPath, undefined, lease.signal);
      if (!conversion.success) {
        await fs.unlink(stagedPath).catch(() => {});
        await markAsFailed(downloadId, conversion.error || "Conversion failed", lease);
        return;
      }
      convertedInput = stagedPath;
      stagedPath = convertedPath;
      extension = ".mkv";
    }

    // Every backend converges on the same owned move and physical media gate.
    const finalPath = path.join(completeJobDir, filename + extension);
    lease.checkTransfer();
    await moveIntoJobDir(
      stagedPath,
      finalPath,
      tempJobDir,
      downloadBasePath,
      categoryDir,
      completeJobDir
    );
    // Retain the original until moving its converted output actually succeeds.
    if (convertedInput) await fs.unlink(convertedInput).catch(() => {});
    const stats = await fs.stat(finalPath);
    await completeValidatedDownload(
      downloadId,
      finalPath,
      completeJobDir,
      expectations,
      download.url,
      lease
    );
    const downloadTime = Math.floor((Date.now() - startTime) / 1000);
    console.log(
      `[Download] Completed: ${download.title} (${Math.round(stats.size / 1024 / 1024)}MB in ${downloadTime}s)`
    );
  } catch (error) {
    if (error instanceof SourceDownloadError) {
      failureMessage = error.message;
      if (error.transferFailure) {
        recordDecision("transfer", "transfer_failed", "unavailable");
        console.error("[Download] Transfer failure", {
          jobRef: createHash("sha256").update(downloadId).digest("hex").slice(0, 16),
          ...error.transferFailure,
        });
      }
    }
    if (error instanceof MediaProbeError) {
      // Closed probe facts survive persistence; never copy arbitrary exception messages.
      const event = parseDecisionEvent({
        stage: "media",
        reason: error.reason,
        evidence: error.evidence,
        count: 1,
      });
      if (event)
        failureMessage = `Local media validation failed: ${JSON.stringify({ version: 1, stage: event.stage, reason: event.reason, evidence: event.evidence })}`;
    }
    console.error(`[Download] Error processing download ${downloadId}`);
    await markAsFailed(
      downloadId,
      runtime.shuttingDown
        ? "Worker interrupted; retry this job explicitly"
        : (runtime.pendingFailures.get(downloadId) ?? failureMessage),
      lease
    );
  } finally {
    // Remove only empty directories owned by this job. A failed tool's
    // unexpected leftovers remain visible for diagnosis, never swept broadly.
    for (const directory of [tempJobDir, completeJobDir]) {
      if (!directory) continue;
      await fs.rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) {
          console.error("[Download] Could not remove empty job directory");
        }
      });
    }
  }
}

async function markAsFailed(downloadId: string, error: string, lease: WorkerLease): Promise<void> {
  runtime.pendingFailures.set(downloadId, error);
  // A lost transaction acknowledgement is not proof of rollback. Preserve an
  // already durable terminal row instead of overwriting a verified completion.
  const row = await prisma.download.findUnique({ where: { id: downloadId } });
  if (!row || ["completed", "failed"].includes(row.status)) {
    runtime.pendingFailures.delete(downloadId);
    return;
  }
  await lease.mutate((tx) =>
    tx.download.update({
      where: { id: downloadId },
      data: {
        status: "failed",
        error,
        completedAt: new Date(),
      },
    })
  );
  runtime.pendingFailures.delete(downloadId);
}

// Export for use in API routes
export { processDownload };
