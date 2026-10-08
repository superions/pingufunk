import { expect, it } from "vitest";
import { readBoundedProcess } from "./bounded-process";

it("reads version output without a shell and suppresses all failed diagnostics", async () => {
  expect(
    await readBoundedProcess(process.execPath, ["-e", 'process.stdout.write("1.2.3")'])
  ).toEqual({ state: "ok", output: "1.2.3" });
  expect(
    await readBoundedProcess(process.execPath, [
      "-e",
      'console.error("synthetic-private-path/token");process.exit(2)',
    ])
  ).toEqual({ state: "failed", output: "" });
  expect(await readBoundedProcess("/synthetic/absent/tool", [])).toEqual({
    state: "missing",
    output: "",
  });
});

it("bounds stdout and stderr bytes and leaves the event loop responsive during a timeout", async () => {
  expect(
    await readBoundedProcess(process.execPath, [
      "-e",
      'process.stdout.write("x".repeat(4097));setInterval(()=>{},1000)',
    ])
  ).toEqual({ state: "invalid_response", output: "" });
  expect(
    await readBoundedProcess(process.execPath, [
      "-e",
      'process.stderr.write("x".repeat(4097));setInterval(()=>{},1000)',
    ])
  ).toEqual({ state: "invalid_response", output: "" });
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);
  try {
    expect(
      await readBoundedProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], 150)
    ).toEqual({ state: "timeout", output: "" });
    expect(ticks).toBeGreaterThanOrEqual(5);
  } finally {
    clearInterval(heartbeat);
  }
});
