import { createHash } from "node:crypto";
import { resolveYoutubeMedia } from "./resolve";
import {
  youtubeRenditionIdentity,
  youtubeWatchUrl,
  type YoutubeSourceReference,
} from "@/lib/youtube-source";
import type { SourceAudioEvidence } from "@/lib/media-expectations";
export function youtubeMediaIdentity(source: YoutubeSourceReference): string {
  return createHash("sha256").update(youtubeRenditionIdentity(source)).digest("hex");
}
export async function verifyYoutubeAudio(
  expected: Extract<SourceAudioEvidence, { provider: "youtube" }>,
  url: string,
  signal?: AbortSignal
): Promise<SourceAudioEvidence> {
  if (url !== youtubeWatchUrl(expected)) throw Error("YouTube audio source mismatch");
  const resolved = await resolveYoutubeMedia(
    expected,
    signal ?? new AbortController().signal,
    expected.selection
  );
  const identity = [
    "youtube",
    expected.videoId,
    resolved.selection.videoFormat,
    resolved.selection.audioFormat,
    resolved.selection.audioTrack,
    resolved.selection.language,
  ].join(":");
  if (createHash("sha256").update(identity).digest("hex") !== expected.mediaIdentity)
    throw Error("YouTube audio selection mismatch");
  return expected;
}
