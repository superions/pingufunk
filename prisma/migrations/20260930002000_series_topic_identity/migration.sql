-- Preserve rows and IDs; only remove the catalogue-wide uniqueness assumption.
DROP INDEX "GeneratedRuleset_topic_key";
CREATE UNIQUE INDEX "GeneratedRuleset_tvdbId_topic_key" ON "GeneratedRuleset"("tvdbId", "topic");
