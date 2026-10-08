import { createHash } from "node:crypto";
import path from "node:path";
import { getFfmpegPath } from "./ffmpeg";
import { getFfprobePath } from "./media-probe";
import { getConfiguredYtdlpPath } from "./ytdlp";
import { readBoundedProcess, type ProcessReadState } from "./bounded-process";

export interface ToolCapability {
  state: ProcessReadState;
  version: string | null;
}
export type ToolCapabilities = Record<"ffmpeg" | "ffprobe" | "ytdlp", ToolCapability>;
const unavailable: ToolCapability = { state: "failed", version: null };
let cache: { key: string; expires: number; value: ToolCapabilities } | null = null;
let pending: { key: string; promise: Promise<ToolCapabilities> } | null = null;

async function inspect(binary: string, tool: keyof ToolCapabilities): Promise<ToolCapability> {
  if (tool === "ffprobe" && !path.isAbsolute(binary)) return { state: "failed", version: null };
  const result = await readBoundedProcess(binary, [tool === "ytdlp" ? "--version" : "-version"]);
  if (result.state !== "ok") return { state: result.state, version: null };
  const version =
    tool === "ytdlp"
      ? result.output.trim()
      : new RegExp(`^${tool} version ([^\\s]+)`, "m").exec(result.output)?.[1];
  // Never turn arbitrary tool stdout (including a local path) into UI text.
  const validVersion =
    tool === "ytdlp"
      ? /^\d{4}\.\d{2}\.\d{2}(?:\.\d{6})?$/
      : /^(?:n?\d+(?:\.\d+){0,3}(?:[-+][a-z\d.+_-]{1,32})?|N-\d+-g[a-f\d]{7,40})$/i;
  return version && validVersion.test(version)
    ? { state: "ok", version }
    : { state: "invalid_response", version: null };
}

/** Inspect exactly the paths used by transfers/probes, without installing anything. */
export async function getToolCapabilities(): Promise<ToolCapabilities> {
  const paths = [getFfmpegPath(), getFfprobePath(), await getConfiguredYtdlpPath()];
  const key = createHash("sha256").update(JSON.stringify(paths)).digest("hex");
  if (cache?.key === key && cache.expires > Date.now()) return cache.value;
  if (pending?.key === key) return pending.promise;
  // At most one three-tool inspection can be running, even during rapid path rotation.
  // A changed configuration is temporarily unconfirmed, never checked against the old path.
  if (pending) return unavailableToolCapabilities();
  const tools = ["ffmpeg", "ffprobe", "ytdlp"] as const;
  const promise = Promise.all(paths.map((binary, index) => inspect(binary, tools[index]))).then(
    (values) => {
      const value = Object.fromEntries(
        tools.map((tool, index) => [tool, values[index]])
      ) as ToolCapabilities;
      // A late inspection of an old configured binary cannot replace the new epoch.
      if (pending?.promise === promise)
        cache = {
          key,
          expires: Date.now() + (values.every((entry) => entry.state === "ok") ? 30_000 : 2000),
          value,
        };
      return value;
    }
  );
  pending = { key, promise };
  try {
    return await promise;
  } finally {
    if (pending?.promise === promise) pending = null;
  }
}

export function unavailableToolCapabilities(): ToolCapabilities {
  return { ffmpeg: { ...unavailable }, ffprobe: { ...unavailable }, ytdlp: { ...unavailable } };
}
