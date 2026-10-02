import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { findMany, update, remove, reload } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  reload: vi.fn(),
}));
vi.mock("@/services/rulesets", () => ({ loadGeneratedRulesets: reload }));
vi.mock("@/lib/db", () => ({
  prisma: { generatedRuleset: { findMany, update, delete: remove } },
}));

import { DELETE, GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  findMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

it("allows ruleset reads but blocks both mutation endpoints in maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  expect((await GET()).status).toBe(200);
  expect(
    (
      await POST(
        new NextRequest("http://localhost/api/rulesets", {
          method: "POST",
          body: JSON.stringify({ id: "synthetic" }),
        })
      )
    ).status
  ).toBe(503);
  expect((await DELETE(new NextRequest("http://localhost/api/rulesets?id=synthetic"))).status).toBe(
    503
  );
  expect(update).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(reload).not.toHaveBeenCalled();
});

it("updates and removes only the requested rule ID and refreshes the shared-topic read owner", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "1");
  update.mockResolvedValue({ id: "series-one-rule", topic: "Shared", tvdbId: 7 });
  expect(
    (
      await POST(
        new NextRequest("http://localhost/api/rulesets", {
          method: "POST",
          body: JSON.stringify({
            id: "series-one-rule",
            filters: "[]",
            tvdbId: 8,
            topic: "Foreign",
          }),
        })
      )
    ).status
  ).toBe(200);
  expect(update.mock.calls[0][0]).toMatchObject({
    where: { id: "series-one-rule" },
    data: { filters: "[]" },
  });
  expect(update.mock.calls[0][0].data).not.toHaveProperty("tvdbId");
  expect(update.mock.calls[0][0].data).not.toHaveProperty("topic");
  expect(reload).toHaveBeenCalledOnce();
  expect(
    (await DELETE(new NextRequest("http://localhost/api/rulesets?id=series-one-rule"))).status
  ).toBe(200);
  expect(remove).toHaveBeenCalledWith({ where: { id: "series-one-rule" } });
  expect(reload).toHaveBeenCalledTimes(2);
});
