import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { prepareRunManifest } from "./postgresql-run-manifest.mjs";

it("keeps a private pending identity and atomically marks only the same run validated", () => {
  const dir = mkdtempSync(join(tmpdir(), "pingufunk-run-manifest-"));
  try {
    const snapshot = join(dir, "source.sqlite");
    writeFileSync(snapshot, "synthetic", { mode: 0o600 });
    const identity = { sourceHash: "synthetic-hash", target: "synthetic-target", importer: "v1" };
    const first = prepareRunManifest(snapshot, identity);
    expect(first.status).toBe("pending");
    expect(prepareRunManifest(snapshot, identity).runId).toBe(first.runId);
    expect(() => prepareRunManifest(snapshot, { ...identity, target: "foreign" })).toThrow(
      "does not match"
    );
    first.markValidated();
    expect(first.status).toBe("validated");
    expect(prepareRunManifest(snapshot, identity).status).toBe("validated");
    expect(
      JSON.stringify(JSON.parse(readFileSync(join(dir, "import-manifest.json"), "utf8")))
    ).not.toContain("secret");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
