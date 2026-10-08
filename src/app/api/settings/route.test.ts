import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";
import {
  DEFAULT_LANGUAGE_POLICY,
  LANGUAGE_POLICY_SETTING_KEY,
  serializeLanguagePolicy,
} from "@/lib/language-policy";
import { clearSettingsCache } from "@/lib/settings";
import { mediathekCache } from "@/lib/cache";
import { CredentialConfigurationError } from "@/lib/credential-settings";
import { getSetting } from "@/lib/settings";

const { values, upsert, transaction, deleteSetting, clearSrfTokenCache } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  upsert: vi.fn(),
  transaction: vi.fn(),
  deleteSetting: vi.fn(),
  clearSrfTokenCache: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: transaction,
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        values.has(where.key) ? { value: values.get(where.key) } : null
      ),
      findMany: vi.fn(async () => [...values].map(([key, value]) => ({ key, value }))),
      upsert,
      delete: deleteSetting,
    },
  },
}));
vi.mock("@/lib/settings", () => ({
  clearSettingsCache: vi.fn(),
  getSetting: vi.fn(async (key: string) => values.get(key) ?? null),
}));
vi.mock("@/lib/cache", () => ({
  clearTTLCache: vi.fn(),
  clearMetadataCaches: vi.fn(),
  mediathekCache: { clear: vi.fn() },
  rulesetsCache: { clear: vi.fn() },
}));
vi.mock("@/services/tvdb", () => ({ clearTvdbTokenCache: vi.fn() }));
vi.mock("@/services/srgssr-api", () => ({ clearTokenCache: clearSrfTokenCache }));

beforeEach(() => {
  vi.clearAllMocks();
  values.clear();
  deleteSetting.mockReset();
  deleteSetting.mockImplementation(async ({ where }: { where: { key: string } }) =>
    values.delete(where.key)
  );
  values.set("api.srgssr.consumerKey", "private-key");
  values.set("api.srgssr.consumerSecret", "private-secret");
  values.set("api.tmdb.key", "legacy-v3-key");
  values.set("download.proxyUrl", "http://user:private-password@proxy.invalid");
  values.set("tvdb_token", "legacy-private-token");
  upsert.mockImplementation(
    async ({ where, update }: { where: { key: string }; update: { value: string } }) => {
      values.set(where.key, update.value);
      return { key: where.key, value: update.value };
    }
  );
  transaction.mockImplementation(
    async (run: (tx: { config: { upsert: typeof upsert } }) => Promise<unknown>) => {
      const before = new Map(values);
      try {
        return await run({ config: { upsert } });
      } catch (error) {
        values.clear();
        for (const [key, value] of before) values.set(key, value);
        throw error;
      }
    }
  );
});
afterEach(() => vi.unstubAllEnvs());

it("does not acknowledge an unsuccessful reset as success or expose DB errors", async () => {
  deleteSetting.mockRejectedValue(new Error("synthetic private database detail"));
  const response = await DELETE(new NextRequest("http://localhost/api/settings?key=download.path"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Failed to reset setting" });
  expect(clearSettingsCache).not.toHaveBeenCalled();
});

it("keeps reset idempotent when the requested key is already absent", async () => {
  deleteSetting.mockRejectedValue(Object.assign(new Error("missing"), { code: "P2025" }));
  const response = await DELETE(new NextRequest("http://localhost/api/settings?key=download.path"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ success: true, key: "download.path" });
  expect(clearSettingsCache).toHaveBeenCalled();
});

it("keeps Settings readable but rejects every settings write in maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  expect((await GET(new NextRequest("http://localhost/api/settings"))).status).toBe(200);
  expect((await post({ "download.path": "/synthetic" })).status).toBe(503);
  expect(
    (await DELETE(new NextRequest("http://localhost/api/settings?key=download.path"))).status
  ).toBe(503);
  expect(upsert).not.toHaveBeenCalled();
  expect(values.has("download.path")).toBe(false);
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) })
  );
}

it("masks both SRF credentials in bulk and single-setting responses", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(JSON.stringify(all)).not.toContain("private-");
  expect(JSON.stringify(all)).not.toContain("proxy.invalid");
  expect(JSON.stringify(all)).not.toContain("legacy-private-token");
  expect(all["api.tmdb.key"]).toBe("");
  expect(all["api.srgssr.consumerSecret"]).toBeTruthy();
  const single = await (
    await GET(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey"))
  ).json();
  expect(single.value).toBe(all["api.srgssr.consumerKey"]);
  expect((await GET(new NextRequest("http://localhost/api/settings?key=tvdb_token"))).status).toBe(
    404
  );
});

it("keeps internal worker ownership opaque and unmodifiable through settings", async () => {
  values.set("internal.workerLease.v1", "private-worker-owner-fence");
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(JSON.stringify(all)).not.toContain("private-worker-owner-fence");
  expect(all["internal.workerLease.v1"]).toBeUndefined();
  expect(
    (await GET(new NextRequest("http://localhost/api/settings?key=internal.workerLease.v1"))).status
  ).toBe(404);
  expect((await post({ "internal.workerLease.v1": "override" })).status).toBe(404);
  expect(
    (await DELETE(new NextRequest("http://localhost/api/settings?key=internal.workerLease.v1")))
      .status
  ).toBe(400);
  expect(values.get("internal.workerLease.v1")).toBe("private-worker-owner-fence");
});

it("shows a usable TMDB read token only as presence", async () => {
  values.set("api.tmdb.key", "eyJ.synthetic.read.token");
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(all["api.tmdb.key"]).toBeTruthy();
  expect(JSON.stringify(all)).not.toContain("eyJ.synthetic.read.token");
});

it("reports invalid Arr credential configuration without disclosing source details or blocking nonsecret settings", async () => {
  vi.mocked(getSetting).mockImplementation(async (key) => {
    if (key === "api.radarr.key") throw new CredentialConfigurationError();
    return values.get(key) ?? null;
  });
  const response = await GET(new NextRequest("http://localhost/api/settings"));
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Pingufunk-Arr-Credentials")).toBe("sonarr=missing,radarr=invalid");
  expect((await response.json())["api.radarr.key"]).toBe("");
  expect((await post({ "matching.movie.yearTolerance": "2" })).status).toBe(200);
  vi.mocked(getSetting).mockImplementation(async (key) => values.get(key) ?? null);
});

it("redacts a corrupt credential-bearing legacy Arr URL while retaining it for explicit server repair", async () => {
  const value = "http://user:private-url-secret@example.invalid/radarr?apikey=private-query";
  values.set("integration.radarr.url", value);
  for (const query of ["", "?key=integration.radarr.url"]) {
    const response = await GET(new NextRequest(`http://localhost/api/settings${query}`));
    expect(response.headers.get("X-Pingufunk-Invalid-Settings")).toBe("integration.radarr.url");
    const body = await response.json();
    expect(query ? body.value : body["integration.radarr.url"]).toBe("");
    expect(JSON.stringify(body)).not.toContain("private-url-secret");
    expect(JSON.stringify(body)).not.toContain("private-query");
  }
  expect(values.get("integration.radarr.url")).toBe(value);
  expect(upsert).not.toHaveBeenCalled();
});

it("requires controlled readback after a lost commit acknowledgement, even when the write committed", async () => {
  transaction.mockImplementationOnce(async (run) => {
    await run({ config: { upsert } });
    throw new Error("synthetic lost acknowledgement");
  });
  const response = await post({ "matching.movie.yearTolerance": "02" });
  expect(response.status).toBe(500);
  expect(await response.json()).toMatchObject({ committed: "unknown" });
  expect(clearSettingsCache).toHaveBeenCalled();
  const readback = await GET(
    new NextRequest("http://localhost/api/settings?key=matching.movie.yearTolerance")
  );
  expect(await readback.json()).toEqual({ key: "matching.movie.yearTolerance", value: "2" });
  expect(upsert).toHaveBeenCalledTimes(1);
});

it("defaults Sonarr off and accepts validated nonsecret controls with reload/readback", async () => {
  const initial = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(initial["integration.sonarr.enabled"]).toBe("false");
  expect(initial["integration.sonarr.windowDays"]).toBe("14");
  expect(
    (
      await post({
        "integration.sonarr.enabled": "true",
        "integration.sonarr.url": "https://example.invalid/sonarr",
        "integration.sonarr.windowDays": "30",
        "matching.sonarr.tolerancePercent": "0",
      })
    ).status
  ).toBe(200);
  const reloaded = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(reloaded).toMatchObject({
    "integration.sonarr.enabled": "true",
    "integration.sonarr.windowDays": "30",
    "matching.sonarr.tolerancePercent": "0",
  });
});

it("defaults the Radarr library limit to 10 MiB and persists configurable limits with cache invalidation", async () => {
  const key = "integration.radarr.inventoryMaxMiB";
  const initial = await (
    await GET(new NextRequest(`http://localhost/api/settings?key=${key}`))
  ).json();
  expect(initial.value).toBe("10");
  expect((await post({ [key]: "12" })).status).toBe(200);
  expect(values.get(key)).toBe("12");
  const reloaded = await (
    await GET(new NextRequest(`http://localhost/api/settings?key=${key}`))
  ).json();
  expect(reloaded.value).toBe("12");
  expect(clearSettingsCache).toHaveBeenCalled();
  expect(mediathekCache.clear).toHaveBeenCalled();
});

it.each([
  ["integration.sonarr.enabled", "yes"],
  ["integration.sonarr.url", "https://user:private@example.invalid/sonarr"],
  ["integration.sonarr.url", "https://example.invalid/sonarr?apikey=private"],
  ["integration.sonarr.url", "file:///private/sonarr"],
  ["integration.sonarr.windowDays", "0"],
  ["integration.sonarr.windowDays", "91"],
  ["integration.sonarr.windowDays", "1.5"],
  ["matching.sonarr.tolerancePercent", "26"],
  ["matching.sonarr.tolerancePercent", "NaN"],
  ["integration.radarr.inventoryMaxMiB", "0"],
  ["integration.radarr.inventoryMaxMiB", "65"],
  ["integration.radarr.inventoryMaxMiB", "10.5"],
  ["matching.minDuration", "-1"],
  ["download.path", "https://example.invalid/media"],
  ["download.path", "folder\u0000other"],
  ["download.path", 123],
])("rejects malformed %s before any bulk write", async (key, value) => {
  expect((await post({ "matching.strategy": "strict", [key]: value })).status).toBe(400);
  expect(upsert).not.toHaveBeenCalled();
});

it.each(["sonarr", "radarr"])(
  "masks %s keys and refuses browser credential writes",
  async (app) => {
    const key = "api." + app + ".key";
    values.set(key, "private-arr-key");
    const response = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
    expect(response[key]).toBe("••••••••");
    expect(JSON.stringify(response)).not.toContain("private-arr-key");
    expect((await post({ [key]: "new-key" })).status).toBe(400);
    expect(upsert).not.toHaveBeenCalled();
  }
);

it("preserves stored credentials when a client saves masked settings again", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect((await post(all)).status).toBe(200);
  await post({ key: "api.srgssr.consumerSecret", value: all["api.srgssr.consumerSecret"] });
  expect(values.get("api.srgssr.consumerKey")).toBe("private-key");
  expect(values.get("api.srgssr.consumerSecret")).toBe("private-secret");
});

it("rejects browser credential writes without changing legacy stored credentials", async () => {
  expect((await post({ "api.srgssr.consumerSecret": "new-secret" })).status).toBe(400);
  expect((await post({ key: "api.srgssr.consumerSecret", value: "" })).status).toBe(400);
  expect((await post({ "matching.strategy": "strict", "api.tvdb.key": "new-key" })).status).toBe(
    400
  );
  expect(
    (await DELETE(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey")))
      .status
  ).toBe(400);
  expect(values.get("api.srgssr.consumerSecret")).toBe("private-secret");
  expect(values.has("matching.strategy")).toBe(false);
  expect(upsert).not.toHaveBeenCalled();
  expect(clearSrfTokenCache).not.toHaveBeenCalled();
});

it("returns the conservative versioned language policy for missing settings", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  const single = await (
    await GET(new NextRequest(`http://localhost/api/settings?key=${LANGUAGE_POLICY_SETTING_KEY}`))
  ).json();

  expect(all[LANGUAGE_POLICY_SETTING_KEY]).toBe(serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY));
  expect(single.value).toBe(serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY));
});

it("persists and reads back validated language preferences", async () => {
  const policy = { ...DEFAULT_LANGUAGE_POLICY, includeOriginalAudio: true };
  const response = await post({ [LANGUAGE_POLICY_SETTING_KEY]: JSON.stringify(policy) });
  const settings = await (await GET(new NextRequest("http://localhost/api/settings"))).json();

  expect(response.status).toBe(200);
  expect(settings[LANGUAGE_POLICY_SETTING_KEY]).toBe(serializeLanguagePolicy(policy));
  expect(clearSettingsCache).toHaveBeenCalled();
  expect(mediathekCache.clear).toHaveBeenCalled();
});

it("rejects unsafe language-policy updates atomically", async () => {
  const invalidPolicy = JSON.stringify({
    ...DEFAULT_LANGUAGE_POLICY,
    version: 2,
    labelUnknownAudioAsGerman: true,
  });
  const response = await post({
    "matching.strategy": "strict",
    [LANGUAGE_POLICY_SETTING_KEY]: invalidPolicy,
  });

  expect(response.status).toBe(400);
  expect(upsert).not.toHaveBeenCalled();
  expect(values.has("matching.strategy")).toBe(false);
});

it("exposes corrupt stored policy for repair without overwriting or silently defaulting", async () => {
  values.set(LANGUAGE_POLICY_SETTING_KEY, '{"version":2,"includeOriginalAudio":true}');
  const response = await GET(new NextRequest("http://localhost/api/settings"));
  const settings = await response.json();
  expect(settings[LANGUAGE_POLICY_SETTING_KEY]).toBe(values.get(LANGUAGE_POLICY_SETTING_KEY));
  expect(response.headers.get("X-Pingufunk-Invalid-Settings")).toBe(LANGUAGE_POLICY_SETTING_KEY);
  expect(upsert).not.toHaveBeenCalled();
});

it("confirms canonical persisted values, not the submitted representations", async () => {
  const response = await post({
    "matching.sonarr.tolerancePercent": "015",
    "matching.movie.yearTolerance": "02",
  });
  expect(await response.json()).toMatchObject({
    success: true,
    updated: 2,
    settings: {
      "matching.sonarr.tolerancePercent": "15",
      "matching.movie.yearTolerance": "2",
    },
  });
  expect(transaction).toHaveBeenCalledTimes(1);
});

it("rolls back a failed second statement and invalidates uncertain cache state", async () => {
  values.set("matching.strategy", "fuzzy");
  upsert.mockImplementationOnce(async () => {
    values.set("matching.strategy", "strict");
    return { key: "matching.strategy", value: "strict" };
  });
  upsert.mockRejectedValueOnce(new Error("private database connection detail"));
  const response = await post({
    "matching.strategy": "strict",
    "matching.sonarr.tolerancePercent": "15",
  });
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({
    error: "Settings commit unconfirmed; refresh before retrying",
    committed: "unknown",
  });
  expect(values.get("matching.strategy")).toBe("fuzzy");
  expect(values.has("matching.sonarr.tolerancePercent")).toBe(false);
  expect(clearSettingsCache).toHaveBeenCalled();
});

it.each([
  { "matching.strategy": null },
  { "matching.threshold": { value: 0.7 } },
  { "matching.threshold": "0.7suffix" },
  { "matching.movie.yearTolerance": "0" },
  { "matching.movie.yearTolerance": "6" },
  { "new.unknown": "true" },
  { key: {}, value: "true" },
  { key: "matching.strategy" },
])("rejects malformed or unknown writes without opening a transaction: %j", async (body) => {
  expect((await post(body)).status).toBe(400);
  expect(transaction).not.toHaveBeenCalled();
  expect(upsert).not.toHaveBeenCalled();
});

it("preserves readable legacy unknown keys but refuses new writes and resets", async () => {
  values.set("legacy.setting", "preserved");
  expect(
    await (await GET(new NextRequest("http://localhost/api/settings?key=legacy.setting"))).json()
  ).toEqual({ key: "legacy.setting", value: "preserved" });
  expect((await post({ "legacy.setting": "changed" })).status).toBe(400);
  expect(
    (await DELETE(new NextRequest("http://localhost/api/settings?key=legacy.setting"))).status
  ).toBe(400);
  expect(values.get("legacy.setting")).toBe("preserved");
});
