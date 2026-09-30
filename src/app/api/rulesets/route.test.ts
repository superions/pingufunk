import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { findMany, update, remove } = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
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
});
