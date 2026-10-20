import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
const mocks = vi.hoisted(() => ({ preview: vi.fn(), confirm: vi.fn() }));
vi.mock("@/services/tv-source-review", async (original) => ({
  ...(await original<object>()),
  previewTvSource: mocks.preview,
  confirmTvSource: mocks.confirm,
}));
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { GET, POST } from "./route";
const selector = { tvdbId: 123, season: 6, episode: 1, sourceId: "a".repeat(64), rendition: "hd" };
const body = {
  selector,
  fingerprint: "b".repeat(64),
  intentId: randomUUID(),
  confirmRuntimeException: true,
};
function request(
  value: unknown = body,
  headers: Record<string, string> = { "X-Pingufunk-Manual-Review": "1", Origin: "http://localhost" }
) {
  return new NextRequest("http://localhost/api/tv-source-review", {
    method: "POST",
    headers,
    body: JSON.stringify(value),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.preview.mockResolvedValue({ selector });
  mocks.confirm.mockResolvedValue({ id: body.intentId, status: "queued" });
});

it("preview never confirms and is not cached", async () => {
  const response = await GET(
    new NextRequest(
      `http://localhost/api/tv-source-review?selector=${encodeURIComponent(JSON.stringify(selector))}`
    )
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("requires a deliberate same-origin confirmation, not an ambient SAB or cross-site POST", async () => {
  const cases: Record<string, string>[] = [
    {},
    { Origin: "http://foreign.invalid", "X-Pingufunk-Manual-Review": "1" },
    { "X-Pingufunk-Manual-Review": "1", "sec-fetch-site": "cross-site" },
  ];
  for (const headers of cases) {
    expect((await POST(request(body, headers))).status).toBe(403);
  }
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("does not accept arbitrary URLs, XML, expectations or an unconfirmed decision", async () => {
  for (const value of [
    { ...body, confirmRuntimeException: false },
    { ...body, url: "https://foreign.invalid/media.mp4" },
    { ...body, selector: { ...selector, episode: -1 } },
    { ...body, intentId: "not-uuid" },
  ]) {
    expect((await POST(request(value))).status).toBe(400);
  }
  expect(mocks.confirm).not.toHaveBeenCalled();
});
it("returns only the confirmed durable job receipt; preserves the client's intent", async () => {
  const response = await POST(request());
  expect(await response.json()).toEqual({ id: body.intentId, status: "queued" });
  expect(mocks.confirm).toHaveBeenCalledWith(selector, body.fingerprint, body.intentId);
});
it("accepts the received plain-HTTP or proxied origin even when Next normalizes its bind URL", async () => {
  for (const protocol of ["http", "https"]) {
    const headers = {
      "X-Pingufunk-Manual-Review": "1",
      Host: "synthetic.test:6791",
      Origin: `${protocol}://synthetic.test:6791`,
      "x-forwarded-proto": protocol,
    };
    expect((await POST(request(body, headers))).status).toBe(200);
    expect(
      (await POST(request(body, { ...headers, Origin: `${protocol}://foreign.test:6791` }))).status
    ).toBe(403);
  }
});
it("redacts provider exceptions and never manufactures success or a retry job", async () => {
  mocks.confirm.mockRejectedValue(new Error("token=secret private-url"));
  const response = await POST(request());
  expect(response.status).toBe(409);
  expect(JSON.stringify(await response.json())).not.toMatch(/secret|private-url/);
  expect(mocks.confirm).toHaveBeenCalledTimes(1);
});
it("maintenance denies confirmation before any provider or database operation", async () => {
  vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
  try {
    expect((await POST(request())).status).toBe(503);
    expect(mocks.confirm).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllEnvs();
  }
});
