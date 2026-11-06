import path from "node:path";

/** Resolve the configured ffprobe path for the optional capability display. */
export function getFfprobePath(): string {
  return (
    process.env.PINGUFUNK_FFPROBE_PATH ||
    path.join(process.cwd(), "ffmpeg", process.platform === "win32" ? "ffprobe.exe" : "ffprobe")
  );
}
