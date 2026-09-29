import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InvalidDownloadInputError, UnsafeDownloadPathError } from "@/lib/download-paths";

const { addToQueue, deleteHistoryItem, retryDownload, parseNzbContent } = vi.hoisted(() => ({
  addToQueue: vi.fn(),
  deleteHistoryItem: vi.fn(),
  retryDownload: vi.fn(),
  parseNzbContent: vi.fn(),
}));

vi.mock("@/services/download", () => ({
  addToQueue,
  deleteHistoryItem,
  retryDownload,
  parseNzbContent,
  getQueue: vi.fn(),
  getHistory: vi.fn(),
  getConfigResponse: vi.fn(),
}));

import { GET, POST } from "./route";

beforeEach(() => vi.clearAllMocks());

it("refuses unsafe history-file removal without reporting success", async () => {
  deleteHistoryItem.mockRejectedValue(
    new UnsafeDownloadPathError("Download file does not belong to this job")
  );

  const response = await GET(
    new NextRequest(
      "http://localhost/api/download?mode=history&name=delete&value=job-id&del_files=1"
    )
  );

  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({
    status: false,
    error: "Download file does not belong to this job",
  });
  expect(deleteHistoryItem).toHaveBeenCalledWith("job-id", true);
});

it("rejects an unsafe NZB release name without queuing it", async () => {
  parseNzbContent.mockReturnValue({ title: "../escape", url: "https://example.org/video.mp4" });
  addToQueue.mockRejectedValue(new InvalidDownloadInputError("Invalid release title"));

  const response = await POST(
    new NextRequest("http://localhost/api/download?mode=addfile&cat=sonarr", {
      method: "POST",
      body: "synthetic NZB",
    })
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Invalid release title" });
});

it("returns the new job ID after a safe history retry", async () => {
  retryDownload.mockResolvedValue({ id: "new-job" });

  const response = await GET(
    new NextRequest("http://localhost/api/download?mode=history&name=retry&value=old-job")
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: true, nzo_id: "new-job" });
});
