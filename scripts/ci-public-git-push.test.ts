import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const script = resolve("scripts/ci-public-git-push.sh");
let root: string;
let work: string;
let remote: string;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

function publish(commit: string) {
  return spawnSync("bash", [script, remote, commit], { cwd: work, encoding: "utf8" });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pingufunk-export-test-"));
  work = join(root, "work");
  remote = join(root, "public.git");
  git(root, "init", "--bare", "--initial-branch=main", remote);
  git(root, "init", "--initial-branch=main", work);
  git(work, "config", "user.name", "Synthetic test");
  git(work, "config", "user.email", "synthetic@example.invalid");
  git(work, "config", "commit.gpgsign", "false");
  git(work, "config", "core.hooksPath", "/dev/null");
  git(work, "commit", "--allow-empty", "-m", "initial");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("public Git export", () => {
  it("advances an existing public main with the exact tested commit", () => {
    git(work, "push", remote, "HEAD:refs/heads/main");
    git(work, "commit", "--allow-empty", "-m", "tested");
    const tested = git(work, "rev-parse", "HEAD");
    expect(publish(tested).status).toBe(0);
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(tested);
    expect(publish(tested).status).toBe(0);
  });

  it("refuses a divergent or absent public main without replacing it", () => {
    const original = git(work, "rev-parse", "HEAD");
    expect(publish(original).status).not.toBe(0);
    git(work, "push", remote, "HEAD:refs/heads/main");
    git(work, "switch", "--orphan", "unrelated");
    git(work, "commit", "--allow-empty", "-m", "unrelated");
    expect(publish(git(work, "rev-parse", "HEAD")).status).not.toBe(0);
    expect(git(remote, "rev-parse", "refs/heads/main")).toBe(original);
  });

  it("rejects abbreviated commit IDs", () => {
    git(work, "push", remote, "HEAD:refs/heads/main");
    expect(publish(git(work, "rev-parse", "--short", "HEAD")).status).not.toBe(0);
  });
});
