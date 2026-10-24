import { access, lstat, mkdir, open, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolveDatabaseConfig } from "./database-config.mjs";

function ownedPaths(base, temporary) {
  const paths = [...new Set([base, temporary].map((value) => path.resolve(value)))];
  if (
    paths.some((value) => value === path.parse(value).root || /[\u0000-\u001f\u007f]/.test(value))
  )
    throw new Error("Unsafe download directory");
  return paths;
}

/** Change only directories created by this invocation, never existing volume contents. */
export async function prepareDownloadDirectories(base, temporary, uid, gid) {
  for (const directory of ownedPaths(base, temporary)) {
    const root = path.parse(directory).root;
    let current = root;
    for (const part of directory.slice(root.length).split(path.sep)) {
      current = path.join(current, part);
      let created = false;
      try {
        await mkdir(current, { mode: 0o755 });
        created = true;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Unsafe download directory");
      if (created) {
        const handle = await open(
          current,
          constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW
        );
        try {
          const opened = await handle.stat();
          if (!opened.isDirectory() || opened.dev !== stat.dev || opened.ino !== stat.ino)
            throw new Error("Download directory changed during initialization");
          await handle.chown(uid, gid);
        } finally {
          await handle.close();
        }
      }
    }
  }
}

/** Run under the actual execution user; a readonly mount must fail before queue startup. */
export async function checkDownloadDirectories(base, temporary) {
  for (const directory of ownedPaths(base, temporary)) {
    const root = path.parse(directory).root;
    let current = root;
    for (const part of directory.slice(root.length).split(path.sep)) {
      current = path.join(current, part);
      const stat = await lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error("Unsafe download directory");
    }
    await access(directory, constants.R_OK | constants.W_OK | constants.X_OK);
    const marker = path.join(directory, `.pingufunk-write-check-${randomUUID()}`);
    const handle = await open(marker, "wx", 0o600);
    try {
      await handle.close();
    } finally {
      await unlink(marker);
    }
  }
}

async function configuredPaths() {
  const config = resolveDatabaseConfig();
  const { PrismaClient } =
    config.provider === "sqlite"
      ? await import("../generated/sqlite/index.js")
      : await import("@prisma/client");
  const db = new PrismaClient({ log: [], datasourceUrl: config.url });
  try {
    const row = await db.config.findUnique({ where: { key: "download.path" } });
    const base =
      row?.value || process.env.DOWNLOAD_FOLDER_PATH || path.join(process.cwd(), "downloads");
    return [base, process.env.DOWNLOAD_TEMP_PATH || path.join(base, "incomplete")];
  } finally {
    await db.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  // A stuck database read must not leave the startup supervisor waiting forever.
  const deadline = setTimeout(() => {
    console.error("Download directory check timed out");
    process.exit(1);
  }, 10_000);
  try {
    const [mode, uid, gid, ...extra] = process.argv.slice(2);
    if (process.env.PINGUFUNK_WRITES_ENABLED !== "1" || extra.length)
      throw new Error("Invalid directory initialization request");
    const [base, temporary] = await configuredPaths();
    if (
      mode === "prepare" &&
      /^\d{1,10}$/.test(uid ?? "") &&
      /^\d{1,10}$/.test(gid ?? "") &&
      Number(uid) <= 2147483647 &&
      Number(gid) <= 2147483647
    ) {
      await prepareDownloadDirectories(base, temporary, Number(uid), Number(gid));
    } else if (mode === "check" && uid === undefined && gid === undefined) {
      await checkDownloadDirectories(base, temporary);
    } else throw new Error("Invalid directory initialization request");
    console.log("Download directories checked");
  } catch {
    console.error(
      "Download directories unavailable or unsafe; check the configured owner and mount permissions"
    );
    process.exitCode = 1;
  } finally {
    clearTimeout(deadline);
  }
}
