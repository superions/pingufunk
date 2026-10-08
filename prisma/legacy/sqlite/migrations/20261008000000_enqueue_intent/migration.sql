-- Receipt survives deliberate history removal/retry; no FK cascade to a job.
CREATE TABLE "EnqueueIntent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payloadHash" TEXT NOT NULL,
    "downloadId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL
);
CREATE INDEX "EnqueueIntent_expiresAt_idx" ON "EnqueueIntent"("expiresAt");
