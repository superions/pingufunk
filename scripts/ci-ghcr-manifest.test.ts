import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const image = `sha256:${"a".repeat(64)}`;
const digest = `sha256:${"c".repeat(64)}`;
const tag = `sha-${"b".repeat(40)}`;
const script = resolve("scripts/ci-ghcr-manifest.mjs");
let root: string;
let mock: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "pingufunk-ghcr-test-"));
  mock = join(root, "mock.mjs");
  writeFileSync(
    mock,
    `globalThis.fetch = async (url) => {
      if (String(url).includes('/token')) return Response.json({token: 'synthetic-access'});
      if (process.env.GHCR_TEST_MODE === 'missing') return new Response('', {status: 404});
      const id = 'sha256:' + (process.env.GHCR_TEST_MODE === 'mismatch' ? 'd' : 'a').repeat(64);
      return Response.json({config: {digest: id}}, {headers: {'docker-content-digest': 'sha256:' + 'c'.repeat(64)}});
    };`
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function inspect(mode: string, requestedTag = tag) {
  return spawnSync(
    process.execPath,
    ["--import", pathToFileURL(mock).href, script, requestedTag, image],
    {
      encoding: "utf8",
      env: { ...process.env, PUBLIC_GHCR_TOKEN: "synthetic-secret", GHCR_TEST_MODE: mode },
    }
  );
}

describe("GHCR image identity", () => {
  it("reports the registry digest only when the image configuration matches", () => {
    const result = inspect("match");
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe(digest);
    expect(result.stdout + result.stderr).not.toContain("synthetic-secret");
  });

  it("distinguishes a missing tag from an occupied tag with different image bytes", () => {
    expect(inspect("missing").status).toBe(3);
    const mismatch = inspect("mismatch");
    expect(mismatch.status).not.toBe(0);
    expect(mismatch.stderr).toContain("differs from the tested image");
    expect(mismatch.stderr).not.toContain("synthetic-secret");
  });

  it("rejects tags outside the publication contract before contacting a registry", () => {
    expect(inspect("match", "latest").status).not.toBe(0);
  });
});
