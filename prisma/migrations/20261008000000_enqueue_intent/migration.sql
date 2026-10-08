-- Receipt survives deliberate history removal/retry; no FK cascade to a job.
CREATE TABLE "EnqueueIntent" (
    "id" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "downloadId" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "EnqueueIntent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EnqueueIntent_expiresAt_idx" ON "EnqueueIntent"("expiresAt");
