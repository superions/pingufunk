import type { WorkerLease } from "./worker-lease";

export const DOWNLOAD_CONCURRENCY = 1;

// Semaphore implementation for limiting concurrent downloads
class Semaphore {
  private permits: number;
  private queue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise((resolve) => {
      this.queue.push(resolve);
    });
  }

  release(): void {
    this.permits++;
    const next = this.queue.shift();
    if (next) {
      this.permits--;
      next();
    }
  }
}

interface DownloadWorkerState {
  semaphore: Semaphore;
  processingPromise: Promise<void> | null;
  rerunRequested: boolean;
  activeLease: WorkerLease | null;
  shuttingDown: boolean;
  ownershipState: "idle" | "waiting" | "held" | "lost";
  directWork: Set<Promise<void>>;
  pendingFailures: Map<string, string>;
  shutdownHandlersInstalled: boolean;
}

const STATE_KEY = Symbol.for("pingufunk.download-worker.v1");
const processState = globalThis as typeof globalThis & { [STATE_KEY]?: DownloadWorkerState };

/** Next instrumentation and route bundles must drain the same process-local worker.
 * This shared slot is not cross-process ownership; the database lease still fences all writes.
 */
export function getDownloadWorkerState(): DownloadWorkerState {
  return (processState[STATE_KEY] ??= {
    semaphore: new Semaphore(DOWNLOAD_CONCURRENCY),
    processingPromise: null,
    rerunRequested: false,
    activeLease: null,
    shuttingDown: false,
    ownershipState: "idle",
    directWork: new Set(),
    // Unknown writes pause this drain until its interrupted jobs can be reconciled.
    pendingFailures: new Map(),
    shutdownHandlersInstalled: false,
  });
}
