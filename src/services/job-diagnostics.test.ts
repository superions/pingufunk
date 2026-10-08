import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const { find, base, arr } = vi.hoisted(() => ({ find: vi.fn(), base: vi.fn(), arr: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { download: { findUnique: find } } }));
vi.mock("@/lib/settings", () => ({ getSetting: base }));
vi.mock("./arr-import-diagnostics", () => ({ diagnoseArrImport: arr }));
vi.mock("@/server/runtime-readiness", () => ({
  boundedRuntimeRead: (work: Promise<unknown>) => work,
}));
import { getJobDiagnosis } from "./job-diagnostics";
import { jobDirectoryName, safeReleaseName } from "@/lib/download-paths";
let root: string, row: Record<string, unknown>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "pingufunk-job-diagnosis-"));
  base.mockResolvedValue(root);
  arr.mockResolvedValue({ state: "unknown", reason: "integration_disabled" });
  const id = "10000000-0000-4000-8000-000000000001",
    title = "Synthetic.Job",
    folder = path.join(root, "sonarr", jobDirectoryName(title, id));
  await mkdir(folder, { recursive: true });
  const file = path.join(folder, `${safeReleaseName(title)}.mkv`);
  await writeFile(file, "synthetic");
  row = {
    id,
    title,
    category: "sonarr",
    status: "completed",
    size: BigInt(9),
    filePath: file,
    mediaValidation: JSON.stringify({
      version: 1,
      durationSeconds: 2,
      video: [{ width: 1280, height: 720 }],
      audioLanguages: ["de"],
      expectedChecks: { duration: "unknown", audio: "passed", resolution: "unknown" },
    }),
    error: null,
  };
  find.mockImplementation(async () => row);
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
it("requires real regular owned file and exact persisted size, returns no private fields", async () => {
  const result = await getJobDiagnosis(String(row.id));
  expect(result?.file).toBe("verified_present");
  expect(result?.import.state).toBe("unknown");
  expect(JSON.stringify(result)).not.toMatch(/Synthetic|sonarr|\.mkv|filePath/);
  row.size = BigInt(10);
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("unsafe");
});
it.each([1, 2, 3])("reads completed media facts v%s without rewriting the job", async (version) => {
  row.mediaValidation = JSON.stringify({ ...JSON.parse(String(row.mediaValidation)), version });
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("verified_present");
  expect(JSON.parse(String(row.mediaValidation)).version).toBe(version);
});
it("unknown future media fact versions cannot become a verified file", async () => {
  row.mediaValidation = JSON.stringify({ ...JSON.parse(String(row.mediaValidation)), version: 4 });
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("unverified");
});
it("missing after a native move is independent from an associated API import", async () => {
  await rm(String(row.filePath));
  arr.mockResolvedValue({ state: "reported_import", reason: "api_file_associated" });
  const result = await getJobDiagnosis(String(row.id));
  expect(result?.file).toBe("missing");
  expect(result?.import.state).toBe("reported_import");
});
it("never follows symlinks, probes arbitrary paths or promotes legacy Completed", async () => {
  const file = String(row.filePath);
  await rm(file);
  const outside = path.join(root, "neighbor");
  await writeFile(outside, "synthetic");
  await symlink(outside, file);
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("unsafe");
  row.filePath = outside;
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("unsafe");
  row.filePath = null;
  row.mediaValidation = null;
  expect((await getJobDiagnosis(String(row.id)))?.file).toBe("missing");
});
it("preserves closed failure reason but never forwards historical free error text", async () => {
  row.status = "failed";
  row.error =
    'Local media validation failed: {"version":1,"stage":"media","reason":"language_conflict","evidence":"conflicting"}';
  expect((await getJobDiagnosis(String(row.id)))?.reason).toBe("language_conflict");
  row.error = "private token https://never.invalid";
  expect(JSON.stringify(await getJobDiagnosis(String(row.id)))).not.toMatch(/private|token|https/);
});
it("coalesces selected-job reads and propagates DB failure, not a healthy stale cache", async () => {
  let resolve!: (value: unknown) => void;
  find.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      })
  );
  const one = getJobDiagnosis(String(row.id)),
    two = getJobDiagnosis(String(row.id));
  expect(one).toBe(two);
  resolve(row);
  await one;
  find.mockRejectedValue(new Error("private"));
  await expect(getJobDiagnosis(String(row.id))).rejects.toThrow();
});
