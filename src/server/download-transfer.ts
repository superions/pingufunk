import * as fs from "fs/promises";
import { createWriteStream } from "fs";
import {
  safeTransferErrorCode,
  type TransferFailure,
  type TransferPhase,
} from "./download-failure";

// A CDN can stop sending bytes without closing the response or reporting an
// error; fetch has no built-in read/inactivity timeout. This existing timer
// also runs while file writes and progress persistence are awaited. Retain
// the phase instead of assuming that every timeout is a network stall.
const STALL_TIMEOUT_MS = 60_000;

/** Null confirms byte transfer and file finish, not media validation. Failures
 * retain only the closed diagnostic contract; raw exceptions never escape. */
export async function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (
    percent: number,
    downloadedBytes: number,
    totalBytes: number,
    speed: number
  ) => Promise<void>,
  parentSignal?: AbortSignal
): Promise<TransferFailure | null> {
  const abortController = new AbortController();
  const abort = () => abortController.abort();
  parentSignal?.addEventListener("abort", abort, { once: true });
  if (parentSignal?.aborted) abort();
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
    abortController.signal.throwIfAborted();
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
      abortController.signal.throwIfAborted();
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
    parentSignal?.removeEventListener("abort", abort);
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
