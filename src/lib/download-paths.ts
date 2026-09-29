import { createHash } from "node:crypto";
import path from "node:path";
import * as fs from "node:fs/promises";
import { getSetting } from "@/lib/settings";

export class InvalidDownloadInputError extends Error {}
export class UnsafeDownloadPathError extends Error {}

export async function getDownloadBasePath(): Promise<string> {
  return (
    (await getSetting("download.path")) ||
    process.env.DOWNLOAD_FOLDER_PATH ||
    path.join(process.cwd(), "downloads")
  );
}

/** Keep a release parseable as a filename without letting it select a directory. */
export function safeReleaseName(title: string): string {
  const normalized = title.normalize("NFC").replace(/[^\p{L}\p{N}._-]+/gu, ".");
  const characters = Array.from(normalized.replace(/^\.+|\.+$/g, ""));
  while (Buffer.byteLength(characters.join(""), "utf8") > 160) characters.pop();
  return characters.join("").replace(/\.+$/g, "") || "release";
}

export function validateReleaseTitle(title: string): void {
  if (
    !title.trim() ||
    title === "." ||
    title === ".." ||
    /[\\/\u0000-\u001f\u007f]/u.test(title) ||
    Buffer.byteLength(title, "utf8") > 512 ||
    (safeReleaseName(title) === "release" && title !== "release")
  ) {
    throw new InvalidDownloadInputError("Invalid release title");
  }
}

/** The persistent job ID, not the public category, owns both staging and output. */
export function jobDirectoryName(title: string, jobId: string): string {
  const safeId = /^[a-f\d-]{36}$/i.test(jobId)
    ? jobId.toLowerCase()
    : createHash("sha256").update(jobId).digest("hex");
  return `${safeReleaseName(title)}-${safeId}`;
}

export function validateCategory(category: string): void {
  if (
    !category ||
    category === "." ||
    category === ".." ||
    Buffer.byteLength(category, "utf8") > 240 ||
    !/^[\p{L}\p{N}._-]+$/u.test(category)
  ) {
    throw new InvalidDownloadInputError("Invalid download category");
  }
}

/** Recognize only the proxy's bounded legacy private-category shape. */
export function legacyPrivateCategory(
  category: string
): { publicCategory: string; directory: string } | null {
  const match = category.match(/^(sonarr|movies)\/([^/]+\.rfjob-[A-Za-z0-9]{1,12})$/);
  if (!match) return null;
  validateCategory(match[2]);
  return { publicCategory: match[1], directory: match[2] };
}

export function publicDownloadCategory(category: string): string {
  return legacyPrivateCategory(category)?.publicCategory ?? category;
}

export function categoryDirectory(basePath: string, category: string): string {
  validateCategory(category);
  return path.join(basePath, category);
}

export function safeFileExtension(urlPath: string): string {
  const extension = path.extname(urlPath) || ".mp4";
  if (!/^\.[a-z\d]{1,10}$/i.test(extension)) throw new Error("Invalid media extension");
  return extension;
}

function isInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

interface StoredDownloadFile {
  id: string;
  title: string;
  category: string;
  filePath: string;
}

/** Accept new job paths and bounded legacy flat paths, never an arbitrary DB path. */
export function localFilePathForRemoval(
  download: StoredDownloadFile,
  localBasePath: string,
  mappedBasePath: string | undefined
): string {
  const legacyPrivate = legacyPrivateCategory(download.category);
  const publicCategory = legacyPrivate?.publicCategory ?? download.category;
  validateCategory(publicCategory);
  const localRoot = path.resolve(localBasePath);
  const stored = path.resolve(download.filePath);
  const mappedRoot = mappedBasePath ? path.resolve(mappedBasePath) : null;
  const candidate = isInside(localRoot, stored)
    ? stored
    : mappedRoot && isInside(mappedRoot, stored)
      ? path.join(localRoot, path.relative(mappedRoot, stored))
      : null;
  if (!candidate) throw new UnsafeDownloadPathError("Download file is outside the configured root");

  const relative = path.relative(localRoot, candidate);
  const parts = relative.split(path.sep);
  const extension = path.extname(candidate);
  const newJob =
    parts.length === 3 &&
    parts[0] === publicCategory &&
    parts[1] === jobDirectoryName(download.title, download.id) &&
    parts[2] === `${safeReleaseName(download.title)}${extension}`;
  const legacyFlat =
    parts.length === 2 &&
    parts[0] === publicCategory &&
    parts[1] === `${download.title}${extension}`;
  const legacyPrivatePath =
    legacyPrivate !== null &&
    parts.length === 3 &&
    parts[0] === publicCategory &&
    parts[1] === legacyPrivate.directory &&
    parts[2] === `${download.title}${extension}`;
  if ((!newJob && !legacyFlat && !legacyPrivatePath) || !/^\.[a-z\d]{1,10}$/i.test(extension)) {
    throw new UnsafeDownloadPathError("Download file does not belong to this job");
  }
  return candidate;
}

/** Realpath/lstat checks prevent existing symlinks from redirecting a deletion. */
export async function assertLocalFileSafeForRemoval(
  filePath: string,
  localBasePath: string
): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new UnsafeDownloadPathError("Download file is not a regular file");
  }
  const rootReal = await fs.realpath(localBasePath);
  let current = path.dirname(filePath);
  while (
    isInside(path.resolve(localBasePath), current) &&
    current !== path.resolve(localBasePath)
  ) {
    const directory = await fs.lstat(current);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new UnsafeDownloadPathError("Download directory is not safe");
    }
    current = path.dirname(current);
  }
  const parentReal = await fs.realpath(path.dirname(filePath));
  if (!isInside(rootReal, parentReal)) {
    throw new UnsafeDownloadPathError("Download directory escapes the configured root");
  }
  return true;
}

/** Reject preexisting symlinks before writing beneath a job-owned directory. */
export async function ensureOwnedDirectory(root: string, directory: string): Promise<void> {
  await fs.mkdir(root, { recursive: true });
  const rootReal = await fs.realpath(root);
  await fs.mkdir(directory, { recursive: true });
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Unsafe download directory");
  }
  const directoryReal = await fs.realpath(directory);
  if (!isInside(rootReal, directoryReal)) {
    throw new Error("Unsafe download directory");
  }
}

/** External download/conversion tools must not follow a preexisting output symlink. */
export async function assertNewOutputPath(filePath: string): Promise<void> {
  try {
    await fs.lstat(filePath);
    throw new UnsafeDownloadPathError("Download output already exists");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Map only the reported SAB storage; the database keeps a usable local file path. */
export function reportedStoragePath(
  filePath: string,
  localBasePath: string,
  mappedBasePath: string | undefined
): string {
  if (!mappedBasePath) return path.dirname(filePath);
  const relative = path.relative(path.resolve(localBasePath), path.resolve(filePath));
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    // Legacy rows may already contain a remote mapping rather than a local path.
    return path.dirname(filePath);
  }
  return path.dirname(path.join(mappedBasePath, relative));
}
