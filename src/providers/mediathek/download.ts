import path from "node:path";
import { isStreamingUrl } from "@/lib/stream-url";
import { safeFileExtension } from "@/lib/download-paths";
import { downloadFile } from "@/server/download-transfer";
import { SourceDownloadError, transferFailureMessage } from "@/server/download-failure";
import type { SourceDownloadAdapter } from "@/types/provider";
import { verifyProgrammeDownload } from "./programme";

/** Direct HTTP transfers have an independent FIFO worker from streamed media. */
export const mediathekDownloadAdapter: SourceDownloadAdapter = {
  async transfer(source, context) {
    if (source.family !== "mediathek" || isStreamingUrl(source.url))
      throw new SourceDownloadError("Wrong download source");
    context.signal.throwIfAborted();
    await verifyProgrammeDownload(source.url, context);
    const extension = safeFileExtension(new URL(source.url).pathname);
    const outputPath = path.join(context.stagingDirectory, context.filename + extension);
    const failure = await downloadFile(source.url, outputPath, context.onProgress, context.signal);
    if (failure) throw new SourceDownloadError(transferFailureMessage(failure), failure);
    return { path: outputPath, extension };
  },
};
