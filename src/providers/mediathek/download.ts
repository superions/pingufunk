import path from "node:path";
import { assertNewOutputPath, safeFileExtension } from "@/lib/download-paths";
import { getStreamHeight, isStreamingUrl, srfUrnFromUrl } from "@/lib/stream-url";
import { downloadHlsStream } from "@/server/ytdlp";
import { downloadFile } from "@/server/download-transfer";
import { SourceDownloadError, transferFailureMessage } from "@/server/download-failure";
import type { SourceDownloadAdapter } from "@/types/provider";

const streamErrors = new Set([
  "Stream download interrupted",
  "yt-dlp not available",
  "FFmpeg not available for stream remuxing",
  "yt-dlp timed out after 10 minutes without output",
  "Failed to persist download progress",
  "Output file not found after download",
  "yt-dlp process failed",
  "FFmpeg not available",
  "Mux interrupted",
  "FFmpeg process failed",
  "Stream download failed",
]);

function streamFailure(value: string | undefined): string {
  return value &&
    (streamErrors.has(value) || /^(?:yt-dlp|FFmpeg) exited with code (?:null|-?\d+)$/.test(value))
    ? value
    : "HLS download failed";
}

/** Mediathek-specific URL/URN resolution stays outside the queue and completion owners. */
export const mediathekDownloadAdapter: SourceDownloadAdapter = {
  async transfer(source, context) {
    context.signal.throwIfAborted();
    if (isStreamingUrl(source.url)) {
      const urn = srfUrnFromUrl(source.url);
      const maxHeight = getStreamHeight(source.url);
      const streamUrl = urn
        ? urn.replace(/^urn:/, "srgssr:")
        : maxHeight
          ? source.url.split("#")[0]
          : source.url;
      const container = await context.getContainer();
      const extension = `.${container}`;
      const outputPath = path.join(context.stagingDirectory, context.filename + extension);
      await assertNewOutputPath(outputPath);
      const result = await downloadHlsStream(
        streamUrl,
        outputPath,
        context.onProgress,
        container,
        maxHeight,
        context.signal
      );
      if (!result.success) throw new SourceDownloadError(streamFailure(result.error));
      return { path: result.outputPath || outputPath, extension };
    }
    const extension = safeFileExtension(new URL(source.url).pathname);
    const outputPath = path.join(context.stagingDirectory, context.filename + extension);
    const failure = await downloadFile(source.url, outputPath, context.onProgress, context.signal);
    if (failure) throw new SourceDownloadError(transferFailureMessage(failure), failure);
    return { path: outputPath, extension };
  },
};
