import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

it("serializes admitted operations and never retries an uncertain mutation", async () => {
  const { serialSqliteEnqueue } = await import("./serial-enqueue");
  let active = 0;
  let max = 0;
  let calls = 0;
  const operation = async () => {
    calls++;
    max = Math.max(max, ++active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    if (calls === 1) throw new Error("Uncertain commit");
    return calls;
  };
  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => serialSqliteEnqueue(operation))
  );
  expect(max).toBe(1);
  expect(calls).toBe(8);
  expect(results[0].status).toBe("rejected");
  expect(results.slice(1).every((r) => r.status === "fulfilled")).toBe(true);
});

it("expires admission without starting a late mutation or timing out an admitted one", async () => {
  vi.useFakeTimers();
  const { serialSqliteEnqueue } = await import("./serial-enqueue");
  let finish!: () => void;
  const first = serialSqliteEnqueue(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  await Promise.resolve();
  const mutation = vi.fn(async () => {});
  const second = serialSqliteEnqueue(mutation);
  const rejected = expect(second).rejects.toMatchObject({ status: 408 });
  await vi.advanceTimersByTimeAsync(3001);
  await rejected;
  expect(mutation).not.toHaveBeenCalled();
  finish();
  await first;
  await serialSqliteEnqueue(mutation);
  expect(mutation).toHaveBeenCalledTimes(1);
});
