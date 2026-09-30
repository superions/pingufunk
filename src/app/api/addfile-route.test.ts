import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { generateFakeNzb } from "@/services/nzb-release";

const downloadMocks = vi.hoisted(() => ({ addToQueue: vi.fn() }));

vi.mock("@/services/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/download")>();
  return { ...actual, addToQueue: downloadMocks.addToQueue };
});

import { POST as addToApi } from "./route";
import { POST as addToDownloadApi } from "./download/route";

const release = {
  title: `März & "Heute" + Finale`,
  url: "https://example.org/a--b/clip.m3u8?token=a+b&quality=720p",
};
const nzb = generateFakeNzb(release);

beforeEach(() => {
  vi.clearAllMocks();
  downloadMocks.addToQueue.mockResolvedValue({ id: "synthetic-queue-item" });
});
afterEach(() => vi.unstubAllEnvs());

describe("SABnzbd addfile release identity", () => {
  it("blocks both addfile endpoints before parsing in maintenance", async () => {
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
    for (const [routePath, handler] of [
      ["/api", addToApi],
      ["/api/download", addToDownloadApi],
    ] as const) {
      const response = await handler(
        new NextRequest(`http://localhost${routePath}?mode=addfile`, {
          method: "POST",
          body: nzb,
        })
      );
      expect(response.status).toBe(503);
    }
    expect(downloadMocks.addToQueue).not.toHaveBeenCalled();
  });
  it.each([
    ["/api", addToApi],
    ["/api/download", addToDownloadApi],
  ])("queues the exact NZB title and URL through %s", async (routePath, handler) => {
    const response = await handler(
      new NextRequest(`http://localhost${routePath}?mode=addfile&cat=sonarr`, {
        method: "POST",
        body: nzb,
      })
    );

    expect(response.status).toBe(200);
    expect(downloadMocks.addToQueue).toHaveBeenCalledWith(release.url, release.title, "sonarr");
    await expect(response.json()).resolves.toEqual({
      status: true,
      nzo_ids: ["synthetic-queue-item"],
    });
  });

  it.each([
    ["/api", addToApi],
    ["/api/download", addToDownloadApi],
  ])(
    "rejects malformed release identity through %s without queueing",
    async (routePath, handler) => {
      const response = await handler(
        new NextRequest(`http://localhost${routePath}?mode=addfile`, {
          method: "POST",
          body: `<!-- ${Buffer.from("https://example.org/video.mp4").toString("base64")} -->`,
        })
      );

      expect(response.status).toBe(400);
      expect(downloadMocks.addToQueue).not.toHaveBeenCalled();
    }
  );
});
