import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { InvalidDownloadInputError, UnsafeDownloadPathError } from "@/lib/download-paths";
import { MediaExpectationsError } from "@/lib/media-expectations";

const {
  addToQueue,
  deleteHistoryItem,
  retryDownload,
  parseNzbContent,
  getQueue,
  getHistory,
  getConfigResponse,
} = vi.hoisted(() => ({
  addToQueue: vi.fn(),
  deleteHistoryItem: vi.fn(),
  retryDownload: vi.fn(),
  parseNzbContent: vi.fn(),
  getQueue: vi.fn(),
  getHistory: vi.fn(),
  getConfigResponse: vi.fn(),
}));

vi.mock("@/services/download", () => ({
  addToQueue,
  deleteHistoryItem,
  retryDownload,
  parseNzbContent,
  getQueue,
  getHistory,
  getConfigResponse,
}));

import * as alias from "./route";
import * as root from "../route";

beforeEach(() => vi.resetAllMocks());
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe.each([
  { path: "/api", ...root },
  { path: "/api/download", ...alias },
])("SAB $path", ({ path, GET, POST }) => {
  it.each(["queue", "fullstatus", "history", "get_config"])(
    "bounds a hung %s read without claiming healthy empty data",
    async (mode) => {
      vi.useFakeTimers();
      for (const read of [getQueue, getHistory, getConfigResponse])
        read.mockImplementation(() => new Promise(() => {}));
      const pending = GET(new NextRequest(`http://localhost${path}?mode=${mode}`));
      await vi.advanceTimersByTimeAsync(2999);
      let resolved = false;
      void pending.then(() => {
        resolved = true;
      });
      await Promise.resolve();
      expect(resolved).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      const response = await pending;
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to read download API" });
      expect(vi.getTimerCount()).toBe(0);
      expect(addToQueue).not.toHaveBeenCalled();
      expect(retryDownload).not.toHaveBeenCalled();
    }
  );

  it("keeps history readable but blocks GET mutations and addfile during maintenance", async () => {
    vi.stubEnv("PINGUFUNK_WRITES_ENABLED", "0");
    const history = await GET(new NextRequest("http://localhost/api/download?mode=history"));
    expect(history.status).toBe(200);
    expect(
      (
        await GET(
          new NextRequest("http://localhost/api/download?mode=history&name=delete&value=job-id")
        )
      ).status
    ).toBe(503);
    expect(
      (
        await POST(
          new NextRequest("http://localhost/api/download?mode=addfile", {
            method: "POST",
            body: "synthetic NZB",
          })
        )
      ).status
    ).toBe(503);
    expect(deleteHistoryItem).not.toHaveBeenCalled();
    expect(addToQueue).not.toHaveBeenCalled();
  });

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

  it("keeps version, fullstatus, queue, history and configuration identical", async () => {
    getQueue.mockResolvedValue({ slots: [{ nzo_id: "synthetic" }] });
    getHistory.mockResolvedValue({ slots: [{ nzo_id: "finished" }] });
    getConfigResponse.mockResolvedValue({ config: { categories: [{ name: "sonarr" }] } });
    const request = (mode: string) => new NextRequest(`http://localhost${path}?mode=${mode}`);
    expect(await (await GET(request("version"))).json()).toEqual({ version: "4.3.3" });
    expect(await (await GET(request("queue"))).json()).toEqual({
      queue: { slots: [{ nzo_id: "synthetic" }] },
    });
    expect(await (await GET(request("history"))).json()).toEqual({
      history: { slots: [{ nzo_id: "finished" }] },
    });
    expect(await (await GET(request("get_config"))).json()).toEqual({
      config: { categories: [{ name: "sonarr" }] },
    });
    expect(await (await GET(request("fullstatus"))).json()).toEqual({
      status: {
        paused: false,
        speed: "0",
        kbpersec: "0",
        mbleft: "0",
        mb: "0",
        noofslots: 1,
        state: "IDLE",
      },
    });
    expect((await GET(request("invalid"))).status).toBe(400);
  });

  it("does not expose DB failures or turn them into an empty successful history", async () => {
    const failure = new Error("synthetic private connection detail");
    getHistory.mockRejectedValue(failure);
    const response = await GET(new NextRequest(`http://localhost${path}?mode=history`));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Failed to read download API" });
    deleteHistoryItem.mockRejectedValue(failure);
    expect(
      (
        await GET(
          new NextRequest(`http://localhost${path}?mode=history&name=delete&value=synthetic`)
        )
      ).status
    ).toBe(500);
  });

  it.each(["queue", "fullstatus", "get_config"])(
    "fails its DB-dependent %s read rather than reporting healthy",
    async (mode) => {
      getQueue.mockRejectedValue(new Error("synthetic private DB detail"));
      getConfigResponse.mockRejectedValue(new Error("synthetic private DB detail"));
      const response = await GET(new NextRequest(`http://localhost${path}?mode=${mode}`));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "Failed to read download API" });
    }
  );

  it.each([
    new InvalidDownloadInputError("Invalid media expectations"),
    new MediaExpectationsError(),
  ])("rejects corrupt retry input while preserving the history item", async (failure) => {
    retryDownload.mockRejectedValue(failure);
    const response = await GET(
      new NextRequest(`http://localhost${path}?mode=history&name=retry&value=synthetic`)
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ status: false, error: "Invalid media expectations" });
    expect(deleteHistoryItem).not.toHaveBeenCalled();
  });
});
