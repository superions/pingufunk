import { expect, it, vi } from "vitest";

it("shares queue and shutdown ownership across independently loaded module graphs", async () => {
  const first = (await import("./download-worker-state")).getDownloadWorkerState();
  const work = Promise.resolve();
  first.directWork.add(work);
  first.rerunRequested = true;
  first.shutdownHandlersInstalled = true;
  try {
    vi.resetModules();
    const other = (await import("./download-worker-state")).getDownloadWorkerState();
    expect(other).toBe(first);
    expect(other.directWork.has(work)).toBe(true);
    expect(other.rerunRequested).toBe(true);
    expect(other.shutdownHandlersInstalled).toBe(true);
    other.shuttingDown = true;
    expect(first.shuttingDown).toBe(true);
  } finally {
    first.directWork.delete(work);
    first.rerunRequested = false;
    first.shuttingDown = false;
    first.shutdownHandlersInstalled = false;
  }
});
