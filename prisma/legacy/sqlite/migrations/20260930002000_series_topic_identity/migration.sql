-- Bootstrap databases must first use the verified copy-based baseline transition.
-- Their inline UNIQUE constraint cannot be removed with DROP INDEX.
DROP INDEX "GeneratedRuleset_topic_key";
CREATE UNIQUE INDEX "GeneratedRuleset_tvdbId_topic_key" ON "GeneratedRuleset"("tvdbId", "topic");
