import type { SourceDownloadContext } from "@/types/provider";
import { SourceDownloadError } from "@/server/download-failure";

/** Preserve programme binding for both direct and HLS source workers. */
export async function verifyProgrammeDownload(
  url: string,
  context: SourceDownloadContext
): Promise<void> {
  if (context.expectations?.version === 6 || context.expectations?.version === 7) {
    const { revalidateMediathekProgramme } = await import("@/services/source-programme");
    try {
      await revalidateMediathekProgramme(url, context.expectations, undefined, context.signal);
    } catch {
      throw new SourceDownloadError("Programme source no longer verified");
    }
  }
}
