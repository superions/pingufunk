import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { jobDirectoryName, UnsafeDownloadPathError } from "@/lib/download-paths";

const {
  configFindUnique,
  downloadFindUnique,
  downloadFindFirst,
  downloadDelete,
  downloadCreate,
  transaction,
  start,
} = vi.hoisted(() => ({
  configFindUnique: vi.fn(),
  downloadFindUnique: vi.fn(),
  downloadFindFirst: vi.fn(),
  downloadDelete: vi.fn(),
  downloadCreate: vi.fn(),
  transaction: vi.fn(),
  start: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    config: { findUnique: configFindUnique },
    download: {
      findUnique: downloadFindUnique,
      findFirst: downloadFindFirst,
      delete: downloadDelete,
      create: downloadCreate,
    },
    $transaction: transaction,
  },
}));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: start }));

import { clearSettingsCache } from "@/lib/settings";
import { addToQueue, deleteHistoryItem, retryDownload } from "./download";

let root: string;
let outside: string;
const id = "11111111-1111-4111-8111-111111111111";
const title = "Show.S01E02.720p";
const category = "sonarr";

beforeEach(async () => {
  vi.clearAllMocks();
  clearSettingsCache();
  root = await mkdtemp(path.join(tmpdir(), "pingufunk-actions-"));
  outside = await mkdtemp(path.join(tmpdir(), "pingufunk-neighbor-"));
  configFindUnique.mockResolvedValue({ value: root });
  downloadFindFirst.mockResolvedValue(null);
  transaction.mockImplementation(async (callback) =>
    callback({ download: { create: downloadCreate, delete: downloadDelete } })
  );
  start.mockResolvedValue(undefined);
  vi.stubEnv("DOWNLOAD_FOLDER_PATH_MAPPING", "/mapped/downloads");
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

it("rejects unsafe public inputs before creating a queue row", async () => {
  await expect(
    addToQueue("https://example.org/video.mp4", "../escape", "sonarr")
  ).rejects.toThrow();
  await expect(addToQueue("https://example.org/video.mp4", title, "../sonarr")).rejects.toThrow();
  expect(downloadCreate).not.toHaveBeenCalled();
});

it("removes only its completed job file, not a neighboring release", async () => {
  const ownDir = path.join(root, category, jobDirectoryName(title, id));
  const neighborDir = path.join(root, category, jobDirectoryName(title, "other-job"));
  await mkdir(ownDir, { recursive: true });
  await mkdir(neighborDir);
  const ownFile = path.join(ownDir, `${title}.mkv`);
  const neighborFile = path.join(neighborDir, `${title}.mkv`);
  await writeFile(ownFile, "own");
  await writeFile(neighborFile, "neighbor");
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "completed",
    filePath: ownFile,
  });

  expect(await deleteHistoryItem(id, true)).toBe(true);

  await expect(access(ownFile)).rejects.toThrow();
  await expect(readFile(neighborFile, "utf8")).resolves.toBe("neighbor");
  expect(downloadDelete).toHaveBeenCalledWith({ where: { id } });
});

it("refuses to delete a legacy file referenced by another job", async () => {
  const local = path.join(root, category, `${title}.mkv`);
  await mkdir(path.dirname(local), { recursive: true });
  await writeFile(local, "shared");
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "completed",
    filePath: `/mapped/downloads/${category}/${title}.mkv`,
  });
  downloadFindFirst.mockResolvedValue({ id: "another-job" });

  await expect(deleteHistoryItem(id, true)).rejects.toBeInstanceOf(UnsafeDownloadPathError);
  await expect(readFile(local, "utf8")).resolves.toBe("shared");
  expect(downloadDelete).not.toHaveBeenCalled();
});

it("keeps the history row and outside file when a job folder is a symlink", async () => {
  const categoryDir = path.join(root, category);
  await mkdir(categoryDir);
  await writeFile(path.join(outside, `${title}.mkv`), "outside");
  const linkedDir = path.join(categoryDir, jobDirectoryName(title, id));
  await symlink(outside, linkedDir);
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "completed",
    filePath: path.join(linkedDir, `${title}.mkv`),
  });

  await expect(deleteHistoryItem(id, true)).rejects.toBeInstanceOf(UnsafeDownloadPathError);
  await expect(readFile(path.join(outside, `${title}.mkv`), "utf8")).resolves.toBe("outside");
  expect(downloadDelete).not.toHaveBeenCalled();
});

it("translates a legacy mapped flat file but never deletes outside the local root", async () => {
  await mkdir(path.join(root, category));
  const local = path.join(root, category, `${title}.mkv`);
  await writeFile(local, "legacy");
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "completed",
    filePath: `/mapped/downloads/${category}/${title}.mkv`,
  });

  expect(await deleteHistoryItem(id, true)).toBe(true);
  await expect(access(local)).rejects.toThrow();
});

it("removes only a legacy proxy-private file and preserves its public category on retry", async () => {
  const privateDirectory = `${title}.rfjob-2589d87beba2`;
  const privateCategory = `${category}/${privateDirectory}`;
  const localDir = path.join(root, category, privateDirectory);
  await mkdir(localDir, { recursive: true });
  await writeFile(path.join(localDir, `${title}.mkv`), "legacy");
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category: privateCategory,
    status: "completed",
    url: "https://example.org/video.mp4",
    filePath: `/mapped/downloads/${privateCategory}/${title}.mkv`,
  });

  expect(await deleteHistoryItem(id, true)).toBe(true);
  await expect(access(path.join(localDir, `${title}.mkv`))).rejects.toThrow();

  downloadCreate.mockResolvedValue({});
  downloadDelete.mockResolvedValue({});
  await retryDownload(id);
  expect(downloadCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({ category: "sonarr" }),
  });
});

it("does not discard the old row when a retry cannot create a new job", async () => {
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "failed",
    url: "https://example.org/video.mp4",
  });
  downloadCreate.mockRejectedValue(new Error("database unavailable"));

  await expect(retryDownload(id)).rejects.toThrow("database unavailable");
  expect(downloadDelete).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("blocks a direct delete or retry before touching files or rows in maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  await expect(deleteHistoryItem(id, true)).rejects.toThrow("writes are disabled");
  await expect(retryDownload(id)).rejects.toThrow("writes are disabled");
  await expect(addToQueue("https://example.org/video.mp4", title, category)).rejects.toThrow(
    "writes are disabled"
  );
  expect(downloadFindUnique).not.toHaveBeenCalled();
  expect(downloadCreate).not.toHaveBeenCalled();
  expect(downloadDelete).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
});

it("retries with a new job ID while retaining title, URL and public category", async () => {
  downloadFindUnique.mockResolvedValue({
    id,
    title,
    category,
    status: "failed",
    url: "https://example.org/video.mp4",
  });
  downloadCreate.mockResolvedValue({});
  downloadDelete.mockResolvedValue({});

  const result = await retryDownload(id);

  expect(result?.id).toBeTruthy();
  expect(result?.id).not.toBe(id);
  expect(downloadCreate).toHaveBeenCalledWith({
    data: expect.objectContaining({
      id: result?.id,
      title,
      category,
      url: "https://example.org/video.mp4",
      status: "queued",
    }),
  });
  expect(downloadDelete).toHaveBeenCalledWith({ where: { id } });
  await vi.waitFor(() => expect(start).toHaveBeenCalled());
});
