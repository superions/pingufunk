import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/services/job-diagnostics", () => ({ getJobDiagnosis: read }));
import { GET } from "./route";
const id = "10000000-0000-4000-8000-000000000001";
beforeEach(() => {
  read.mockReset();
});
it("rejects arbitrary paths/query-selected reports before any job or Arr read", async () => {
  for (const [target, query] of [
    ["..", ""],
    [id, "?url=https://private.invalid"],
  ]) {
    expect(
      (
        await GET(new NextRequest(`http://localhost/api/downloads/${target}/diagnostics${query}`), {
          params: Promise.resolve({ id: target }),
        })
      ).status
    ).toBe(400);
  }
  expect(read).not.toHaveBeenCalled();
});
it("missing jobs are not imported; unavailable reads do not become healthy responses or free errors", async () => {
  read.mockResolvedValue(null);
  expect(
    (await GET(new NextRequest("http://localhost/"), { params: Promise.resolve({ id }) })).status
  ).toBe(404);
  read.mockRejectedValue(new Error("secret-token"));
  const failure = await GET(new NextRequest("http://localhost/"), {
    params: Promise.resolve({ id }),
  });
  expect(failure.status).toBe(503);
  expect(failure.headers.get("Cache-Control")).toBe("no-store");
  expect(await failure.text()).not.toContain("secret-token");
});
