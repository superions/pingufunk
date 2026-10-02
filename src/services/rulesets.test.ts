import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";

vi.mock("./ruleset-generator", () => ({
  getGeneratedRulesets: vi.fn(async () => []),
  generateRulesetForShow: vi.fn(),
  getGeneratedRulesetByTvdbId: vi.fn(),
}));
vi.mock("@/lib/cache", () => ({ mediathekCache: { clear: vi.fn() } }));

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("RULESETS_URL", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("versioned rule source", () => {
  it("uses the shipped catalogue without requesting remote-main by default", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const rules = await import("./rulesets");
    await rules.loadRulesets();
    const occupied = rules.getRulesetsForTopicAndTvdbId("Fernsehfilme und Serien - Serien", 299964);
    expect(occupied).toHaveLength(1);
    expect(occupied[0].id).toBe(109);
    expect(rules.getRulesetSource()).toEqual({
      kind: "bundled",
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("accepts an explicit valid source and falls back on malformed or unavailable updates", async () => {
    const bundled = JSON.parse(await readFile("data/rulesets.json", "utf8"));
    const remote = [{ ...bundled[0], topic: "Versioned synthetic topic" }];
    vi.stubEnv("RULESETS_URL", "https://example.invalid/pinned-rules.json");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(remote))
      .mockResolvedValueOnce(Response.json({ wrong: true }))
      .mockResolvedValueOnce(new Response("private body", { status: 401 }));
    vi.stubGlobal("fetch", fetch);
    const rules = await import("./rulesets");
    await rules.loadRulesets();
    expect(rules.getAllTopics()).toEqual(["Versioned synthetic topic"]);
    expect(rules.getRulesetSource()?.kind).toBe("configured");
    await rules.loadRulesets();
    expect(rules.getRulesetSource()?.kind).toBe("bundled");
    expect(rules.getAllTopics()).not.toContain("Versioned synthetic topic");
    await rules.loadRulesets();
    expect(
      rules.getRulesetsForTopicAndTvdbId("Fernsehfilme und Serien - Serien", 299964)
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
  });
  it("indexes both series in a shared generated topic and removes stale identities on refresh", async () => {
    const bundled = JSON.parse(await readFile("data/rulesets.json", "utf8"));
    const first = {
      ...bundled[0],
      id: 7001,
      topic: "Shared synthetic topic",
      media: { ...bundled[0].media, media_tvdbId: 7 },
    };
    const second = { ...first, id: 8001, media: { ...first.media, media_tvdbId: 8 } };
    const generator = await import("./ruleset-generator");
    vi.mocked(generator.getGeneratedRulesets).mockResolvedValue([first, second]);
    const rules = await import("./rulesets");
    await rules.loadGeneratedRulesets();
    expect(rules.getRulesetsForTopic(first.topic)).toHaveLength(2);
    expect(rules.getRulesetsForTopicAndTvdbId(first.topic, 7)).toEqual([first]);
    expect(rules.getRulesetsForTopicAndTvdbId(first.topic, 8)).toEqual([second]);
    const before = rules.getRulesetContext();
    rules.addGeneratedRuleset(first);
    expect(rules.getRulesetsForTopic(first.topic)).toHaveLength(2);
    vi.mocked(generator.getGeneratedRulesets).mockResolvedValue([second]);
    await rules.loadGeneratedRulesets();
    expect(rules.getRulesetContext()).not.toBe(before);
    expect(rules.getRulesetsForTopicAndTvdbId(first.topic, 7)).toEqual([]);
    expect(rules.getRulesetsForTopicAndTvdbId(first.topic, 8)).toEqual([second]);
    vi.mocked(generator.getGeneratedRulesets).mockRejectedValueOnce(new Error("synthetic failure"));
    await expect(rules.loadGeneratedRulesets()).rejects.toThrow("Generated rules unavailable");
    expect(rules.getRulesetsForTopic(first.topic)).toEqual([]);
  });
});
