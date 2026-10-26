import path from "node:path";
import * as fs from "node:fs/promises";
import { mediathekDownloadAdapter } from "@/providers/mediathek/download";
import { youtubeDownloadAdapter } from "@/providers/youtube/download";
import { youtubeWatchUrl, rejectUntypedYoutubeUrl } from "@/lib/youtube-source";
import type { MediaExpectations } from "@/lib/media-expectations";
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
  ["youtube", youtubeDownloadAdapter],
]);

/** Legacy jobs keep their exact source; typed jobs never infer a backend from a URL. */
export function downloadSource(
  url: string,
  expectations: MediaExpectations | null
): SourceDownloadReference {
  const source = expectations && "sourceRef" in expectations ? expectations.sourceRef : undefined;
  if (!source) {
    rejectUntypedYoutubeUrl(url);
    return { family: "mediathek", url };
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
