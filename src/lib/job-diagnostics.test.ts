import { expect, it } from "vitest";
import { parseJobDiagnosis } from "./job-diagnostics";
const report = {
  version: 1,
  job: "completed",
  file: "unverified",
  checks: { duration: "unknown", audio: "unknown", resolution: "unknown" },
  reason: null,
  import: { state: "unknown", reason: "integration_disabled" },
  checkedAt: 1700000000000,
};
it("keeps Completed separate and strips raw private fields at every browser boundary", () => {
  expect(
    parseJobDiagnosis({
      ...report,
      raw: "secret",
      import: { ...report.import, path: "private" },
      checks: { ...report.checks, token: "private" },
    })
  ).toEqual(report);
});
it.each([
  { ...report, file: "completed" },
  { ...report, import: { state: "imported", reason: "api_file_associated" } },
  { ...report, checks: { ...report.checks, audio: "German assumed" } },
  { ...report, import: { state: "reported_import", reason: "not_associated" } },
  { ...report, job: "failed", file: "verified_present" },
])("rejects unproved or invented transport labels", (value) =>
  expect(parseJobDiagnosis(value)).toBeNull()
);
