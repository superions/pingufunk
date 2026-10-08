import { z } from "zod";
import { lstat } from "node:fs/promises";
import { prisma } from "@/lib/db";
import {
  getDownloadBasePath,
  localFilePathForRemoval,
  assertLocalFileSafeForRemoval,
  UnsafeDownloadPathError,
} from "@/lib/download-paths";
import { sourceAudioSchema } from "@/lib/media-expectations";
import { parseDecisionEvent } from "@/lib/decision-diagnostics";
import { jobDiagnosisSchema, type JobDiagnosis } from "@/lib/job-diagnostics";
import { boundedRuntimeRead } from "@/server/runtime-readiness";
import { diagnoseArrImport } from "./arr-import-diagnostics";

const checkSchema = jobDiagnosisSchema.shape.checks;
const factsSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  durationSeconds: z.number().finite().positive(),
  video: z
    .array(z.object({ width: z.number().int().positive(), height: z.number().int().positive() }))
    .min(1)
    .max(512),
  audioLanguages: z.array(z.string().max(35)).max(512),
  sourceAudioEvidence: sourceAudioSchema.optional(),
  expectedChecks: checkSchema,
});
const pending = new Map<string, Promise<JobDiagnosis | null>>();

async function inspectJob(id: string): Promise<JobDiagnosis | null> {
  const row = await boundedRuntimeRead(
    prisma.download.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        category: true,
        status: true,
        size: true,
        filePath: true,
        mediaValidation: true,
        error: true,
      },
    })
  );
  if (!row) return null;
  const diagnosis: JobDiagnosis = {
    version: 1,
    job: jobDiagnosisSchema.shape.job.parse(row.status),
    file: "unverified",
    checks: { duration: "unknown", audio: "unknown", resolution: "unknown" },
    reason: null,
    import: { state: "unknown", reason: "not_associated" },
    checkedAt: Date.now(),
  };
  if (row.error?.startsWith("Local media validation failed: ") && row.error.length < 32_768) {
    try {
      const value = JSON.parse(row.error.slice("Local media validation failed: ".length));
      if (value.version === 1)
        diagnosis.reason = parseDecisionEvent({ ...value, count: 1 })?.reason ?? null;
    } catch {
      /* Historical free text is not a display contract. */
    }
  } else if (row.error?.startsWith("Download failed: ")) diagnosis.reason = "transfer_failed";
  if (row.status === "completed") {
    let facts: z.infer<typeof factsSchema> | null = null;
    try {
      if (row.mediaValidation && row.mediaValidation.length < 131_072)
        facts = factsSchema.parse(JSON.parse(row.mediaValidation));
    } catch {
      diagnosis.reason = "probe_invalid";
    }
    if (facts) diagnosis.checks = facts.expectedChecks;
    if (row.filePath) {
      try {
        const present = await boundedRuntimeRead(
          (async () => {
            const base = await getDownloadBasePath();
            const file = localFilePathForRemoval(
              { ...row, filePath: row.filePath! },
              base,
              process.env.DOWNLOAD_FOLDER_PATH_MAPPING
            );
            if (!(await assertLocalFileSafeForRemoval(file, base))) return false;
            const stat = await lstat(file, { bigint: true });
            if (
              !stat.isFile() ||
              stat.isSymbolicLink() ||
              stat.size <= BigInt(0) ||
              stat.size !== row.size
            )
              throw new UnsafeDownloadPathError();
            return true;
          })()
        );
        diagnosis.file = present ? (facts ? "verified_present" : "unverified") : "missing";
      } catch (error) {
        diagnosis.file = error instanceof UnsafeDownloadPathError ? "unsafe" : "unavailable";
      }
    } else diagnosis.file = "missing";
  }
  // Import is independent: a native Arr move can legitimately remove our local file.
  diagnosis.import = await diagnoseArrImport(id, row.category);
  diagnosis.checkedAt = Date.now();
  return jobDiagnosisSchema.parse(diagnosis);
}

/** Selected job only; coalesce up to eight active read operations, no global reader/cache. */
export function getJobDiagnosis(id: string): Promise<JobDiagnosis | null> {
  const existing = pending.get(id);
  if (existing) return existing;
  if (pending.size >= 8) return Promise.reject(new Error("Diagnosis capacity unavailable"));
  const work = inspectJob(id).finally(() => pending.delete(id));
  pending.set(id, work);
  return work;
}
