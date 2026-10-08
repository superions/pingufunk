import { expect, it } from "vitest";
import { parseSystemInformation } from "./system-information";

function fixture() {
  return {
    version: { node: "v24.21.0", ffmpeg: "7.0", ffprobe: null, ytdlp: "2026.09.23" },
    capabilities: {
      ffmpeg: { state: "ok", version: "7.0" },
      ffprobe: { state: "timeout", version: null },
      ytdlp: { state: "ok", version: "2026.09.23" },
    },
    database: {
      sizeBytes: 4096,
      shows: 3,
      episodes: 10,
      configEntries: 4,
      historicalMetadata: true,
    },
    downloads: { completed: 2, inQueue: 1, failed: 0 },
    runtime: {
      liveness: "alive",
      schema: { ready: true, state: "compatible" },
      writesEnabled: false,
      worker: { state: "disabled", configuredConcurrency: 1, exclusiveOwnership: "unverified" },
    },
    uptime: 12.5,
  };
}

it("confirms read-only capabilities separately from readiness and drops extra raw diagnostics", () => {
  const value = fixture();
  expect(
    parseSystemInformation({ ...value, privateResponse: "synthetic private path/token" })
  ).toEqual(value);
});

it.each([
  (value: ReturnType<typeof fixture>) => {
    value.database.shows = -1;
  },
  (value: ReturnType<typeof fixture>) => {
    value.uptime = NaN;
  },
  (value: ReturnType<typeof fixture>) => {
    value.runtime.schema.ready = false;
  },
  (value: ReturnType<typeof fixture>) => {
    value.runtime.worker.state = "idle";
  },
  (value: ReturnType<typeof fixture>) => {
    value.capabilities.ffprobe.version = "synthetic-private-path" as never;
  },
  (value: ReturnType<typeof fixture>) => {
    value.capabilities.ffmpeg.version = "https://synthetic.invalid/token";
    value.version.ffmpeg = value.capabilities.ffmpeg.version;
  },
  (value: ReturnType<typeof fixture>) => {
    value.runtime.worker.exclusiveOwnership = "confirmed";
  },
])("refuses contradictory or unbounded system snapshot #%#", (modify) => {
  const value = fixture();
  modify(value);
  expect(parseSystemInformation(value)).toBeNull();
});
