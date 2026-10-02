-- Preserve all existing jobs; NULL is not evidence of a passed media check.
ALTER TABLE "Download" ADD COLUMN "mediaExpectations" TEXT;
ALTER TABLE "Download" ADD COLUMN "mediaValidation" TEXT;
