import { prisma } from "@/lib/db";
import { isMkvConversionEnabled } from "@/lib/settings";
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
import * as path from "path";

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
let isProcessing = false;
let processingPromise: Promise<void> | null = null;

export async function startDownloadProcessing(): Promise<void> {
  if (isProcessing) {
    return processingPromise || Promise.resolve();
  }

  isProcessing = true;
  processingPromise = processQueue();
  await processingPromise;
  isProcessing = false;
  processingPromise = null;
}

async function processQueue(): Promise<void> {
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

    // Start download in background (respecting semaphore)
    processDownload(nextDownload.id).catch(console.error);

    // Small delay to prevent tight loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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
  await downloadSemaphore.acquire();

  const startTime = Date.now();
  let tempJobDir: string | null = null;
  let completeJobDir: string | null = null;

  try {
    // Get download info
    const download = await prisma.download.findUnique({
      where: { id: downloadId },
    });

    if (!download || download.status !== "queued") {
      return;
    }

    console.log(`[Download] Starting: ${download.title}`);
    console.log(`[Download] URL: ${download.url}`);

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

      // Mark as completed
      const downloadTime = Math.floor((Date.now() - startTime) / 1000);

      await prisma.download.update({
        where: { id: downloadId },
        data: {
          status: "completed",
          progress: 100,
          size: stats.size,
          filePath: finalMkvPath,
          completedAt: new Date(),
        },
      });

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
    const downloadSuccess = await downloadFile(
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

    if (!downloadSuccess) {
      await markAsFailed(downloadId, "Download failed");
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

      // Mark as completed
      const downloadTime = Math.floor((Date.now() - startTime) / 1000);

      await prisma.download.update({
        where: { id: downloadId },
        data: {
          status: "completed",
          progress: 100,
          size: stats.size,
          filePath: finalMkvPath,
          completedAt: new Date(),
        },
      });

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

      await prisma.download.update({
        where: { id: downloadId },
        data: {
          status: "completed",
          progress: 100,
          size: stats.size,
          filePath: finalPath,
          completedAt: new Date(),
        },
      });

      console.log(
        `[Download] Completed: ${download.title} (${Math.round(stats.size / 1024 / 1024)}MB)`
      );
    }
  } catch (error) {
    console.error(`[Download] Error processing download ${downloadId}:`, error);
    await markAsFailed(downloadId, error instanceof Error ? error.message : "Unknown error");
  } finally {
    // Remove only empty directories owned by this job. A failed tool's
    // unexpected leftovers remain visible for diagnosis, never swept broadly.
    for (const directory of [tempJobDir, completeJobDir]) {
      if (!directory) continue;
      await fs.rmdir(directory).catch((error: NodeJS.ErrnoException) => {
        if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code ?? "")) {
          console.error("[Download] Could not remove empty job directory:", error);
        }
      });
    }
    downloadSemaphore.release();

    // Check if there are more items to process
    const hasMore = await prisma.download.count({
      where: { status: "queued" },
    });

    if (hasMore > 0 && !isProcessing) {
      startDownloadProcessing().catch(console.error);
    }
  }
}

async function markAsFailed(downloadId: string, error: string): Promise<void> {
  await prisma.download.update({
    where: { id: downloadId },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
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

async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>
): Promise<boolean> {
  const abortController = new AbortController();
  let fileStream: ReturnType<typeof createWriteStream> | undefined;
  let fileCreated = false;
  let completed = false;
  let stallTimer: ReturnType<typeof setTimeout> | undefined;
  const resetStallTimer = () => {
    if (stallTimer) clearTimeout(stallTimer);
    stallTimer = setTimeout(() => {
      console.error(`[Download] No data received for ${STALL_TIMEOUT_MS / 1000}s, aborting`);
      abortController.abort();
    }, STALL_TIMEOUT_MS);
  };

  try {
    resetStallTimer();
    const response = await fetch(url, { signal: abortController.signal });

    if (!response.ok || !response.body) {
      console.error(`[Download] HTTP error: ${response.status} ${response.statusText}`);
      return false;
    }

    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    fileStream = createWriteStream(destPath, { flags: "wx" });
    fileStream.once("open", () => {
      fileCreated = true;
    });
    fileStream.on("error", () => abortController.abort());

    const reader = response.body.getReader();
    let downloadedBytes = 0;
    let lastProgressUpdate = 0;
    let lastSpeedCheck = Date.now();
    let lastSpeedBytes = 0;
    let currentSpeed = 0;

    while (true) {
      const { done, value } = await reader.read();
      resetStallTimer();

      if (done) {
        break;
      }

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
          await onProgress(percent, downloadedBytes, contentLength, currentSpeed);
        }
      }
    }

    completed = await new Promise<boolean>((resolve) => {
      fileStream!.once("finish", () => resolve(true));
      fileStream!.once("error", (err) => {
        console.error(`[Download] Write error: ${err}`);
        resolve(false);
      });
      fileStream!.end();
    });
    return completed;
  } catch (error) {
    console.error(`[Download] Error downloading file:`, error);
    return false;
  } finally {
    clearTimeout(stallTimer);
    if (!completed) {
      abortController.abort();
      if (fileStream) {
        await new Promise<void>((resolve) => {
          if (fileStream!.closed) return resolve();
          fileStream!.once("close", resolve);
          fileStream!.destroy();
        });
        if (fileCreated) await fs.unlink(destPath).catch(() => {});
      }
    }
  }
}

// Export for use in API routes
export { processDownload };
