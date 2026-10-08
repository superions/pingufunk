import { z } from "zod";
import { DECISION_REASONS } from "./decision-diagnostics";

export const importDiagnosisSchema = z
  .object({
    state: z.enum(["unknown", "unavailable", "blocked", "reported_import", "conflicting"]),
    reason: z.enum([
      "integration_disabled",
      "category_unknown",
      "not_associated",
      "window_limited",
      "unsupported_version",
      "request_failed",
      "title_mismatch",
      "language_mismatch",
      "quality_mismatch",
      "path_unavailable",
      "import_blocked",
      "file_mismatch",
      "api_file_associated",
    ]),
  })
  .strip()
  .superRefine((value, ctx) => {
    const allowed = {
      unknown: ["integration_disabled", "category_unknown", "not_associated", "window_limited"],
      unavailable: ["unsupported_version", "request_failed"],
      blocked: [
        "title_mismatch",
        "language_mismatch",
        "quality_mismatch",
        "path_unavailable",
        "import_blocked",
      ],
      reported_import: ["api_file_associated"],
      conflicting: ["file_mismatch"],
    };
    if (!allowed[value.state].includes(value.reason))
      ctx.addIssue({ code: "custom", message: "Contradictory import evidence" });
  });
export type ImportDiagnosis = z.infer<typeof importDiagnosisSchema>;
export const jobDiagnosisSchema = z
  .object({
    version: z.literal(1),
    job: z.enum(["queued", "downloading", "converting", "completed", "failed"]),
    file: z.enum(["unverified", "verified_present", "missing", "unsafe", "unavailable"]),
    checks: z
      .object({
        duration: z.enum(["unknown", "passed"]),
        audio: z.enum(["unknown", "passed", "passed_provider"]),
        resolution: z.enum(["unknown", "passed"]),
      })
      .strip(),
    reason: z.enum(DECISION_REASONS).nullable(),
    import: importDiagnosisSchema,
    checkedAt: z.number().int().positive().safe(),
  })
  .strip()
  .superRefine((value, ctx) => {
    if (value.file === "verified_present" && value.job !== "completed")
      ctx.addIssue({ code: "custom", message: "Verified file requires terminal completion" });
  });
export type JobDiagnosis = z.infer<typeof jobDiagnosisSchema>;
export function parseJobDiagnosis(value: unknown): JobDiagnosis | null {
  const result = jobDiagnosisSchema.safeParse(value);
  return result.success ? result.data : null;
}
