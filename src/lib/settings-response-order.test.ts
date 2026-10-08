import { expect, it, vi } from "vitest";
import { SettingsResponseOrder } from "./settings-response-order";

it("never adopts a late GET or a GET completed during a pending/queued write", async () => {
  const order = new SettingsResponseOrder();
  const oldRead = order.beginRead();
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const write = order.enqueueWrite(() => response);
  const during = order.beginRead();
  expect(order.isCurrent(oldRead)).toBe(false);
  expect(order.isCurrent(during)).toBe(false);
  finish();
  await write;
  expect(order.isCurrent(during)).toBe(false);
  const readback = order.beginRead();
  expect(order.isCurrent(readback)).toBe(true);
  const newer = order.beginRead();
  expect(order.isCurrent(readback)).toBe(false);
  expect(order.isCurrent(newer)).toBe(true);
});

it("serializes writes and does not retry a failed or uncertain operation", async () => {
  const order = new SettingsResponseOrder();
  const calls: string[] = [];
  let release!: () => void;
  const firstResponse = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = vi.fn(async () => {
    calls.push("first");
    await firstResponse;
    throw new Error("Unconfirmed");
  });
  const second = vi.fn(async () => {
    calls.push("second");
  });
  const failed = order.enqueueWrite(first);
  const accepted = order.enqueueWrite(second);
  const rejection = expect(failed).rejects.toThrow("Unconfirmed");
  await Promise.resolve();
  await Promise.resolve();
  expect(calls).toEqual(["first"]);
  release();
  await rejection;
  await accepted;
  expect(calls).toEqual(["first", "second"]);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(1);
  expect(order.isCurrent(order.beginRead())).toBe(true);
});
