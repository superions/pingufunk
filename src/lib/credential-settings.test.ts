import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { credentialOverride, CredentialConfigurationError } from "./credential-settings";

afterEach(() => vi.unstubAllEnvs());

it("reads a mounted secret file and never exposes its path in errors", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pingufunk-secret-test-"));
  const file = path.join(root, "tvdb-key");
  try {
    await writeFile(file, "synthetic-key\n");
    vi.stubEnv("PINGUFUNK_TVDB_KEY_FILE", file);
    expect(await credentialOverride("api.tvdb.key")).toEqual({
      configured: true,
      value: "synthetic-key",
    });
    await writeFile(file, "rotated-key\n");
    expect(await credentialOverride("api.tvdb.key")).toEqual({
      configured: true,
      value: "rotated-key",
    });
    await rm(file);
    await expect(credentialOverride("api.tvdb.key")).rejects.toThrow(
      "Credential configuration is invalid"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("fails closed for contradictory, empty and relative secret sources", async () => {
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN", "synthetic-token");
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN_FILE", "/nonexistent/secret");
  await expect(credentialOverride("api.tmdb.key")).rejects.toBeInstanceOf(
    CredentialConfigurationError
  );
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN_FILE", undefined);
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN", " ");
  await expect(credentialOverride("api.tmdb.key")).rejects.toBeInstanceOf(
    CredentialConfigurationError
  );
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN", undefined);
  vi.stubEnv("PINGUFUNK_TMDB_READ_TOKEN_FILE", "relative/path");
  await expect(credentialOverride("api.tmdb.key")).rejects.toBeInstanceOf(
    CredentialConfigurationError
  );
});

it("rejects a symlinked secret file and never echoes its path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pingufunk-secret-test-"));
  const target = path.join(root, "target");
  const link = path.join(root, "link");
  try {
    await writeFile(target, "synthetic-secret");
    await symlink(target, link);
    vi.stubEnv("PINGUFUNK_SRGSSR_CONSUMER_SECRET_FILE", link);
    await expect(credentialOverride("api.srgssr.consumerSecret")).rejects.toThrow(
      "Credential configuration is invalid"
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
