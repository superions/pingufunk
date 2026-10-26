import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { syntheticYoutubeExpectations } from "@/lib/__fixtures__/youtube";
import { parseMediaExpectations } from "@/lib/media-expectations";
const state = vi.hoisted(() => ({
  receipt: null as null | { value: string },
  find: vi.fn(),
  external: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: { config: { findUnique: state.find } } }));
vi.mock("./sonarr-provider", () => ({ openSonarrSession: state.external }));
vi.mock("./download", () => ({ triggerDownloadProcessing: vi.fn() }));
import { revalidateApprovedTvJob } from "./tv-source-review";
let job: { id: string; url: string }, expected: ReturnType<typeof parseMediaExpectations>;
beforeEach(() => {
  state.find.mockReset().mockImplementation(async () => state.receipt);
  state.external.mockReset().mockRejectedValue(Error("Current metadata disabled"));
  const facts = syntheticYoutubeExpectations();
  job = { id: randomUUID(), url: "https://www.youtube.com/watch?v=abcdefghijk" };
  expected = parseMediaExpectations({
    ...facts,
    version: 4,
    durations: {
      ...facts.durations,
      metadata: { seconds: 180, provenance: "episode_metadata", tolerancePercent: 10 },
    },
    approval: {
      kind: "episode_runtime_once",
      jobId: job.id,
      fingerprint: "b".repeat(64),
      confirmedAt: new Date().toISOString(),
      tvdbId: 42,
      season: 1,
      episode: 1,
      sourceId: "c".repeat(64),
      rendition: "sd",
    },
  });
  state.receipt = {
    value: JSON.stringify({
      id: job.id,
      fingerprint: "b".repeat(64),
      expectations: JSON.stringify(expected),
    }),
  };
});
it("revalidates the frozen typed v4 receipt after source disable without re-admitting against another mapping", async () => {
  await expect(revalidateApprovedTvJob(job, expected)).resolves.toBeUndefined();
  expect(state.find).toHaveBeenCalledWith({
    where: { key: "internal.manual-review." + "b".repeat(64) },
  });
  expect(state.external).not.toHaveBeenCalled();
});
it("rejects absent, foreign or changed receipts, wrong job and wrong video even when current metadata is disabled", async () => {
  const original = state.receipt!;
  for (const receipt of [
    null,
    {
      value: JSON.stringify({
        id: randomUUID(),
        fingerprint: "b".repeat(64),
        expectations: JSON.stringify(expected),
      }),
    },
    {
      value: JSON.stringify({
        id: job.id,
        fingerprint: "d".repeat(64),
        expectations: JSON.stringify(expected),
      }),
    },
    {
      value: JSON.stringify({
        id: job.id,
        fingerprint: "b".repeat(64),
        expectations: JSON.stringify({ ...expected, resolution: null }),
      }),
    },
  ]) {
    state.receipt = receipt;
    await expect(revalidateApprovedTvJob(job, expected)).rejects.toThrow();
  }
  state.receipt = original;
  await expect(revalidateApprovedTvJob({ ...job, id: randomUUID() }, expected)).rejects.toThrow();
  await expect(
    revalidateApprovedTvJob(
      { ...job, url: "https://www.youtube.com/watch?v=bbbbbbbbbbb" },
      expected
    )
  ).rejects.toThrow();
  expect(state.external).not.toHaveBeenCalled();
});
