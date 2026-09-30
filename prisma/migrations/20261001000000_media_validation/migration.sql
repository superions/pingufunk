-- Legacy jobs retain unknown expectations and have no fabricated validation facts.
ALTER TABLE "Download" ADD COLUMN "mediaExpectations" TEXT;
ALTER TABLE "Download" ADD COLUMN "mediaValidation" TEXT;
