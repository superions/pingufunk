import { prisma } from "../src/lib/db";
import { acquireWorkerLease, type WorkerLease } from "../src/server/worker-lease";
import {
  recoverInterruptedDownloads,
  startDownloadProcessing,
  shutdownDownloadProcessing,
} from "../src/server/download-manager";

// Parent harness owns an isolated database. Only closed test messages leave IPC.
let lease: WorkerLease | null = null;
process.on("message", (message: { id: number; action: string; job?: string }) => {
  void (async () => {
    switch (message.action) {
      case "acquire":
        lease = await acquireWorkerLease();
        return { acquired: lease !== null };
      case "release":
        await lease?.release();
        lease = null;
        return { released: true };
      case "mutate":
        if (!lease) throw new Error();
        await lease.mutate((tx) =>
          tx.download.update({ where: { id: message.job }, data: { progress: 77 } })
        );
        return { written: true };
      case "recover":
        return { count: await recoverInterruptedDownloads(lease ?? undefined) };
      case "queue":
        await startDownloadProcessing();
        return { drained: true };
      case "shutdown":
        await shutdownDownloadProcessing();
        return { stopped: true };
      default:
        throw new Error();
    }
  })().then(
    (value) => process.send?.({ id: message.id, value }),
    () => process.send?.({ id: message.id, error: "unavailable" })
  );
});
process.send?.({ ready: true });
