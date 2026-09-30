import { afterEach, expect, it, vi } from "vitest";

const { testProxy, testYtdlp } = vi.hoisted(() => ({ testProxy: vi.fn(), testYtdlp: vi.fn() }));
vi.mock("@/server/ytdlp", () => ({ testProxy, testYtdlp }));

import { POST } from "./route";

afterEach(() => vi.unstubAllEnvs());

it("does not perform a proxy/network test in maintenance", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  const response = await POST();
  expect(response.status).toBe(503);
  expect(testYtdlp).not.toHaveBeenCalled();
  expect(testProxy).not.toHaveBeenCalled();
});
