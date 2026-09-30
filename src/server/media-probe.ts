import { spawn, spawnSync } from "node:child_process";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { isGermanLanguageCode } from "@/lib/language-policy";
import { parseMediaExpectations, type MediaExpectations } from "@/lib/media-expectations";
import { verifiedDurationCheck } from "@/lib/verified-duration";

export class MediaProbeError extends Error {
  constructor() {
    super("Local media validation failed");
  }
}

const positive = z.number().finite().positive();
const streamSchema = z.object({
  codec_type: z.string(),
  codec_name: z.string().optional(),
  width: positive.optional(),
  height: positive.optional(),
  sample_rate: z.string().optional(),
  channels: z.number().int().positive().optional(),
  disposition: z.object({ attached_pic: z.number().optional() }).optional(),
  tags: z.object({ language: z.string().max(35).optional() }).optional(),
});
const probeSchema = z.object({
  format: z.object({ format_name: z.string(), duration: z.string() }),
  streams: z.array(streamSchema).min(2).max(512),
});
const formats = new Set(["mov", "mp4", "matroska", "webm", "mpegts", "avi", "flv", "ogg", "mpeg"]);

function languageTag(value: string | undefined): string | null {
  if (!value || ["und", "mul", "zxx"].includes(value.toLowerCase())) return null;
  if (isGermanLanguageCode(value)) return "de";
  try {
    return new Intl.Locale(value.replaceAll("_", "-")).language;
  } catch {
    return null;
  }
}

export interface MediaProbeFacts {
  durationSeconds: number;
  video: { width: number; height: number }[];
  audioLanguages: string[];
  expectedChecks: {
    duration: "unknown" | "passed";
    audio: "unknown" | "passed";
    resolution: "unknown" | "passed";
  };
}

/** Container/stream/tag checks, not full decode or proof of content identity/spoken language. */
export function validateMediaProbe(
  value: unknown,
  expected: MediaExpectations | null,
  tolerancePercent: number
): MediaProbeFacts {
  try {
    const probe = probeSchema.parse(value);
    if (!probe.format.format_name.split(",").some((format) => formats.has(format)))
      throw new MediaProbeError();
    const durationSeconds = Number(probe.format.duration);
    if (
      !/^\d+(?:\.\d+)?$/.test(probe.format.duration) ||
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0
    )
      throw new MediaProbeError();
    const usableCodec = (name: string | undefined) => !!name && !["unknown", "none"].includes(name);
    const video = probe.streams
      .filter(
        (stream) =>
          stream.codec_type === "video" &&
          usableCodec(stream.codec_name) &&
          stream.disposition?.attached_pic !== 1 &&
          stream.width &&
          stream.height
      )
      .map((stream) => ({ width: stream.width!, height: stream.height! }));
    const audio = probe.streams.filter(
      (stream) =>
        stream.codec_type === "audio" &&
        usableCodec(stream.codec_name) &&
        stream.channels &&
        Number.isFinite(Number(stream.sample_rate)) &&
        Number(stream.sample_rate) > 0
    );
    if (video.length === 0 || audio.length === 0) throw new MediaProbeError();
    const audioLanguages = [
      ...new Set(
        audio
          .map((stream) => languageTag(stream.tags?.language))
          .filter((tag): tag is string => tag !== null)
      ),
    ];
    const contract = expected === null ? null : parseMediaExpectations(expected);
    if (
      !verifiedDurationCheck(
        durationSeconds,
        contract?.duration?.seconds ?? null,
        0,
        tolerancePercent
      ).accepted
    )
      throw new MediaProbeError();
    if (contract?.audio && !audioLanguages.includes(languageTag(contract.audio.language)!))
      throw new MediaProbeError();
    if (
      contract?.resolution &&
      !video.some(
        (stream) =>
          stream.width === contract.resolution!.width &&
          stream.height === contract.resolution!.height
      )
    )
      throw new MediaProbeError();
    return {
      durationSeconds,
      video,
      audioLanguages,
      expectedChecks: {
        duration: contract?.duration ? "passed" : "unknown",
        audio: contract?.audio ? "passed" : "unknown",
        resolution: contract?.resolution ? "passed" : "unknown",
      },
    };
  } catch {
    throw new MediaProbeError();
  }
}

/** Probe only a regular file directly within the already established private job directory. */
export async function probeJobMedia(
  filePath: string,
  jobDirectory: string,
  expected: MediaExpectations | null,
  tolerancePercent: number
): Promise<MediaProbeFacts> {
  try {
    const file = path.resolve(filePath);
    const directory = path.resolve(jobDirectory);
    if (
      !path.isAbsolute(filePath) ||
      !path.isAbsolute(jobDirectory) ||
      path.dirname(file) !== directory
    )
      throw new MediaProbeError();
    const [stat, directoryStat, actualFile, actualDirectory] = await Promise.all([
      lstat(file),
      lstat(directory),
      realpath(file),
      realpath(directory),
    ]);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      !directoryStat.isDirectory() ||
      directoryStat.isSymbolicLink() ||
      actualFile !== file ||
      actualDirectory !== directory
    )
      throw new MediaProbeError();
    const binary =
      process.env.PINGUFUNK_FFPROBE_PATH ||
      path.join(process.cwd(), "ffmpeg", process.platform === "win32" ? "ffprobe.exe" : "ffprobe");
    if (!path.isAbsolute(binary)) throw new MediaProbeError();
    const output = await readLocalProbe(binary, file);
    // Refuse replacement/partial writes while probing, including changed inode.
    const after = await lstat(file);
    if (
      !after.isFile() ||
      after.isSymbolicLink() ||
      after.dev !== stat.dev ||
      after.ino !== stat.ino ||
      after.size !== stat.size ||
      after.mtimeMs !== stat.mtimeMs
    )
      throw new MediaProbeError();
    return validateMediaProbe(JSON.parse(output), expected, tolerancePercent);
  } catch {
    throw new MediaProbeError();
  }
}

function readLocalProbe(binary: string, file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      binary,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-format_whitelist",
        [...formats].join(","),
        "-show_entries",
        "format=format_name,duration:stream=codec_type,codec_name,width,height,sample_rate,channels:stream_disposition=attached_pic:stream_tags=language",
        "-of",
        "json",
        file,
      ],
      {
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }
    );
    let settled = false;
    let bytes = 0;
    let hasDiagnostics = false;
    const chunks: Buffer[] = [];
    const killOwnedTree = () => {
      if (child.pid && process.platform !== "win32") {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      } else if (child.pid && process.platform === "win32") {
        spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
          timeout: 2000,
          stdio: "ignore",
          windowsHide: true,
        });
      } else {
        child.kill("SIGKILL");
      }
    };
    const finish = (ok: boolean, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!ok) {
        if (terminate) killOwnedTree();
        reject(new MediaProbeError());
      } else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(() => finish(false, true), 30_000);
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024 || chunks.length >= 8192) {
        finish(false, true);
        return;
      }
      if (!settled) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (chunk.length) hasDiagnostics = true;
      if (bytes > 1024 * 1024) finish(false, true);
    });
    child.on("error", () => finish(false, true));
    child.on("close", (code) => finish(code === 0 && !hasDiagnostics && bytes > 0));
  });
}
