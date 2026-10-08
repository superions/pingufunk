import { prisma, databaseProvider } from "@/lib/db";
import type { Prisma } from "../../generated/sqlite";
import { allDownloads, type DownloadRead } from "@/lib/download-read";
import { randomUUID } from "crypto";
import { createEnqueueIntent } from "./enqueue-intent";
import { assertWritesEnabled } from "@/lib/write-gate";
import path from "node:path";
import {
  assertLocalFileSafeForRemoval,
  getDownloadBasePath,
  localFilePathForRemoval,
  publicDownloadCategory,
  reportedStoragePath,
  UnsafeDownloadPathError,
  validateCategory,
  validateReleaseTitle,
} from "@/lib/download-paths";
export { parseNzbContent } from "./nzb-release";
import {
  serializeMediaExpectations,
  readPersistedMediaExpectations,
  type MediaExpectations,
} from "@/lib/media-expectations";

/**
 * Format seconds remaining as SABnzbd's strict "H:MM:SS" timeleft format.
 * Radarr/Sonarr's SABnzbd client parser rejects anything else (including
 * "M:SS" for under an hour, or a free-text placeholder) with
 * "Expected either 0:0:0:0 or 0:0:0 format, but received: ..." - which
 * makes every queue poll fail, so they never see an in-progress download
 * even while it's genuinely downloading. Always emit the full form.
 */
export function formatSabnzbdTimeleft(secondsLeft: number): string {
  const hours = Math.floor(secondsLeft / 3600);
  const minutes = Math.floor((secondsLeft % 3600) / 60);
  const seconds = secondsLeft % 60;
  return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

export interface QueueItem {
  nzo_id: string;
  filename: string;
  status: string;
  percentage: string;
  timeleft: string;
  cat: string;
  mb: string;
  mbleft: string;
  speed: string;
}

export interface HistoryItem {
  nzo_id: string;
  name: string;
  status: string;
  completed: number;
  category: string;
  storage: string;
  bytes: number;
  fail_message: string;
}

export interface SabnzbdQueue {
  slots: QueueItem[];
  noofslots: number;
  noofslots_total: number;
  start: number;
  limit: number;
}

export interface SabnzbdHistory {
  slots: HistoryItem[];
  noofslots: number;
  noofslots_total: number;
  start: number;
  limit: number;
}

export async function addToQueue(
  url: string,
  title: string,
  category: string,
  mediaExpectations?: MediaExpectations,
  enqueueKey?: string
): Promise<{ id: string }> {
  assertWritesEnabled();
  validateCategory(category);
  validateReleaseTitle(title);
  const data = {
    id: randomUUID(),
    title,
    url,
    category,
    status: "queued" as const,
    progress: 0,
    mediaExpectations:
      mediaExpectations === undefined ? null : serializeMediaExpectations(mediaExpectations),
  };
  const download =
    enqueueKey !== undefined
      ? await createEnqueueIntent(data, enqueueKey)
      : await prisma.download.create({ data });

  // Trigger download processing asynchronously
  // Import dynamically to avoid circular dependencies and ensure server-side only
  if (!("created" in download) || download.created) triggerDownloadProcessing();

  return { id: download.id };
}

// Trigger download processing without blocking
function triggerDownloadProcessing(): void {
  // Use dynamic import to load the download manager only on server-side
  import("@/server/download-manager")
    .then(({ startDownloadProcessing }) => {
      startDownloadProcessing().catch(() => console.error("Failed to start download processing"));
    })
    .catch(() => {
      console.error("Failed to load download manager");
    });
}

async function readDownloads(kind: "queue" | "history", options: DownloadRead) {
  const status = {
    in: kind === "queue" ? ["queued", "downloading", "converting"] : ["completed", "failed"],
  };
  const where: Prisma.DownloadWhereInput = {
    AND: [
      { status },
      ...(options.statuses.length ? [{ status: { in: options.statuses } }] : []),
      ...(options.ids.length ? [{ id: { in: options.ids } }] : []),
      ...(options.categories.length
        ? [
            {
              OR: options.categories.flatMap((category) => [
                { category },
                { category: { startsWith: `${category}/` } },
              ]),
            },
          ]
        : []),
      ...(options.search
        ? [
            {
              title: {
                contains: options.search,
                ...(databaseProvider === "postgresql" ? { mode: "insensitive" as const } : {}),
              },
            },
          ]
        : []),
    ],
  };
  const args: Prisma.DownloadFindManyArgs = {
    where,
    skip: options.start,
    ...(options.limit > 0 ? { take: options.limit } : {}),
    // A unique tie-breaker makes equal timestamps stable on both providers.
    // Historical failed jobs can have NULL completion times: keep them last.
    orderBy:
      kind === "queue"
        ? [{ createdAt: "asc" }, { id: "asc" }]
        : [{ completedAt: { sort: "desc", nulls: "last" } }, { id: "asc" }],
    omit: {
      url: true,
      mediaExpectations: true,
      mediaValidation: true,
    },
  };
  if (
    options.limit === 0 &&
    options.start === 0 &&
    !options.categories.length &&
    !options.ids.length &&
    !options.search &&
    !options.statuses.length
  ) {
    const downloads = await prisma.download.findMany(args);
    return {
      downloads,
      noofslots: downloads.length,
      noofslots_total: downloads.length,
      start: 0,
      limit: 0,
    };
  }
  // Count and rows share a read snapshot. New completions appear on the next
  // refresh, not as a contradictory count inside this single response.
  return prisma.$transaction(
    async (tx) => {
      const noofslots = await tx.download.count({ where });
      const noofslots_total = await tx.download.count({ where: { status } });
      const downloads = await tx.download.findMany(args);
      return { downloads, noofslots, noofslots_total, start: options.start, limit: options.limit };
    },
    { isolationLevel: "Serializable" }
  );
}

export async function getQueue(options: DownloadRead = allDownloads): Promise<SabnzbdQueue> {
  const { downloads, ...page } = await readDownloads("queue", options);

  const slots: QueueItem[] = downloads.map((d) => {
    let statusText = "Queued";
    if (d.status === "downloading") statusText = "Downloading";
    else if (d.status === "converting") statusText = "Extracting";

    // Convert BigInt to Number for arithmetic operations
    const totalSizeNum = Number(d.totalSize);
    const downloadedBytesNum = Number(d.downloadedBytes);
    const speedNum = Number(d.speed);

    const totalMb = (totalSizeNum / 1024 / 1024).toFixed(1);
    const remainingBytes = totalSizeNum - downloadedBytesNum;
    const speedMbps = (speedNum / 1024 / 1024).toFixed(1);

    const timeleft =
      d.status === "downloading" && speedNum > 0
        ? formatSabnzbdTimeleft(Math.round(remainingBytes / speedNum))
        : "0:00:00";

    return {
      nzo_id: d.id,
      filename: d.title,
      status: statusText,
      percentage: d.progress.toString(),
      timeleft,
      cat: publicDownloadCategory(d.category),
      mb: totalMb,
      mbleft: (remainingBytes / 1024 / 1024).toFixed(1),
      speed: d.status === "downloading" ? `${speedMbps} MB/s` : "",
    };
  });

  return { slots, ...page };
}

export async function getHistory(options: DownloadRead = allDownloads): Promise<SabnzbdHistory> {
  const downloadBasePath = await getDownloadBasePath();
  const { downloads, ...page } = await readDownloads("history", options);

  const slots: HistoryItem[] = downloads.map((d) => {
    // SABnzbd returns the folder path, not the file path
    // Sonarr scans this folder for video files
    let storagePath = "";
    if (d.filePath) {
      storagePath = reportedStoragePath(
        d.filePath,
        downloadBasePath,
        process.env.DOWNLOAD_FOLDER_PATH_MAPPING
      );
    }

    return {
      nzo_id: d.id,
      name: d.title,
      status: d.status === "completed" ? "Completed" : "Failed",
      completed: d.completedAt ? Math.floor(d.completedAt.getTime() / 1000) : 0,
      category: publicDownloadCategory(d.category),
      storage: storagePath,
      bytes: Number(d.size),
      fail_message: d.error || "",
    };
  });

  return { slots, ...page };
}

export async function deleteHistoryItem(nzoId: string, delFiles: boolean): Promise<boolean> {
  assertWritesEnabled();
  const download = await prisma.download.findUnique({
    where: { id: nzoId },
  });

  if (!download || !["completed", "failed"].includes(download.status)) {
    return false;
  }

  // Map old remote paths only within the configured root. Unsafe paths leave
  // both the file and history entry intact instead of deleting a neighbor.
  if (delFiles && download.filePath) {
    const fs = await import("fs/promises");
    const localBasePath = await getDownloadBasePath();
    const localPath = localFilePathForRemoval(
      { ...download, filePath: download.filePath },
      localBasePath,
      process.env.DOWNLOAD_FOLDER_PATH_MAPPING
    );
    const mappedPath = process.env.DOWNLOAD_FOLDER_PATH_MAPPING
      ? path.join(
          process.env.DOWNLOAD_FOLDER_PATH_MAPPING,
          path.relative(path.resolve(localBasePath), localPath)
        )
      : localPath;
    const otherOwner = await prisma.download.findFirst({
      where: {
        id: { not: nzoId },
        filePath: { in: [...new Set([localPath, mappedPath, download.filePath])] },
      },
      select: { id: true },
    });
    if (otherOwner) {
      throw new UnsafeDownloadPathError("Download file is also referenced by another job");
    }
    if (await assertLocalFileSafeForRemoval(localPath, localBasePath)) {
      try {
        await fs.unlink(localPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }

  await prisma.download.delete({
    where: { id: nzoId },
  });

  return true;
}

export async function retryDownload(nzoId: string): Promise<{ id: string } | null> {
  assertWritesEnabled();
  const download = await prisma.download.findUnique({
    where: { id: nzoId },
  });

  if (!download || !["completed", "failed"].includes(download.status)) {
    return null;
  }
  const publicCategory = publicDownloadCategory(download.category);
  validateCategory(publicCategory);
  validateReleaseTitle(download.title);

  // Do not let a retry downgrade corrupt v1 data or inherit a prior probe result.
  readPersistedMediaExpectations(download.mediaExpectations);

  // A failed insertion must not discard the old history entry; a new ID owns
  // the retry so its temp and completed paths cannot collide with the old job.
  const newId = randomUUID();
  await prisma.$transaction(async (tx) => {
    await tx.download.create({
      data: {
        id: newId,
        title: download.title,
        url: download.url,
        category: publicCategory,
        status: "queued",
        progress: 0,
        mediaExpectations: download.mediaExpectations ?? null,
      },
    });
    await tx.download.delete({ where: { id: nzoId } });
  });
  triggerDownloadProcessing();
  return { id: newId };
}

export async function getConfigResponse(): Promise<object> {
  const { getSetting } = await import("@/lib/settings");
  const downloadPath =
    (await getSetting("download.path")) || process.env.DOWNLOAD_FOLDER_PATH || "/downloads";

  return {
    config: {
      misc: {
        complete_dir: downloadPath,
        enable_tv_sorting: false,
        enable_movie_sorting: false,
        pre_check: false,
        history_retention: "-1",
        history_retention_option: "all",
      },
      categories: [
        { name: "sonarr", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "tv", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "radarr", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "movies", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "sonarr_blackhole", pp: "", script: "Default", dir: "", priority: -100 },
        { name: "radarr_blackhole", pp: "", script: "Default", dir: "", priority: -100 },
      ],
      sorters: [],
    },
  };
}
