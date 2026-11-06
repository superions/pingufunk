import path from "node:path";
import * as fs from "node:fs/promises";
import { mediathekDownloadAdapter } from "@/providers/mediathek/download";
import { hlsDownloadAdapter } from "@/providers/hls/download";
import { isStreamingUrl } from "@/lib/stream-url";
import { youtubeDownloadAdapter } from "@/providers/youtube/download";
import { youtubeWatchUrl, rejectUntypedYoutubeUrl } from "@/lib/youtube-source";
import { readPersistedMediaExpectations, type MediaExpectations } from "@/lib/media-expectations";
import { safeFileExtension } from "@/lib/download-paths";
import { SourceDownloadError } from "./download-failure";
import type {
  SourceDownloadAdapter,
  SourceDownloadArtifact,
  SourceDownloadContext,
  SourceDownloadReference,
} from "@/types/provider";

// Fixed composition, no runtime plugins or URL-based fallback to another source.
const adapters: ReadonlyMap<string, SourceDownloadAdapter> = new Map([
  ["mediathek", mediathekDownloadAdapter],
  ["hls", hlsDownloadAdapter],
  ["youtube", youtubeDownloadAdapter],
]);

/** Each registered transport owns an independent FIFO lane with configurable capacity. */
export const downloadSourceFamilies = [...adapters.keys()];

/** Invalid persisted payloads still reach the normal closed failure path.
 * Never classify an untyped URL as a YouTube job or silently repair its identity.
 */
export function downloadWorkerFamily(url: string, persisted: string | null): string {
  try {
    return downloadSource(url, readPersistedMediaExpectations(persisted)).family;
  } catch {
    return "mediathek";
  }
}

/** Legacy URLs keep their identity and paths; their transport selects the direct/HLS lane. */
export function downloadSource(
  url: string,
  expectations: MediaExpectations | null
): SourceDownloadReference {
  const source = expectations && "sourceRef" in expectations ? expectations.sourceRef : undefined;
  if (!source) {
    rejectUntypedYoutubeUrl(url);
    return { family: isStreamingUrl(url) ? "hls" : "mediathek", url };
  }
  if (url !== youtubeWatchUrl(source)) throw new SourceDownloadError("Source reference mismatch");
  return source;
}

/** Dispatch by explicit source family and verify the returned staging ownership before postprocessing. */
export async function transferSource(
  source: SourceDownloadReference,
  context: SourceDownloadContext
): Promise<SourceDownloadArtifact> {
  const adapter = adapters.get(source.family);
  if (!adapter) throw new SourceDownloadError("Unsupported download source");
  if (
    !context.filename ||
    [".", ".."].includes(context.filename) ||
    /[\\/\x00-\x1f\x7f]/.test(context.filename)
  )
    throw new SourceDownloadError("Invalid staging filename");
  context.signal.throwIfAborted();
  const artifact = await adapter.transfer(source, context);
  context.signal.throwIfAborted();
  if (
    path.dirname(path.resolve(artifact.path)) !== path.resolve(context.stagingDirectory) ||
    safeFileExtension("media" + artifact.extension) !== artifact.extension
  )
    throw new SourceDownloadError("Invalid staged media file");
  const stats = await fs.lstat(artifact.path);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0)
    throw new SourceDownloadError("Invalid staged media file");
  return artifact;
}
