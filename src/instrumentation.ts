let bootQueueStarted = false;

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initCacheTTL } = await import("@/lib/cache");
    await initCacheTTL();
    console.log("Cache TTL initialized from database");
    if (
      process.env.PINGUFUNK_BOOT_QUEUE === "1" &&
      process.env.PINGUFUNK_WRITES_ENABLED === "1" &&
      !bootQueueStarted
    ) {
      bootQueueStarted = true;
      try {
        const { startDownloadProcessing, installWorkerShutdownHandlers } =
          await import("@/server/download-manager");
        installWorkerShutdownHandlers();
        // Recovery happens inside the exclusive lease, never before acquisition.
        void startDownloadProcessing().catch(() => {
          console.error("[Download] Queue startup failed; a later enqueue can retry it");
        });
      } catch {
        bootQueueStarted = false;
        throw new Error("Download worker failed during server startup");
      }
    }
  }
}
