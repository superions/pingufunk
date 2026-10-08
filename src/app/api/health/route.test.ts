import { expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({ readiness: vi.fn(), count: vi.fn(async () => 0) }));
vi.mock("@/lib/db", () => ({ prisma: { config: { count: mocks.count } } }));
vi.mock("@/server/runtime-readiness", () => ({
  boundedRuntimeRead: (promise: Promise<unknown>) => promise,
  getSchemaReadiness: mocks.readiness,
  runtimeState: (schema: unknown) => ({
    liveness: "alive",
    schema,
    writesEnabled: false,
    worker: { state: "disabled" },
  }),
}));

it("keeps liveness independent of database/tools and reports readiness separately", async () => {
  mocks.readiness.mockResolvedValue({ ready: false, state: "unavailable" });
  const live = await GET(new NextRequest("http://localhost/api/health?mode=live"));
  expect(live.status).toBe(200);
  expect(await live.json()).toEqual({ liveness: "alive" });
  expect(mocks.readiness).not.toHaveBeenCalled();
  expect(mocks.count).not.toHaveBeenCalled();
  const ready = await GET(new NextRequest("http://localhost/api/health"));
  expect(ready.status).toBe(503);
  expect((await ready.json()).schema.ready).toBe(false);
  expect(ready.headers.get("cache-control")).toBe("no-store");
  mocks.readiness.mockResolvedValue({ ready: true, state: "compatible" });
  expect((await GET(new NextRequest("http://localhost/api/health?mode=ready"))).status).toBe(200);
  expect((await GET(new NextRequest("http://localhost/api/health?mode=other"))).status).toBe(400);
  mocks.count.mockRejectedValueOnce(new Error("synthetic private connection"));
  const outage = await GET(new NextRequest("http://localhost/api/health"));
  expect(outage.status).toBe(503);
  expect(await outage.text()).not.toContain("private");
});
