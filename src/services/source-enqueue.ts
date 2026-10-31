import { SourceAdmissionError, type SourceAdmission } from "@/lib/source-admission";
import type { MediaExpectations } from "@/lib/media-expectations";
import { youtubeMediaIdentity } from "@/providers/youtube/audio";
import { rejectUntypedYoutubeUrl } from "@/lib/youtube-source";

/** Current source policy is checked only for new admission; persisted jobs retain their frozen intent. */
async function prepareSourceAdmission(
  url: string,
  expected?: MediaExpectations
): Promise<SourceAdmission | undefined> {
  if (expected?.version === 6) {
    const { validateMediathekProgrammeAdmission } = await import("./source-programme");
    await validateMediathekProgrammeAdmission(url, expected);
    return;
  }
  if (!expected || !("sourceRef" in expected) || !expected.sourceRef) {
    rejectUntypedYoutubeUrl(url);
    return;
  }
  const source = expected.sourceRef;
  if (
    expected.sourceAudio?.provider !== "youtube" ||
    expected.sourceAudio.mediaIdentity !== youtubeMediaIdentity(source)
  )
    throw Error("Source evidence mismatch");
  const { validateYoutubeEnqueue } = await import("./youtube-bindings");
  return validateYoutubeEnqueue(url, source);
}

export async function validateReleaseSource(
  url: string,
  expected?: MediaExpectations
): Promise<void> {
  await prepareSourceAdmission(url, expected);
}
export function releaseSourceAdmission(
  url: string,
  expected?: MediaExpectations
): (() => Promise<SourceAdmission | undefined>) | undefined {
  if (expected?.version !== 6 && (!expected || !("sourceRef" in expected) || !expected.sourceRef)) {
    rejectUntypedYoutubeUrl(url);
    return;
  }
  return async () => {
    try {
      return await prepareSourceAdmission(url, expected);
    } catch {
      throw new SourceAdmissionError();
    }
  };
}
