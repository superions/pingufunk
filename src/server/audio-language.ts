import * as fs from "node:fs/promises";
import path from "node:path";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { isGermanLanguageCode } from "@/lib/language-policy";
import { sourceAudioExpectation, type MediaExpectations } from "@/lib/media-expectations";
import { readBoundedProcess } from "./bounded-process";
import { getFfprobePath } from "./tool-paths";
import type { WorkerLease } from "./worker-lease";

/** Correct only a proven German single-track label; never gate the transfer on media contents. */
export async function correctAudioLanguage(
  file: string,
  jobDirectory: string,
  sourceUrl: string,
  expectations: MediaExpectations | null,
  lease: WorkerLease
): Promise<void> {
  const expected = sourceAudioExpectation(expectations);
  if (expected?.language !== "de") return;
  lease.checkTransfer();
  const probe = getFfprobePath();
  if (!path.isAbsolute(probe)) return;
  const result = await readBoundedProcess(
    probe,
    [
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-select_streams",
      "a",
      "-show_entries",
      "stream_tags=language",
      "-of",
      "json",
      file,
    ],
    10_000
  );
  lease.checkTransfer();
  if (result.state !== "ok") {
    console.warn("[Download] Audio language tag could not be read");
    return;
  }
  let streams: unknown;
  try {
    streams = JSON.parse(result.output).streams;
  } catch {
    console.warn("[Download] Audio language tag could not be read");
    return;
  }
  if (!Array.isArray(streams) || streams.length !== 1) return;
  const track = streams[0];
  if (!track || typeof track !== "object" || Array.isArray(track)) return;
  const tags = track.tags;
  if (tags !== undefined && (typeof tags !== "object" || tags === null || Array.isArray(tags)))
    return;
  const language = tags?.language;
  if (language !== undefined && typeof language !== "string") return;
  if (isGermanLanguageCode(language)) return;

  let temporary: string | undefined;
  try {
    const { verifySourceAudio } = await import("@/services/source-audio");
    await verifySourceAudio(expected, sourceUrl, new HttpRequestBudget(), lease.signal);
    lease.checkTransfer();
    temporary = await fs.mkdtemp(path.join(jobDirectory, ".audio-language-"));
    const output = path.join(temporary, "media" + path.extname(file));
    const { correctGermanAudioTag } = await import("./ffmpeg");
    await correctGermanAudioTag(file, output, lease.signal);
    lease.checkTransfer();
    await fs.rename(output, file);
  } catch {
    lease.checkTransfer();
    console.warn("[Download] Audio language tag could not be updated");
  } finally {
    if (temporary)
      await fs.rm(temporary, { recursive: true, force: true }).catch(() => {
        console.warn("[Download] Audio language temporary file could not be removed");
      });
  }
}
