-- A durable, conservative boundary before the first application model write.
-- Import tooling never copies this operational table from the SQLite source.
CREATE TABLE "MigrationCheckpoint" (
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MigrationCheckpoint_pkey" PRIMARY KEY ("key")
);
