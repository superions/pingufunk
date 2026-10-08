import { spawn } from "node:child_process";

export type ProcessReadState = "ok" | "missing" | "timeout" | "invalid_response" | "failed";

/** Read-only capability commands never use a shell or expose their diagnostics. */
export function readBoundedProcess(
  binary: string,
  args: readonly string[],
  timeoutMs = 2000
): Promise<{ state: ProcessReadState; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, [...args], {
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (state: ProcessReadState, terminate = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (terminate && child.pid) {
        if (process.platform !== "win32") {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            child.kill("SIGKILL");
          }
        } else {
          const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
            stdio: "ignore",
            windowsHide: true,
          });
          cleanup.on("error", () => child.kill("SIGKILL"));
          const cleanupTimer = setTimeout(() => cleanup.kill("SIGKILL"), 1000);
          cleanupTimer.unref();
          cleanup.on("close", () => clearTimeout(cleanupTimer));
        }
      }
      resolve({ state, output: state === "ok" ? Buffer.concat(chunks).toString("utf8") : "" });
    };
    const timer = setTimeout(() => finish("timeout", true), timeoutMs);
    const receive = (chunk: Buffer, stdout: boolean) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 4096 || chunks.length >= 64) return finish("invalid_response", true);
      if (stdout) chunks.push(Buffer.from(chunk));
    };
    child.stdout.on("data", (chunk: Buffer) => receive(chunk, true));
    child.stderr.on("data", (chunk: Buffer) => receive(chunk, false));
    child.on("error", (error: NodeJS.ErrnoException) =>
      finish(error.code === "ENOENT" ? "missing" : "failed")
    );
    child.on("close", (code) => finish(code === 0 ? "ok" : "failed"));
  });
}
