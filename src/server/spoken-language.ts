import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdtemp, rename, rm } from "node:fs/promises";
import path from "node:path";
import { externalCredential } from "@/lib/credential-settings";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { bindOwnedProcessAbort } from "./owned-process";

export interface SpokenAudioEvidence {
  provider: "speech_api";
  model: "whisper-large-v3-turbo";
  language: "de";
  fileSha256: string;
  correctedFileSha256?: string;
  audioTrack: 0;
  samples: { start: number; seconds: number; language: "de" | "other" | "unknown" }[];
}

export class SpokenLanguageError extends Error {
  constructor(
    readonly reason: "language_unknown" | "language_conflict" | "source_failed" | "file_changed"
  ) {
    super("Spoken language verification failed");
  }
}

/** Recognition is deployment configuration, never an URL or credential supplied by an NZB. */
async function speechConfiguration() {
  const value = process.env.PINGUFUNK_SPEECH_API_URL;
  try {
    const credential = await externalCredential("PINGUFUNK_SPEECH_API_KEY");
    if (value === undefined && !credential.configured) return null;
    const url = new URL(value ?? "");
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !credential.value
    )
      throw new Error();
    url.pathname = url.pathname.replace(/\/$/, "") + "/audio/transcriptions";
    return { url, key: credential.value };
  } catch {
    throw new SpokenLanguageError("source_failed");
  }
}

/** Hash the exact job bytes; transcripts and audio samples are never persisted. */
export async function hashJobMedia(file: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash("sha256");
  const stream = createReadStream(file, { signal });
  for await (const chunk of stream) hash.update(chunk);
  signal?.throwIfAborted();
  return hash.digest("hex");
}

async function ffmpegBytes(
  args: string[],
  maximumBytes: number,
  signal: AbortSignal
): Promise<Buffer> {
  const { getFfmpegPath } = await import("./ffmpeg");
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const child = spawn(getFfmpegPath(), ["-nostdin", "-hide_banner", "-v", "error", ...args], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const owned = bindOwnedProcessAbort(child, signal);
    const chunks: Buffer[] = [];
    let bytes = 0,
      invalid = false;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maximumBytes || chunks.length >= 8192) {
        invalid = true;
        owned.terminate();
      } else chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", () => {
      invalid = true;
    });
    child.once("error", () => reject(new SpokenLanguageError("source_failed")));
    child.once("close", (code) => {
      if (code !== 0 || invalid || signal.aborted || (!bytes && maximumBytes > 0))
        reject(new SpokenLanguageError("source_failed"));
      else resolve(Buffer.concat(chunks));
    });
  });
}

/** Correct only the freshly transferred private job file, before completion is published. */
export async function correctJobAudioTag<T>(
  file: string,
  evidence: SpokenAudioEvidence,
  validate: (candidate: string, directory: string, signal: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<{ facts: T; evidence: SpokenAudioEvidence }> {
  const operation = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
  const directory = await mkdtemp(path.join(path.dirname(file), ".language-"));
  const candidate = path.join(directory, "verified" + path.extname(file));
  try {
    const before = await lstat(file);
    if (
      !before.isFile() ||
      before.isSymbolicLink() ||
      (await hashJobMedia(file, operation)) !== evidence.fileSha256
    )
      throw new SpokenLanguageError("file_changed");
    // Exclusive output; no re-encoding, discarded tracks or invented title metadata.
    await ffmpegBytes(
      [
        "-n",
        "-protocol_whitelist",
        "file",
        "-i",
        file,
        "-map",
        "0",
        "-map_metadata",
        "0",
        "-c",
        "copy",
        "-metadata:s:a:0",
        "language=deu",
        candidate,
      ],
      0,
      operation
    );
    const facts = await validate(candidate, directory, operation);
    const correctedFileSha256 = await hashJobMedia(candidate, operation);
    const after = await lstat(file);
    if (
      after.dev !== before.dev ||
      after.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      (await hashJobMedia(file, operation)) !== evidence.fileSha256
    )
      throw new SpokenLanguageError("file_changed");
    operation.throwIfAborted();
    await rename(candidate, file);
    return { facts, evidence: { ...evidence, correctedFileSha256 } };
  } finally {
    await rm(directory, { recursive: true });
  }
}

function hasSignal(pcm: Buffer): boolean {
  if (pcm.length < 16000 * 2 * 5 || pcm.length % 2) return false;
  let energy = 0;
  for (let i = 0; i < pcm.length; i += 2) energy += (pcm.readInt16LE(i) / 32768) ** 2;
  return Math.sqrt(energy / (pcm.length / 2)) >= 0.001;
}

function wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF");
  header.writeUInt32LE(pcm.length + 36, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24);
  header.writeUInt32LE(32000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * A majority of three distributed, independently detected samples may correct a
 * single track's tag. This is sampled spoken language, not proof of every scene.
 * Do not send a language/prompt: the desired result must not bias detection.
 */
export async function recognizeJobAudio(
  file: string,
  duration: number,
  signal?: AbortSignal
): Promise<SpokenAudioEvidence | null> {
  const config = await speechConfiguration();
  if (!config) return null;
  const operation = AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])]);
  try {
    if (!Number.isFinite(duration) || duration < 15)
      throw new SpokenLanguageError("language_unknown");
    const samples: SpokenAudioEvidence["samples"] = [];
    const seconds = Math.min(25, duration / 3);
    for (const position of [0.2, 0.5, 0.8]) {
      operation.throwIfAborted();
      const start = Math.max(0, Math.min(duration - seconds, duration * position - seconds / 2));
      const pcm = await ffmpegBytes(
        [
          "-ss",
          String(start),
          "-protocol_whitelist",
          "file",
          "-i",
          file,
          "-map",
          "0:a:0",
          "-vn",
          "-t",
          String(seconds),
          "-ac",
          "1",
          "-ar",
          "16000",
          "-f",
          "s16le",
          "pipe:1",
        ],
        25 * 32000,
        operation
      );
      let language: "de" | "other" | "unknown" = "unknown";
      if (hasSignal(pcm)) {
        const body = new FormData();
        body.set("model", "whisper-large-v3-turbo");
        body.set("response_format", "verbose_json");
        body.set("file", new Blob([new Uint8Array(wav(pcm))], { type: "audio/wav" }), "sample.wav");
        const requestSignal = AbortSignal.any([operation, AbortSignal.timeout(55_000)]);
        const response = await fetch(config.url, {
          method: "POST",
          redirect: "error",
          headers: { Authorization: "Bearer " + config.key },
          body,
          signal: requestSignal,
        });
        if (!response.ok) {
          void response.body?.cancel().catch(() => {});
          throw new SpokenLanguageError("source_failed");
        }
        const value = await readBoundedProviderJson(
          response,
          Date.now() + 55_000,
          128 * 1024,
          requestSignal
        );
        if (value && typeof value === "object") {
          const result = value as { language?: unknown; text?: unknown; duration?: unknown };
          if (
            typeof result.language === "string" &&
            /^[a-z-]{2,35}$/.test(result.language) &&
            typeof result.text === "string" &&
            result.text.trim().length >= 20 &&
            typeof result.duration === "number" &&
            Math.abs(result.duration - pcm.length / 32000) <= 1
          ) {
            language = ["de", "deu", "ger", "german"].includes(result.language) ? "de" : "other";
          }
        }
      }
      samples.push({ start, seconds, language });
    }
    if (samples.filter((sample) => sample.language === "de").length < 2)
      throw new SpokenLanguageError(
        samples.filter((sample) => sample.language === "other").length >= 2
          ? "language_conflict"
          : "language_unknown"
      );
    return {
      provider: "speech_api",
      model: "whisper-large-v3-turbo",
      language: "de",
      fileSha256: await hashJobMedia(file, operation),
      audioTrack: 0,
      samples,
    };
  } catch (error) {
    throw error instanceof SpokenLanguageError ? error : new SpokenLanguageError("source_failed");
  }
}
