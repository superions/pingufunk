import * as fs from "node:fs/promises";
import path from "node:path";
import { readPersistedMediaExpectations } from "@/lib/media-expectations";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import {
  categoryDirectory,
  getDownloadBasePath,
  jobDirectoryName,
  publicDownloadCategory,
} from "@/lib/download-paths";
import { formatTitle, parseEpisodeFromTitle } from "@/services/newznab";
import { openSonarrSession, SonarrUnavailableError } from "@/services/sonarr-provider";
import type { WorkerLease } from "./worker-lease";

interface QueuedJob {
  id: string;
  title: string;
  category?: string;
  status?: string;
  progress?: number;
  downloadedBytes?: bigint;
  filePath?: string | null;
  mediaExpectations?: string | null;
}

async function emptyOrMissing(directory: string): Promise<void> {
  try {
    const info = await fs.lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink())
      throw new Error("Existing job artifacts require reconciliation");
    const dir = await fs.opendir(directory);
    for await (const _entry of dir)
      throw new Error("Existing job artifacts require reconciliation");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Transition shipped, unstarted typed jobs under the same worker lease.
 * No filename-derived series identity, history rewrite or existing-file rename.
 */
export async function prepareSonarrJobTitle(job: QueuedJob, lease: WorkerLease): Promise<void> {
  if (
    job.status !== "queued" ||
    job.filePath ||
    job.progress ||
    job.downloadedBytes ||
    !job.mediaExpectations ||
    !["sonarr", "tv"].includes(publicDownloadCategory(job.category ?? ""))
  )
    return;
  let expected;
  try {
    expected = readPersistedMediaExpectations(job.mediaExpectations);
  } catch {
    // The normal worker still rejects corrupt rows; this transition cannot repair them.
    return;
  }
  if (expected?.version !== 5 || expected.sourceRef.programme.kind !== "series") return;
  const binding = expected.sourceRef.programme;
  const marker = `.S${String(binding.season).padStart(2, "0")}E${String(binding.episode).padStart(2, "0")}.`;
  const boundary = job.title.indexOf(marker);
  if (boundary < 0) {
    const parsed = parseEpisodeFromTitle(job.title);
    if (
      parsed.season !== null &&
      (parsed.season !== binding.season ||
        parsed.episodes.length !== 1 ||
        parsed.episodes[0] !== binding.episode)
    )
      throw new Error("Queued title conflicts with frozen episode binding");
    return; // Custom non-release titles keep their shipped contract.
  }
  if (boundary <= 0 || job.title.lastIndexOf(marker) !== boundary)
    throw new Error("Queued title conflicts with frozen episode binding");
  const session = await openSonarrSession();
  if (!session) return;
  const show = await session.show(binding.targetId, new HttpRequestBudget(6, 8000));
  if (
    !show ||
    !show.episodes.some(
      (episode) =>
        episode.seasonNumber === binding.season && episode.episodeNumber === binding.episode
    )
  )
    throw new SonarrUnavailableError();
  const prefix = job.title.slice(0, boundary).toLocaleLowerCase("de-DE");
  if (
    [show.series.title, ...(show.series.aliases ?? [])].some(
      (name) => formatTitle(name).toLocaleLowerCase("de-DE") === prefix
    )
  )
    return;
  const title = formatTitle(show.series.title) + job.title.slice(boundary);
  const base = await getDownloadBasePath();
  for (const name of [job.title, title]) {
    const directory = jobDirectoryName(name, job.id);
    await emptyOrMissing(
      path.join(process.env.DOWNLOAD_TEMP_PATH || path.join(base, "incomplete"), directory)
    );
    await emptyOrMissing(
      path.join(categoryDirectory(base, publicDownloadCategory(job.category!)), directory)
    );
  }
  await lease.mutate((tx) =>
    tx.download.update({
      where: {
        id: job.id,
        status: "queued",
        title: job.title,
        mediaExpectations: job.mediaExpectations,
        filePath: null,
        downloadedBytes: BigInt(0),
        progress: 0,
      },
      data: { title },
    })
  );
}
