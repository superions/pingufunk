import path from "node:path";
import * as fs from "node:fs/promises";
import { resolveYoutubeMedia } from "./resolve";
import { youtubeSourceReferenceSchema } from "@/lib/youtube-source";
import { assertNewOutputPath } from "@/lib/download-paths";
import { SourceDownloadError, transferFailureMessage } from "@/server/download-failure";
import { downloadFile } from "@/server/download-transfer";
import type { SourceDownloadAdapter } from "@/types/provider";

/** Source-only resolution and mux. The existing worker owns lease, completion and cleanup. */
export const youtubeDownloadAdapter: SourceDownloadAdapter = {
  async transfer(value, context) {
    const source = youtubeSourceReferenceSchema.parse(value);
    context.signal.throwIfAborted();
    const { getFfmpegPath, mergeVideoAudio } = await import("@/server/ffmpeg");
    // Missing tooling is a closed capability failure, never a runtime installer.
    await fs.access(getFfmpegPath());
    const resolved = await resolveYoutubeMedia(source, context.signal, source.selection);
    const extension = "." + (await context.getContainer());
    const video = path.join(context.stagingDirectory, context.filename + ".video");
    const audio = path.join(context.stagingDirectory, context.filename + ".audio");
    const output = path.join(context.stagingDirectory, context.filename + extension);
    for (const file of [video, audio, output]) await assertNewOutputPath(file);
    let completedBytes = 0;
    for (const [index, url, file] of [
      [0, resolved.videoUrl, video],
      [1, resolved.audioUrl, audio],
    ] as const) {
      const failure = await downloadFile(
        url,
        file,
        async (progress, bytes, total, speed) =>
          context.onProgress(
            Math.min(99, index * 50 + progress / 2),
            completedBytes + bytes,
            Math.max(completedBytes + bytes, resolved.size, completedBytes + total),
            speed
          ),
        context.signal,
        // Same 10 MiB request bound as the pinned yt-dlp YouTube extractor.
        // A single full-file HTTP request can be throttled by the source CDN.
        { chunkSize: 10 * 1024 * 1024 }
      );
      if (failure) throw new SourceDownloadError(transferFailureMessage(failure), failure);
      completedBytes += (await fs.stat(file)).size;
    }
    const mux = await mergeVideoAudio(video, audio, output, context.signal, false);
    if (!mux.success) throw new SourceDownloadError("YouTube media mux failed");
    await fs.unlink(video);
    await fs.unlink(audio);
    return { path: output, extension };
  },
};
