import { afterEach, expect, it } from "vitest";
import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { prepareDownloadDirectories, checkDownloadDirectories } from "./download-directories.mjs";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true });
});

it("preserves existing directory/media/neighbor metadata over prepare/check/restart", async () => {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "pingufunk-owned-volume-")));
  roots.push(root);
  const base = path.join(root, "downloads");
  const temporary = path.join(base, "incomplete");
  const neighbor = path.join(root, "neighbor");
  await prepareDownloadDirectories(base, temporary, process.getuid!(), process.getgid!());
  const sentinel = path.join(base, "existing-media.mkv");
  await writeFile(sentinel, "synthetic sentinel", { mode: 0o640 });
  await writeFile(neighbor, "untouched neighbor", { mode: 0o600 });
  await chmod(base, 0o750);
  const paths = [base, temporary, sentinel, neighbor];
  const fingerprint = async () =>
    Promise.all(
      paths.map(async (file) => {
        const stat = await lstat(file);
        return { uid: stat.uid, gid: stat.gid, mode: stat.mode };
      })
    );
  const before = await fingerprint();
  for (let cycle = 0; cycle < 2; cycle++) {
    await prepareDownloadDirectories(base, temporary, process.getuid!(), process.getgid!());
    await checkDownloadDirectories(base, temporary);
    expect(await fingerprint()).toEqual(before);
    expect(await readFile(sentinel, "utf8")).toBe("synthetic sentinel");
    expect(await readFile(neighbor, "utf8")).toBe("untouched neighbor");
    expect(await readdir(temporary)).toEqual([]);
  }
});

it("refuses symlink or file selectors and the filesystem root without changing the target", async () => {
  const root = await realpath(
    await mkdtemp(path.join(os.tmpdir(), "pingufunk-owned-unsafe-volume-"))
  );
  roots.push(root);
  const target = path.join(root, "target");
  await writeFile(target, "synthetic target", { mode: 0o600 });
  const link = path.join(root, "link");
  await symlink(root, link);
  for (const base of [target, path.join(link, "nested"), path.parse(root).root]) {
    await expect(
      prepareDownloadDirectories(
        base,
        path.join(base, "incomplete"),
        process.getuid!(),
        process.getgid!()
      )
    ).rejects.toThrow();
    await expect(checkDownloadDirectories(base, path.join(base, "incomplete"))).rejects.toThrow();
  }
  expect(await readFile(target, "utf8")).toBe("synthetic target");
  expect(await readdir(root)).toEqual(["link", "target"]);
});
