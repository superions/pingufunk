import { getSetting } from "@/lib/settings";
import { configuredSetting } from "@/lib/settings-schema";
import { sourceAudioExpectation, type MediaExpectations } from "@/lib/media-expectations";
import { ensureOwnedDirectory } from "@/lib/download-paths";
import { probeJobMedia } from "./media-probe";
import type { WorkerLease } from "./worker-lease";
import * as fs from "fs/promises";
import { constants } from "fs";
import * as path from "path";

/** All transfer/mux paths converge here before exposing import-ready history. */
export async function completeValidatedDownload(
  id: string,
  filePath: string,
  jobDirectory: string,
  expectations: MediaExpectations | null,
  sourceUrl: string,
  lease: WorkerLease
): Promise<void> {
  // Frozen v3 references never re-read current GUI policy. The dynamic Sonarr
  // tolerance remains only for shipped unversioned/v1/v2 compatibility.
  const tolerance =
    expectations?.version === 3
      ? 0
      : Number(
          configuredSetting(
            "matching.sonarr.tolerancePercent",
            await getSetting("matching.sonarr.tolerancePercent")
          )
        );
  const facts = sourceAudioExpectation(expectations)
    ? await probeJobMedia(filePath, jobDirectory, expectations, tolerance, sourceUrl, lease.signal)
    : await probeJobMedia(filePath, jobDirectory, expectations, tolerance, undefined, lease.signal);
  lease.checkTransfer();
  const stats = await fs.lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size <= 0)
    throw new Error("Invalid completed media file");
  // A statement timeout must not leave an unacknowledged autocommit write queued
  // on a suspended connection. Commit only after the verified write returned.
  // A lost COMMIT acknowledgement can still be ambiguous; reconcile by reading
  // the durable row on the next wakeup, never by redownloading or provider fallback.
  await lease.mutate(async (tx) => {
    lease.checkTransfer();
    await tx.download.update({
      where: { id },
      data: {
        status: "completed",
        progress: 100,
        size: stats.size,
        filePath,
        completedAt: new Date(),
        mediaValidation: JSON.stringify({ version: expectations?.version ?? 1, ...facts }),
      },
    });
  });
}

/**
 * Move a finished file into its private job folder.
 *
 * The folder was created when the download started, but *arr apps remove the
 * imported file from the category folder while later downloads are still
 * running, and delete the folder once it is empty -- so it is re-created
 * right before the move. That still leaves a moment between mkdir and link;
 * if an import deletes the folder in exactly that instant, the ENOENT is
 * answered with one more re-create and retry. A missing SOURCE file also
 * surfaces as ENOENT and fails the retry identically, which is correct.
 */
export async function moveIntoJobDir(
  sourcePath: string,
  targetPath: string,
  tempJobDir: string,
  basePath: string,
  categoryDir: string,
  jobDir: string
): Promise<void> {
  if (path.dirname(path.resolve(sourcePath)) !== path.resolve(tempJobDir)) {
    throw new Error("Download result is outside its temporary job directory");
  }
  const sourceStat = await fs.lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Download result is not a regular job file");
  }
  const ensureTarget = async () => {
    await ensureOwnedDirectory(basePath, categoryDir);
    await ensureOwnedDirectory(categoryDir, jobDir);
  };
  await ensureTarget();
  const move = async () => {
    try {
      // link creates the target without replacing an existing file or symlink.
      await fs.link(sourcePath, targetPath);
    } catch (error) {
      // Cross-device moves and filesystems without hard-link support still
      // create a fresh target exclusively before removing the source.
      if (
        !["EXDEV", "EPERM", "EOPNOTSUPP", "ENOTSUP"].includes(
          (error as NodeJS.ErrnoException).code ?? ""
        )
      ) {
        throw error;
      }
      await fs.copyFile(sourcePath, targetPath, constants.COPYFILE_EXCL);
    }
    await fs.unlink(sourcePath);
  };
  try {
    await move();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await ensureTarget();
    await move();
  }
}
