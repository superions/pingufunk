import type { ToolCapabilities } from "@/server/tool-capabilities";

export interface SystemInformation {
  version: { node: string; ffmpeg: string | null; ffprobe: string | null; ytdlp: string | null };
  capabilities: ToolCapabilities;
  database: {
    sizeBytes: number;
    shows: number;
    episodes: number;
    configEntries: number;
    historicalMetadata: true;
  };
  downloads: { completed: number; inQueue: number; failed: number };
  runtime: {
    liveness: "alive";
    schema: { ready: true; state: "compatible" };
    writesEnabled: boolean;
    worker: {
      state: "disabled" | "idle" | "draining" | "paused";
      configuredConcurrency: 1;
      exclusiveOwnership: "unverified" | "idle" | "waiting" | "held" | "lost";
    };
  };
  uptime: number;
}

/** Confirm the closed transport shape before replacing an acknowledged desktop snapshot. */
export function parseSystemInformation(input: unknown): SystemInformation | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as SystemInformation;
  const count = (value: unknown) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  if (
    !data.version ||
    !/^v\d+\.\d+\.\d+(?:-[a-z\d._-]{1,32})?$/i.test(data.version.node ?? "") ||
    !data.database ||
    ![
      data.database.sizeBytes,
      data.database.shows,
      data.database.episodes,
      data.database.configEntries,
    ].every(count) ||
    data.database.historicalMetadata !== true ||
    !data.downloads ||
    ![data.downloads.completed, data.downloads.inQueue, data.downloads.failed].every(count) ||
    !data.runtime ||
    data.runtime.liveness !== "alive" ||
    data.runtime.schema?.ready !== true ||
    data.runtime.schema.state !== "compatible" ||
    typeof data.runtime.writesEnabled !== "boolean" ||
    !data.runtime.worker ||
    !["disabled", "idle", "draining", "paused"].includes(data.runtime.worker.state) ||
    data.runtime.worker.configuredConcurrency !== 1 ||
    !["unverified", "idle", "waiting", "held", "lost"].includes(
      data.runtime.worker.exclusiveOwnership
    ) ||
    (!data.runtime.writesEnabled && data.runtime.worker.state !== "disabled") ||
    typeof data.uptime !== "number" ||
    !Number.isFinite(data.uptime) ||
    data.uptime < 0
  )
    return null;
  const capabilities = {} as ToolCapabilities;
  for (const tool of ["ffmpeg", "ffprobe", "ytdlp"] as const) {
    const value = data.capabilities?.[tool];
    if (
      !value ||
      !["ok", "missing", "timeout", "invalid_response", "failed"].includes(value.state) ||
      value.version !== data.version[tool] ||
      (value.state === "ok"
        ? typeof value.version !== "string" ||
          !/^(?:n?\d|N-\d)[a-z\d.+_-]{0,79}$/i.test(value.version)
        : value.version !== null)
    )
      return null;
    capabilities[tool] = { state: value.state, version: value.version };
  }
  return {
    version: {
      node: data.version.node,
      ffmpeg: capabilities.ffmpeg.version,
      ffprobe: capabilities.ffprobe.version,
      ytdlp: capabilities.ytdlp.version,
    },
    capabilities,
    database: {
      sizeBytes: data.database.sizeBytes,
      shows: data.database.shows,
      episodes: data.database.episodes,
      configEntries: data.database.configEntries,
      historicalMetadata: true,
    },
    downloads: {
      completed: data.downloads.completed,
      inQueue: data.downloads.inQueue,
      failed: data.downloads.failed,
    },
    runtime: {
      liveness: "alive",
      schema: { ready: true, state: "compatible" },
      writesEnabled: data.runtime.writesEnabled,
      worker: {
        state: data.runtime.worker.state,
        configuredConcurrency: 1,
        exclusiveOwnership: data.runtime.worker.exclusiveOwnership,
      },
    },
    uptime: data.uptime,
  };
}
