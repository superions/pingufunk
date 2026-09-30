import { afterEach, expect, it, vi } from "vitest";

const { findFirst, create, queryContent } = vi.hoisted(() => ({
  findFirst: vi.fn(async () => null),
  create: vi.fn(),
  queryContent: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: { generatedRuleset: { findFirst, create } },
}));
vi.mock("./content-search", () => ({ queryContent }));

import { generateRulesetForShow } from "./ruleset-generator";

afterEach(() => vi.unstubAllEnvs());

it("returns no generated ruleset for a miss in maintenance without searching or writing", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  const result = await generateRulesetForShow(7, {
    id: 7,
    name: "Synthetic Show",
    germanName: "Synthetische Sendung",
    aliases: [],
    episodes: [],
  });
  expect(result).toBeNull();
  expect(findFirst).toHaveBeenCalledOnce();
  expect(queryContent).not.toHaveBeenCalled();
  expect(create).not.toHaveBeenCalled();
});
