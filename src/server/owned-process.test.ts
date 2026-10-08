import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { bindOwnedProcessAbort } from "./owned-process";

it("aborts only its exact child group and awaits close, including a stubborn mux child", async () => {
  const untouched = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
    stdio: "ignore",
  });
  const child = spawn(
    process.execPath,
    ["-e", "process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],
    { detached: process.platform !== "win32", stdio: ["ignore", "pipe", "ignore"] }
  );
  const controller = new AbortController();
  const owned = bindOwnedProcessAbort(child, controller.signal);
  try {
    await once(child.stdout!, "data");
    const closed = once(child, "close");
    controller.abort();
    expect(untouched.exitCode).toBeNull();
    expect(child.exitCode).toBeNull();
    await closed;
    expect(child.signalCode).toBe(process.platform === "win32" ? "SIGTERM" : "SIGKILL");
    expect(untouched.exitCode).toBeNull();
  } finally {
    owned.dispose();
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    const exited = once(untouched, "exit");
    untouched.kill("SIGTERM");
    await exited;
  }
}, 6000);
