let bootQueueStarted = false;

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initCacheTTL } = await import("@/lib/cache");
    await initCacheTTL();
    console.log("Cache TTL initialized from database");
    if (process.env.PINGUFUNK_BOOT_QUEUE === "1" && !bootQueueStarted) {
      bootQueueStarted = true;
      try {
        const { recoverInterruptedDownloads, startDownloadProcessing } =
          await import("@/server/download-manager");
        const interrupted = await recoverInterruptedDownloads();
        if (interrupted > 0) console.log(`[Download] Recovered ${interrupted} interrupted jobs`);
        void startDownloadProcessing().catch(() => {
          console.error("[Download] Queue startup failed; a later enqueue can retry it");
        });
      } catch {
        bootQueueStarted = false;
        throw new Error("Download recovery failed during server startup");
      }
    }
  }
}
