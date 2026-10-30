import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setImmediate } from "node:timers/promises";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  create: vi.fn(),
  prepare: vi.fn(),
  transaction: vi.fn(),
  start: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  databaseProvider: "postgresql",
  prisma: {
    download: { create: state.create },
    $prepareMutation: state.prepare,
    $transaction: state.transaction,
  },
}));
vi.mock("./source-enqueue", () => ({ releaseSourceAdmission: () => undefined }));
vi.mock("@/server/download-manager", () => ({ startDownloadProcessing: state.start }));
import { POST } from "./sab-api";

beforeEach(() => {
  vi.clearAllMocks();
  state.start.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it.each(["commit", "lost commit"])(
  "does not acknowledge an unkeyed PostgreSQL job before %s is known",
  async (outcome) => {
    const durable = new Map<string, unknown>();
    const barrier = Promise.withResolvers<void>();
    void barrier.promise.catch(() => {});
    state.create.mockImplementation(async ({ data }) => ({ ...data }));
    state.transaction.mockImplementation(async (operation) => {
      const row = await operation({ download: { create: state.create } });
      await barrier.promise;
      durable.set(row.id, row);
      return row;
    });
    const encoded = (value: string) => Buffer.from(value).toString("base64");
    const body = `<nzb><!-- ${encoded("Synthetic.S01E01")} --><!-- ${encoded("https://synthetic.invalid/video.mp4")} --></nzb>`;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const response = POST(
      new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", { method: "POST", body })
    );
    let acknowledged = false;
    void response.then(() => {
      acknowledged = true;
    });
    try {
      await vi.waitFor(() => expect(state.create).toHaveBeenCalledOnce());
      await setImmediate();
      expect(acknowledged).toBe(false);
      expect(durable.size).toBe(0);
      expect(state.start).not.toHaveBeenCalled();
      if (outcome === "commit") barrier.resolve();
      else barrier.reject(new Error("Uncertain COMMIT; no retry"));
      const result = await response;
      const receipt = await result.json();
      if (outcome === "commit") {
        expect(result.status).toBe(200);
        expect(receipt.status).toBe(true);
        expect(receipt.nzo_ids).toHaveLength(1);
        expect(durable.has(receipt.nzo_ids[0])).toBe(true);
        await vi.waitFor(() => expect(state.start).toHaveBeenCalledOnce());
      } else {
        expect(result.status).toBe(500);
        expect(receipt.nzo_ids).toBeUndefined();
        expect(durable.size).toBe(0);
        expect(state.start).not.toHaveBeenCalled();
      }
      expect(state.create).toHaveBeenCalledOnce();
    } finally {
      barrier.resolve();
      await response;
    }
  }
);
