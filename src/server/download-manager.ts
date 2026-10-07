import { prisma } from "@/lib/db";
import { assertWritesEnabled } from "@/lib/write-gate";
import { getSetting, isMkvConversionEnabled } from "@/lib/settings";
import {
  readPersistedMediaExpectations,
  sourceAudioExpectation,
  type MediaExpectations,
} from "@/lib/media-expectations";
import { configuredSetting } from "@/lib/settings-schema";
import { probeJobMedia } from "./media-probe";
import { downloadHlsStream } from "./ytdlp";
import { getStreamHeight, isStreamingUrl, srfUrnFromUrl } from "@/lib/stream-url";
import {
  assertNewOutputPath,
  categoryDirectory,
  ensureOwnedDirectory,
  getDownloadBasePath,
  jobDirectoryName,
  publicDownloadCategory,
  safeFileExtension,
  safeReleaseName,
} from "@/lib/download-paths";
import * as fs from "fs/promises";
import { constants, createWriteStream } from "fs";
import { createHash } from "node:crypto";
import * as path from "path";
import {
  safeTransferErrorCode,
  transferFailureMessage,
  type TransferFailure,
  type TransferPhase,
} from "./download-failure";

const MAX_CONCURRENT_DOWNLOADS = 1;

async function getDownloadTempPath(): Promise<string> {
  const basePath = await getDownloadBasePath();
  return process.env.DOWNLOAD_TEMP_PATH || path.join(basePath, "incomplete");
}

// Semaphore implementation for limiting concurrent downloads
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

const downloadSemaphore = new Semaphore(MAX_CONCURRENT_DOWNLOADS);
let processingPromise: Promise<void> | null = null;
let rerunRequested = false;
// A failed DB write pauses the drain. Reconcile only this worker's interrupted jobs
// before the next explicit wakeup; cold-start recovery covers process loss.
const pendingFailures = new Map<string, string>();

/** Only the single production worker calls this once at a cold start. */
export async function recoverInterruptedDownloads(): Promise<number> {
  assertWritesEnabled();
  const result = await prisma.download.updateMany({
    where: { status: { in: ["downloading", "converting"] } },
    data: {
      status: "failed",
      error: "Interrupted by server restart; retry this job",
      completedAt: new Date(),
    },
  });
  return result.count;
}

export async function startDownloadProcessing(): Promise<void> {
  assertWritesEnabled();
  if (processingPromise) {
    // A new queue row can arrive just after the last empty poll. Run one
    // additional pass after the current drain rather than losing that wakeup.
    rerunRequested = true;
    return processingPromise;
  }

  processingPromise = (async () => {
    try {
      do {
        rerunRequested = false;
        await processQueue();
      } while (rerunRequested);
    } finally {
      processingPromise = null;
    }
  })();
  return processingPromise;
}

async function processQueue(): Promise<void> {
  for (const [id, error] of pendingFailures) {
    const row = await prisma.download.findUnique({ where: { id } });
    if (row && ["queued", "downloading", "converting"].includes(row.status))
      await markAsFailed(id, error);
    else pendingFailures.delete(id);
  }
  while (true) {
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
    await processDownload(nextDownload.id);
  }
}

/** All transfer/mux paths converge here before exposing import-ready history. */
async function completeValidatedDownload(
  id: string,
  filePath: string,
  jobDirectory: string,
  expectations: MediaExpectations | null,
  sourceUrl: string
): Promise<void> {
  // Frozen v3 references never re-read current GUI policy. The dynamic Sonarr
  // tolerance remains only for shipped unversioned/v1/v2 compatibility.
  const tolerance =
    expectations?.version === 3
      ? 0
      : Number(
          configuredSetting(
            "matching.sonarr.tolerancePercent",
            await getSetting("matching.sonarr.tolerancePercent")
          )
        );
  const facts = sourceAudioExpectation(expectations)
    ? await probeJobMedia(filePath, jobDirectory, expectations, tolerance, sourceUrl)
    : await probeJobMedia(filePath, jobDirectory, expectations, tolerance);
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0)
    throw new Error("Invalid completed media file");
  // A statement timeout must not leave an unacknowledged autocommit write queued
  // on a suspended connection. Commit only after the verified write returned.
  // A lost COMMIT acknowledgement can still be ambiguous; reconcile by reading
  // the durable row on the next wakeup, never by redownloading or provider fallback.
  await prisma.$transaction(
    async (tx) => {
      await tx.download.update({
        where: { id },
        data: {
          status: "completed",
          progress: 100,
          size: stats.size,
          filePath,
          completedAt: new Date(),
          mediaValidation: JSON.stringify({ version: expectations?.version ?? 1, ...facts }),
        },
      });
    },
    { maxWait: 5000, timeout: 5000 }
  );
}

/**
 * Move a finished file into its private job folder.
 *
 * The folder was created when the download started, but *arr apps remove the
 * imported file from the category folder while later downloads are still
 * running, and delete the folder once it is empty -- so it is re-created
 * right before the move. That still leaves a moment between mkdir and link;
 * if an import deletes the folder in exactly that instant, the ENOENT is
 * answered with one more re-create and retry. A missing SOURCE file also
 * surfaces as ENOENT and fails the retry identically, which is correct.
 */
async function moveIntoJobDir(
  sourcePath: string,
  targetPath: string,
  tempJobDir: string,
  basePath: string,
  categoryDir: string,
  jobDir: string
): Promise<void> {
  if (path.dirname(path.resolve(sourcePath)) !== path.resolve(tempJobDir)) {
    throw new Error("Download result is outside its temporary job directory");
  }
  const sourceStat = await fs.lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Download result is not a regular job file");
  }
  const ensureTarget = async () => {
    await ensureOwnedDirectory(basePath, categoryDir);
    await ensureOwnedDirectory(categoryDir, jobDir);
  };
  await ensureTarget();
  const move = async () => {
    try {
      // link creates the target without replacing an existing file or symlink.
      await fs.link(sourcePath, targetPath);
    } catch (error) {
      // Cross-device moves and filesystems without hard-link support still
      // create a fresh target exclusively before removing the source.
      if (
        !["EXDEV", "EPERM", "EOPNOTSUPP", "ENOTSUP"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      ) {
        throw error;
      }
      await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    }
    await fs.unlink(sourcePath);
  };
  try {
    await move();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await ensureTarget();
    await move();
  }
}

async function processDownload(downloadId: string): Promise<void> {
  assertWritesEnabled();
  await downloadSemaphore.acquire();

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

    console.log(`[Download] Starting: ${download.title}`);

    // Mark as downloading
    await prisma.download.update({
      where: { id: downloadId },
      data: { status: "downloading" },
    });

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

    // Check if this is an HLS stream
    const isHls = isStreamingUrl(download.url);

    if (isHls) {
      // HLS download path - use yt-dlp
      console.log(`[Download] Detected HLS stream, using yt-dlp`);

      // Resolve stable SRF references at download time. The SRGSSR extractor
      // also obtains Akamai tokens and uses the configured proxy for metadata.
      const urn = srfUrnFromUrl(download.url);
      const maxHeight = getStreamHeight(download.url);
      const streamUrl = urn
        ? urn.replace(/^urn:/, "srgssr:")
        : maxHeight
          ? download.url.split("#")[0]
          : download.url;
      const container = (await isMkvConversionEnabled()) ? "mkv" : "mp4";
      const tempMkvPath = path.join(tempJobDir, `${filename}.${container}`);
      const finalMkvPath = path.join(completeJobDir, `${filename}.${container}`);
      await assertNewOutputPath(tempMkvPath);

      const hlsResult = await downloadHlsStream(
        streamUrl,
        tempMkvPath,
        async (progress, downloadedBytes, totalBytes, speed) => {
          await prisma.download.update({
            where: { id: downloadId },
            data: {
              progress,
              downloadedBytes,
              totalSize: totalBytes,
              speed,
            },
          });
        },
        container,
        maxHeight
      );

      if (!hlsResult.success) {
        await markAsFailed(downloadId, hlsResult.error || "HLS download failed");
        return;
      }

      // Move to final location
      const outputPath = hlsResult.outputPath || tempMkvPath;
      console.log(`[Download] Moving HLS result to final location: ${finalMkvPath}`);
      await moveIntoJobDir(
        outputPath,
        finalMkvPath,
        tempJobDir,
        downloadBasePath,
        categoryDir,
        completeJobDir
      );

      // Get file size
      const stats = await fs.stat(finalMkvPath);

      // Persist completion only after the local media gate.
      const downloadTime = Math.floor((Date.now() - startTime) / 1000);

      await completeValidatedDownload(
        downloadId,
        finalMkvPath,
        completeJobDir,
        expectations,
        download.url
      );

      console.log(
        `[Download] HLS completed: ${download.title} (${Math.round(stats.size / 1024 / 1024)}MB in ${downloadTime}s)`
      );
      return;
    }

    // Standard direct download path
    // Determine file extension from URL
    const urlPath = new URL(download.url).pathname;
    const fileExtension = safeFileExtension(urlPath);
    // Download to temp folder first
    const tempMp4Path = path.join(tempJobDir, `${filename}${fileExtension}`);
    const mp4Path = tempMp4Path;

    // Download the file
    const downloadFailure = await downloadFile(
      download.url,
      mp4Path,
      async (progress, downloadedBytes, totalBytes, speed) => {
        await prisma.download.update({
          where: { id: downloadId },
          data: {
            progress,
            downloadedBytes,
            totalSize: totalBytes,
            speed,
          },
        });
      }
    );

    if (downloadFailure) {
      console.error("[Download] Transfer failure", {
        jobRef: createHash("sha256").update(downloadId).digest("hex").slice(0, 16),
        ...downloadFailure,
      });
      failureMessage = transferFailureMessage(downloadFailure);
      await markAsFailed(downloadId, failureMessage);
      return;
    }

    console.log(`[Download] File downloaded to temp: ${mp4Path}`);

    // Convert MP4 files to MKV unless the user disabled this step.
    if (fileExtension.toLowerCase() === ".mp4" && (await isMkvConversionEnabled())) {
      // Convert in temp folder first
      const tempMkvPath = path.join(tempJobDir, `${filename}.mkv`);
      const finalMkvPath = path.join(completeJobDir, `${filename}.mkv`);
      await assertNewOutputPath(tempMkvPath);

      console.log(`[Download] Converting to MKV: ${tempMkvPath}`);

      await prisma.download.update({
        where: { id: downloadId },
        data: { status: "converting" },
      });

      const { convertMp4ToMkv } = await import("./ffmpeg");
      const conversionResult = await convertMp4ToMkv(mp4Path, tempMkvPath);

      if (!conversionResult.success) {
        // Clean up temp file on failure
        await fs.unlink(mp4Path).catch(() => {});
        await markAsFailed(downloadId, conversionResult.error || "Conversion failed");
        return;
      }

      // Move completed MKV to final location; see moveIntoJobDir for why
      // the category directory is re-created here.
      console.log(`[Download] Moving to final location: ${finalMkvPath}`);
      await moveIntoJobDir(
        tempMkvPath,
        finalMkvPath,
        tempJobDir,
        downloadBasePath,
        categoryDir,
        completeJobDir
      );

      // Clean up temp MP4 file
      await fs.unlink(mp4Path).catch(() => {});

      // Get file size
      const stats = await fs.stat(finalMkvPath);

      // Persist completion only after the local media gate.
      const downloadTime = Math.floor((Date.now() - startTime) / 1000);

      await completeValidatedDownload(
        downloadId,
        finalMkvPath,
        completeJobDir,
        expectations,
        download.url
      );

      console.log(
        `[Download] Completed: ${download.title} (${Math.round(stats.size / 1024 / 1024)}MB in ${downloadTime}s)`
      );
    } else {
      // Keep non-MP4 files and MP4 files with disabled conversion unchanged.
      const finalPath = path.join(completeJobDir, `${filename}${fileExtension}`);
      await moveIntoJobDir(
        mp4Path,
        finalPath,
        tempJobDir,
        downloadBasePath,
        categoryDir,
        completeJobDir
      );

      const stats = await fs.stat(finalPath);

      await completeValidatedDownload(
        downloadId,
        finalPath,
        completeJobDir,
        expectations,
        download.url
      );

      console.log(
        `[Download] Completed: ${download.title} (${Math.round(stats.size / 1024 / 1024)}MB)`
      );
    }
  } catch {
    console.error(`[Download] Error processing download ${downloadId}`);
    await markAsFailed(downloadId, failureMessage);
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
    downloadSemaphore.release();
  }
}

async function markAsFailed(downloadId: string, error: string): Promise<void> {
  pendingFailures.set(downloadId, error);
  // A lost transaction acknowledgement is not proof of rollback. Preserve an
  // already durable terminal row instead of overwriting a verified completion.
  const row = await prisma.download.findUnique({ where: { id: downloadId } });
  if (!row || ["completed", "failed"].includes(row.status)) {
    pendingFailures.delete(downloadId);
    return;
  }
  await prisma.download.update({
    where: { id: downloadId },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
  pendingFailures.delete(downloadId);
}

// CDN streams (confirmed live: a 3sat direct-download URL) can stop sending
// data mid-transfer without closing the connection or erroring - fetch()'s
// reader.read() then just hangs forever, since fetch has no built-in
// stall/read timeout. That leaves a download stuck at whatever percent it
// reached, with no error, no retry, and nothing for Radarr/Sonarr to act on
// even once they can see the queue (see formatSabnzbdTimeleft's doc comment
// for the separate bug that hid this from them entirely). Abort if no data
// arrives for this long.
const STALL_TIMEOUT_MS = 60_000;

/** Null confirms byte transfer and file finish, not media validation. Failures
 * retain only the closed diagnostic contract; raw exceptions never escape. */
async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>
): Promise<TransferFailure | null> {
  const abortController = new AbortController();
  let fileStream: ReturnType<typeof createWriteStream> | undefined;
  let fileCreated = false;
  let completed = false;
  const startedAt = Date.now();
  let phase: TransferPhase = "request";
  let failure: TransferFailure | null = null;
  let fileError: unknown;
  let fileErrorPhase: TransferPhase = "file_open";
  let timedOut = false;
  let receivedBytes = 0;
  let downloadedBytes = 0;
  let expectedBytes: number | null = null;
  let httpStatus: number | null = null;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const fail = (reason: TransferFailure["reason"], error?: unknown): void => {
    // File errors abort an outstanding network read too. Keep their original
    // phase/code rather than blaming the resulting fetch AbortError.
    failure = {
      version: 1,
      phase: fileError ? fileErrorPhase : phase,
      reason: timedOut && !fileError ? "inactivity_timeout" : reason,
      code: safeTransferErrorCode(fileError ?? error),
      receivedBytes,
      writtenBytes: downloadedBytes,
      expectedBytes,
      httpStatus,
      elapsedMs: Math.max(0, Date.now() - startedAt),
    };
  };
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const resetStallTimer = () => {
    // This existing timer also runs during writes/progress persistence. Record
    // the phase, not an unproven claim that the network itself stalled.
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      timedOut = true;
      abortController.abort();
    }, STALL_TIMEOUT_MS);
  };

  try {
    resetStallTimer();
    const response = await fetch(url, { redirect: "error", signal: abortController.signal });
    phase = "response";
    httpStatus = response.status;

    if (!response.ok || !response.body) {
      fail(response.ok ? "missing_body" : "http_status");
      return failure;
    }

    const lengthHeader = response.headers.get("content-length");
    const encoding = response.headers.get("content-encoding")?.trim().toLowerCase();
    // Fetch may decode an encoded body: its wire Content-Length is not the
    // resulting file length. Compare only an unencoded, fully valid length.
    const reliableLength = lengthHeader !== null && (!encoding || encoding === "identity");
    if (
      reliableLength &&
      (!/^\d+$/.test(lengthHeader) || !Number.isSafeInteger(Number(lengthHeader)))
    ) {
      fail("invalid_length");
      return failure;
    }
    const contentLength = reliableLength ? Number(lengthHeader) : 0;
    expectedBytes = reliableLength ? contentLength : null;
    phase = "file_open";
    fileStream = createWriteStream(destPath, { flags: "wx" });
    fileStream.once("open", () => {
      fileCreated = true;
    });
    fileStream.on("error", (error) => {
      fileError = error;
      fileErrorPhase = fileCreated
        ? phase === "file_finish"
          ? "file_finish"
          : "file_write"
        : "file_open";
      abortController.abort();
    });
    await new Promise<void>((resolve, reject) => {
      fileStream!.once("open", () => resolve());
      fileStream!.once("error", reject);
    });

    reader = response.body.getReader();
    let lastProgressUpdate = 0;
    let lastSpeedCheck = Date.now();
    let lastSpeedBytes = 0;
    let currentSpeed = 0;

    while (true) {
      phase = "body_read";
      const { done, value } = await reader.read();
      resetStallTimer();

      if (done) {
        break;
      }
      receivedBytes += value.length;
      if (reliableLength && receivedBytes > contentLength) {
        fail("length_overflow");
        return failure;
      }

      phase = "file_write";
      await new Promise<void>((resolve, reject) => {
        fileStream!.write(Buffer.from(value), (error) => (error ? reject(error) : resolve()));
      });
      downloadedBytes += value.length;

      // Calculate speed every second
      const now = Date.now();
      const timeDiff = now - lastSpeedCheck;
      if (timeDiff >= 1000) {
        const bytesDiff = downloadedBytes - lastSpeedBytes;
        currentSpeed = Math.round(bytesDiff / (timeDiff / 1000));
        lastSpeedCheck = now;
        lastSpeedBytes = downloadedBytes;
      }

      // Update progress (throttled to every 1%)
      if (contentLength > 0 && onProgress) {
        const percent = Math.floor((downloadedBytes / contentLength) * 100);
        if (percent > lastProgressUpdate) {
          lastProgressUpdate = percent;
          phase = "progress";
          await onProgress(percent, downloadedBytes, contentLength, currentSpeed);
          if (timedOut) {
            fail("inactivity_timeout");
            return failure;
          }
        }
      }
    }

    if (reliableLength && downloadedBytes !== contentLength) {
      fail("length_mismatch");
      return failure;
    }

    phase = "file_finish";
    completed = await new Promise<boolean>((resolve) => {
      fileStream!.once("finish", () => resolve(true));
      fileStream!.once("error", () => {
        resolve(false);
      });
      fileStream!.end();
    });
    if (!completed) fail("exception", fileError);
    return failure;
  } catch (error) {
    fail("exception", error);
    return failure;
  } finally {
    clearTimeout(stallTimer);
    reader?.releaseLock();
    if (!completed) {
      abortController.abort();
      if (fileStream) {
        await new Promise<void>((resolve) => {
          if (fileStream!.closed) return resolve();
          fileStream!.once("close", resolve);
          fileStream!.destroy();
        });
        if (fileCreated) {
          await fs.unlink(destPath).catch((error: unknown) => {
            if (failure) failure.cleanupCode = safeTransferErrorCode(error);
          });
        }
      }
    }
  }
}

// Export for use in API routes
export { processDownload };
