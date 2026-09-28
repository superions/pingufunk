import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST, DELETE } from "./route";
import {
  DEFAULT_LANGUAGE_POLICY,
  LANGUAGE_POLICY_SETTING_KEY,
  serializeLanguagePolicy,
} from "@/lib/language-policy";

const { values, upsert, clearSrfTokenCache } = vi.hoisted(() => ({
  values: new Map<string, string>(),
  upsert: vi.fn(),
  clearSrfTokenCache: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        values.has(where.key) ? { value: values.get(where.key) } : null
      ),
      findMany: vi.fn(async () => [...values].map(([key, value]) => ({ key, value }))),
      upsert,
      delete: vi.fn(async ({ where }: { where: { key: string } }) => values.delete(where.key)),
    },
  },
}));
vi.mock("@/lib/settings", () => ({ clearSettingsCache: vi.fn() }));
vi.mock("@/lib/cache", () => ({ clearTTLCache: vi.fn(), mediathekCache: { clear: vi.fn() } }));
vi.mock("@/services/tvdb", () => ({ clearTvdbTokenCache: vi.fn() }));
vi.mock("@/services/srgssr-api", () => ({ clearTokenCache: clearSrfTokenCache }));

beforeEach(() => {
  vi.clearAllMocks();
  values.clear();
  values.set("api.srgssr.consumerKey", "private-key");
  values.set("api.srgssr.consumerSecret", "private-secret");
  upsert.mockImplementation(
    async ({ where, update }: { where: { key: string }; update: { value: string } }) =>
      values.set(where.key, update.value)
  );
});

function post(body: unknown) {
  return POST(
    new NextRequest("http://localhost/api/settings", { method: "POST", body: JSON.stringify(body) })
  );
}

it("masks both SRF credentials in bulk and single-setting responses", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect(JSON.stringify(all)).not.toContain("private-");
  expect(all["api.srgssr.consumerSecret"]).toBeTruthy();
  const single = await (
    await GET(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey"))
  ).json();
  expect(single.value).toBe(all["api.srgssr.consumerKey"]);
});

it("preserves stored credentials when a client saves masked settings again", async () => {
  const all = await (await GET(new NextRequest("http://localhost/api/settings"))).json();
  expect((await post(all)).status).toBe(200);
  await post({ key: "api.srgssr.consumerSecret", value: all["api.srgssr.consumerSecret"] });
  expect(values.get("api.srgssr.consumerKey")).toBe("private-key");
  expect(values.get("api.srgssr.consumerSecret")).toBe("private-secret");
});

it("allows replacing and clearing a credential and invalidates the token", async () => {
  await post({ "api.srgssr.consumerSecret": "new-secret" });
  expect(values.get("api.srgssr.consumerSecret")).toBe("new-secret");
  await post({ key: "api.srgssr.consumerSecret", value: "" });
  expect(values.get("api.srgssr.consumerSecret")).toBe("");
  expect(clearSrfTokenCache).toHaveBeenCalledTimes(2);
  await DELETE(new NextRequest("http://localhost/api/settings?key=api.srgssr.consumerKey"));
  expect(clearSrfTokenCache).toHaveBeenCalledTimes(3);
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

it("fails closed when a stored language policy is corrupt or from a future version", async () => {
  values.set(LANGUAGE_POLICY_SETTING_KEY, '{"version":2,"includeOriginalAudio":true}');
  const settings = await (await GET(new NextRequest("http://localhost/api/settings"))).json();

  expect(settings[LANGUAGE_POLICY_SETTING_KEY]).toBe(
    serializeLanguagePolicy(DEFAULT_LANGUAGE_POLICY)
  );
});
