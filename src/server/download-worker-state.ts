import type { WorkerLease } from "./worker-lease";
import { DEFAULT_PRODUCT_SETTINGS, DOWNLOAD_WORKER_SETTINGS } from "@/lib/settings-schema";

// One fenced supervisor with independently configured transport capacities.
const defaultWorkerLimits = () =>
  Object.fromEntries(
    Object.entries(DOWNLOAD_WORKER_SETTINGS).map(([family, key]) => [
      family,
      Number(DEFAULT_PRODUCT_SETTINGS[key]),
    ])
  );

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
  recoveryTimer?: ReturnType<typeof setTimeout>;
  activeLease: WorkerLease | null;
  shuttingDown: boolean;
  drainRequested: boolean;
  ownershipState: "idle" | "waiting" | "held" | "lost";
  directWork: Set<Promise<void>>;
  pendingFailures: Map<string, string>;
  sourceWorkers: Set<string>;
  workerLimits: Record<string, number>;
  shutdownHandlersInstalled: boolean;
}

const STATE_KEY = Symbol.for("pingufunk.download-worker.v2");
const processState = globalThis as typeof globalThis & { [STATE_KEY]?: DownloadWorkerState };

/** Next instrumentation and route bundles must drain the same process-local worker.
 * This shared slot is not cross-process ownership; the database lease still fences all writes.
 */
export function getDownloadWorkerState(): DownloadWorkerState {
  return (processState[STATE_KEY] ??= {
    // Direct diagnostic execution still acquires the entire supervisor lease.
    semaphore: new Semaphore(1),
    processingPromise: null,
    rerunRequested: false,
    activeLease: null,
    shuttingDown: false,
    drainRequested: false,
    ownershipState: "idle",
    directWork: new Set(),
    // Unknown writes pause this drain until its interrupted jobs can be reconciled.
    pendingFailures: new Map(),
    sourceWorkers: new Set(),
    workerLimits: defaultWorkerLimits(),
    shutdownHandlersInstalled: false,
  });
}
