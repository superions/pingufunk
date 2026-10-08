import { spawn, type ChildProcess } from "node:child_process";

/** Target only the process group we spawned, never a binary-name pattern. */
export function bindOwnedProcessAbort(child: ChildProcess, signal?: AbortSignal) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const kill = (force: boolean) => {
    if (child.pid && process.platform !== "win32") {
      try {
        process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
      } catch {
        child.kill(force ? "SIGKILL" : "SIGTERM");
      }
    } else if (child.pid && process.platform === "win32") {
      const cleanup = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
        windowsHide: true,
      });
      const limit = setTimeout(() => cleanup.kill("SIGKILL"), 1000);
      cleanup.once("error", () => child.kill("SIGKILL"));
      cleanup.once("close", () => clearTimeout(limit));
      limit.unref();
    } else child.kill(force ? "SIGKILL" : "SIGTERM");
  };
  const terminate = () => {
    if (timer) return;
    kill(false);
    timer = setTimeout(() => kill(true), 2000);
    timer.unref();
  };
  const dispose = () => {
    // The leader can exit before its spawned mux child. Finish this exact
    // terminated group too, rather than leaving descendants behind on close.
    if (timer) kill(true);
    clearTimeout(timer);
    timer = undefined;
    signal?.removeEventListener("abort", terminate);
  };
  child.once("close", dispose);
  child.once("error", dispose);
  signal?.addEventListener("abort", terminate, { once: true });
  if (signal?.aborted) terminate();
  // Termination requests are not completion; callers await the child's close.
  return { terminate, dispose };
}
