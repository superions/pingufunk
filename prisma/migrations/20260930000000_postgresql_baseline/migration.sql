-- PostgreSQL-native baseline for the six persisted Pingufunk models.
-- SQLite migrations are archived under prisma/legacy/sqlite/migrations.
CREATE TABLE "TvdbSeries" (
    "id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "germanName" TEXT,
    "slug" TEXT,
    "overview" TEXT,
    "aliases" TEXT,
    "firstAired" TIMESTAMPTZ(3),
    "cachedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "TvdbSeries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TvdbEpisode" (
    "id" SERIAL NOT NULL,
    "seriesId" INTEGER NOT NULL,
    "seasonNumber" INTEGER NOT NULL,
    "episodeNumber" INTEGER NOT NULL,
    "name" TEXT,
    "aired" TIMESTAMPTZ(3),
    "runtime" INTEGER,
    CONSTRAINT "TvdbEpisode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Download" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "size" BIGINT NOT NULL DEFAULT 0,
    "totalSize" BIGINT NOT NULL DEFAULT 0,
    "downloadedBytes" BIGINT NOT NULL DEFAULT 0,
    "speed" BIGINT NOT NULL DEFAULT 0,
    "filePath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),
    CONSTRAINT "Download_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Config" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    CONSTRAINT "Config_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "GeneratedRuleset" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "tvdbId" INTEGER NOT NULL,
    "showName" TEXT NOT NULL,
    "germanName" TEXT,
    "matchingStrategy" TEXT NOT NULL DEFAULT 'SeasonAndEpisodeNumber',
    "filters" TEXT NOT NULL DEFAULT '[{"attribute":"duration","type":"GreaterThan","value":"15"}]',
    "episodeRegex" TEXT NOT NULL DEFAULT '(?<=[E/])(\d{2})(?=\))',
    "seasonRegex" TEXT NOT NULL DEFAULT '(?<=[S(])(\d{2})(?=[/E])',
    "titleRegexRules" TEXT NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GeneratedRuleset_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TopicCategory" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "tmdbId" INTEGER,
    "cachedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TopicCategory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TvdbEpisode_seriesId_seasonNumber_episodeNumber_idx" ON "TvdbEpisode"("seriesId", "seasonNumber", "episodeNumber");
CREATE INDEX "Download_status_idx" ON "Download"("status");
CREATE UNIQUE INDEX "GeneratedRuleset_topic_key" ON "GeneratedRuleset"("topic");
CREATE INDEX "GeneratedRuleset_tvdbId_idx" ON "GeneratedRuleset"("tvdbId");
CREATE UNIQUE INDEX "TopicCategory_topic_key" ON "TopicCategory"("topic");
CREATE INDEX "TopicCategory_topic_idx" ON "TopicCategory"("topic");
ALTER TABLE "TvdbEpisode" ADD CONSTRAINT "TvdbEpisode_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "TvdbSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
