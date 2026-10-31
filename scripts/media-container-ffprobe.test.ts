import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { expect, it } from "vitest";

async function fixture(
  paused: boolean,
  observe: (files: { ready: string; release: string; called: string }) => Promise<void>
) {
  const directory = mkdtempSync(path.join(tmpdir(), "pingufunk-probe-barrier-"));
  const ready = path.join(directory, "media-probe-ready");
  const release = path.join(directory, "media-probe-release");
  const called = path.join(directory, "probe-called");
  const tool = path.join(directory, "probe tool.sh");
  writeFileSync(tool, '#!/bin/sh\nprintf "%s\\n" "$@" > "$PINGUFUNK_MEDIA_QA_PROBE_OUTPUT"\n', {
    mode: 0o755,
  });
  if (paused) writeFileSync(path.join(directory, "pause-next-probe"), "synthetic control");
  const child = spawn(
    path.resolve("scripts/media-container-ffprobe.sh"),
    ["-v", "error", "file with spaces.mp4"],
    {
      env: {
        ...process.env,
        PINGUFUNK_MEDIA_QA_CONTROL_DIR: directory,
        PINGUFUNK_MEDIA_QA_FFPROBE: tool,
        PINGUFUNK_MEDIA_QA_PROBE_OUTPUT: called,
      },
      detached: true,
      stdio: "ignore",
    }
  );
  const completion = new Promise<{ code: number | null; error?: Error }>((resolve) => {
    child.once("error", (error) => resolve({ code: null, error }));
    child.once("exit", (code) => resolve({ code }));
  });
  try {
    await observe({ ready, release, called });
    expect(await completion).toEqual({ code: 0 });
    expect(readFileSync(called, "utf8").trimEnd().split("\n")).toEqual([
      "-v",
      "error",
      "file with spaces.mp4",
    ]);
  } finally {
    try {
      if (child.pid) process.kill(-child.pid, "SIGTERM");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
    await completion;
    rmSync(directory, { recursive: true });
  }
}

it("forwards an unpaused probe and its complete arguments", async () => {
  await fixture(false, async ({ ready }) => {
    expect(existsSync(ready)).toBe(false);
  });
});

it("holds the actual probe fixture until explicit release despite a delayed observer", async () => {
  await fixture(true, async ({ ready, release, called }) => {
    const deadline = Date.now() + 2000;
    while (!existsSync(ready) && Date.now() < deadline) await delay(20);
    expect(existsSync(ready)).toBe(true);
    // The former eight-second sleep could finish before a delayed DB pause.
    await delay(9000);
    expect(existsSync(called)).toBe(false);
    writeFileSync(release, "database pause already confirmed");
  });
}, 20_000);
