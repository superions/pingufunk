import path from "node:path";
import { assertNewOutputPath } from "@/lib/download-paths";
import { getStreamHeight, srfUrnFromUrl, isStreamingUrl } from "@/lib/stream-url";
import { downloadHlsStream } from "@/server/ytdlp";
import { SourceDownloadError } from "@/server/download-failure";
import type { SourceDownloadAdapter } from "@/types/provider";
import { isArteHls, resolveArteHls } from "@/services/arte-hls";
import { verifyProgrammeDownload } from "@/providers/mediathek/programme";

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

/** Streaming transfer owns playlist resolution and muxing, independently of direct HTTP. */
export const hlsDownloadAdapter: SourceDownloadAdapter = {
  async transfer(source, context) {
    if (source.family !== "hls" || !isStreamingUrl(source.url))
      throw new SourceDownloadError("Wrong download source");
    context.signal.throwIfAborted();
    await verifyProgrammeDownload(source.url, context);
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
    const arte = isArteHls(streamUrl)
      ? await resolveArteHls(streamUrl, undefined, context.signal, maxHeight)
      : undefined;
    const result = await downloadHlsStream(
      arte?.videoUrl ?? streamUrl,
      outputPath,
      context.onProgress,
      container,
      maxHeight,
      context.signal,
      ...(arte ? ([{ url: arte.audioUrl, language: "de" as const }] as const) : ([] as const))
    );
    if (!result.success) throw new SourceDownloadError(streamFailure(result.error));
    return { path: result.outputPath || outputPath, extension };
  },
};
