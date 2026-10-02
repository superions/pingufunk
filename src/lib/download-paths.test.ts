import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp, mkdir, rm, symlink, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  assertLocalFileSafeForRemoval,
  categoryDirectory,
  ensureOwnedDirectory,
  jobDirectoryName,
  legacyPrivateCategory,
  localFilePathForRemoval,
  publicDownloadCategory,
  reportedStoragePath,
  safeFileExtension,
  safeReleaseName,
  validateReleaseTitle,
} from "./download-paths";

describe("job path ownership", () => {
  it("keeps release coordinates but cannot escape through a title or job ID", () => {
    const name = safeReleaseName("../Show.S01E02 / Finale");
    const jobDir = jobDirectoryName("../Show.S01E02 / Finale", "../../other-job");

    expect(name).toContain("Show.S01E02");
    expect(name).not.toContain("/");
    expect(jobDir).not.toContain("/");
    expect(jobDir).not.toContain("..");
    expect(jobDirectoryName("Show.S01E02", "job-a")).not.toBe(
      jobDirectoryName("Show.S01E02", "job-b")
    );
  });

  it("rejects category traversal without changing the public category", () => {
    expect(categoryDirectory("/downloads", "sonarr")).toBe("/downloads/sonarr");
    expect(() => categoryDirectory("/downloads", "../sonarr")).toThrow();
    expect(() => categoryDirectory("/downloads", "/tmp")).toThrow();
    expect(() => categoryDirectory("/downloads", "ä".repeat(121))).toThrow();
  });

  it("recognizes only bounded legacy proxy-private categories", () => {
    const category = "sonarr/Show.S01E02.rfjob-2589d87beba2";
    expect(legacyPrivateCategory(category)).toEqual({
      publicCategory: "sonarr",
      directory: "Show.S01E02.rfjob-2589d87beba2",
    });
    expect(publicDownloadCategory(category)).toBe("sonarr");
    expect(publicDownloadCategory("movies/Movie.rfjob-abc123")).toBe("movies");
    expect(publicDownloadCategory("tv/Other.rfjob-abc123")).toBe("tv/Other.rfjob-abc123");
    expect(legacyPrivateCategory("sonarr/../outside.rfjob-abc123")).toBeNull();
  });

  it("rejects absolute/traversal titles and extensions without splitting Unicode bytes", () => {
    expect(() => validateReleaseTitle("../escape")).toThrow();
    expect(() => validateReleaseTitle("/absolute")).toThrow();
    expect(() => validateReleaseTitle("\u0000hidden")).toThrow();
    expect(() => validateReleaseTitle("!!!")).toThrow();
    expect(safeReleaseName("März.".repeat(100)).length).toBeGreaterThan(0);
    expect(Buffer.byteLength(safeReleaseName("März.".repeat(100)), "utf8")).toBeLessThanOrEqual(
      160
    );
    expect(safeFileExtension("/video.MP4")).toBe(".MP4");
    expect(() => safeFileExtension("/video.verylongextension")).toThrow();
  });

  it("maps only new local storage and retains an already mapped legacy path", () => {
    const local = path.join("/downloads", "sonarr", "job-id", "Show.S01E02.mkv");
    const remote = path.join("/mapped", "downloads", "sonarr", "job-id", "Show.S01E02.mkv");

    expect(reportedStoragePath(local, "/downloads", "/mapped/downloads")).toBe(
      "/mapped/downloads/sonarr/job-id"
    );
    expect(reportedStoragePath(remote, "/downloads", "/mapped/downloads")).toBe(
      "/mapped/downloads/sonarr/job-id"
    );
    expect(reportedStoragePath(local, "/downloads", undefined)).toBe("/downloads/sonarr/job-id");
  });

  it("resolves only this job's file for removal, including a flat legacy mapping", () => {
    const job = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Show.S01E02",
      category: "sonarr",
      filePath: "",
    };
    const own = `/downloads/sonarr/${jobDirectoryName(job.title, job.id)}/Show.S01E02.mkv`;

    expect(localFilePathForRemoval({ ...job, filePath: own }, "/downloads", undefined)).toBe(own);
    expect(
      localFilePathForRemoval(
        { ...job, filePath: "/mapped/downloads/sonarr/Show.S01E02.mkv" },
        "/downloads",
        "/mapped/downloads"
      )
    ).toBe("/downloads/sonarr/Show.S01E02.mkv");
    expect(() =>
      localFilePathForRemoval(
        { ...job, filePath: "/downloads/sonarr/other-job/Show.S01E02.mkv" },
        "/downloads",
        undefined
      )
    ).toThrow();
    expect(
      localFilePathForRemoval(
        {
          ...job,
          category: "sonarr/Show.S01E02.rfjob-2589d87beba2",
          filePath: "/mapped/downloads/sonarr/Show.S01E02.rfjob-2589d87beba2/Show.S01E02.mkv",
        },
        "/downloads",
        "/mapped/downloads"
      )
    ).toBe("/downloads/sonarr/Show.S01E02.rfjob-2589d87beba2/Show.S01E02.mkv");
    expect(() =>
      localFilePathForRemoval({ ...job, filePath: "/tmp/Show.S01E02.mkv" }, "/downloads", undefined)
    ).toThrow();
  });

  it("rejects a job-directory symlink before deleting a file outside the root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pingufunk-paths-"));
    const outside = await mkdtemp(path.join(tmpdir(), "pingufunk-outside-"));
    try {
      const category = path.join(root, "sonarr");
      await mkdir(category);
      await writeFile(path.join(outside, "Show.S01E02.mkv"), "neighbor");
      const linkedJob = path.join(category, "job-id");
      await symlink(outside, linkedJob);

      await expect(
        assertLocalFileSafeForRemoval(path.join(linkedJob, "Show.S01E02.mkv"), root)
      ).rejects.toThrow();
      await expect(access(path.join(outside, "Show.S01E02.mkv"))).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a category symlink before creating an output directory outside the root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pingufunk-root-"));
    const outside = await mkdtemp(path.join(tmpdir(), "pingufunk-outside-"));
    try {
      await symlink(outside, path.join(root, "sonarr"));
      await expect(ensureOwnedDirectory(root, path.join(root, "sonarr"))).rejects.toThrow();
      await expect(access(path.join(outside, "Show.S01E02"))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    }
  });
});
