import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { youtubeRenditionFingerprint, type YoutubeSourceReference } from "@/lib/youtube-source";
import { unknownJobMediaExpectations } from "@/lib/media-expectations";
import { jobDirectoryName } from "@/lib/download-paths";
import type { WorkerLease } from "./worker-lease";

const state = vi.hoisted(() => ({ root: "", show: vi.fn(), update: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) => (key === "download.path" ? state.root : null),
}));
vi.mock("@/services/sonarr-provider", () => ({
  openSonarrSession: state.session,
  SonarrUnavailableError: class extends Error {},
}));
import { prepareSonarrJobTitle } from "./sonarr-job-title";

const source: YoutubeSourceReference = {
  version: 1,
  family: "youtube",
  videoId: "abcdefghijk",
  channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlistId: "PLsynthetic123456",
  mappingRevision: "a".repeat(64),
  originalTitle: "Verified source",
  programme: { kind: "series", targetId: 42, season: 1, episode: 1 },
  selection: {
    videoFormat: "136",
    audioFormat: "140",
    audioTrack: "140",
    language: "de",
    width: 1280,
    height: 720,
    duration: 120,
  },
};
const expectations = JSON.stringify({
  version: 5,
  mediaKind: "series",
  sourceRef: source,
  audio: null,
  durations: {
    source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
    metadata: null,
  },
  sourceAudio: {
    provider: "youtube",
    videoId: source.videoId,
    channelId: source.channelId,
    mediaIdentity: youtubeRenditionFingerprint(source),
    language: "de",
    selection: source.selection,
  },
  resolution: { width: 1280, height: 720, provenance: "provider_dimensions" },
});
const job = () => ({
  id: "12345678-1234-1234-1234-123456789012",
  title: "Deutsche.Serie.S01E01.Deutscher.Episodentitel.GERMAN.720p.WEB.h264-MEDiATHEK",
  category: "sonarr",
  status: "queued",
  progress: 0,
  downloadedBytes: BigInt(0),
  filePath: null,
  mediaExpectations: expectations,
});
const lease = {
  mutate: async (operation: (tx: unknown) => unknown) =>
    operation({ download: { update: state.update } }),
} as unknown as WorkerLease;

beforeEach(async () => {
  state.root = await mkdtemp(path.join(tmpdir(), "pingufunk-queued-name-"));
  vi.stubEnv("DOWNLOAD_TEMP_PATH", path.join(state.root, "incomplete"));
  state.show.mockReset().mockResolvedValue({
    series: { title: "Canonical Series", aliases: [] },
    episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
  });
  state.session.mockReset().mockResolvedValue({ show: state.show });
  state.update.mockReset().mockResolvedValue({});
});
afterEach(async () => {
  await rm(state.root, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it("corrects only an unstarted job's prefix under the lease, retaining its ID, source and German episode title", async () => {
  const before = job();
  await prepareSonarrJobTitle(before, lease);
  expect(state.show).toHaveBeenCalledWith(42, expect.anything());
  expect(state.update).toHaveBeenCalledExactlyOnceWith({
    where: {
      id: before.id,
      status: "queued",
      title: before.title,
      mediaExpectations: expectations,
      filePath: null,
      downloadedBytes: BigInt(0),
      progress: 0,
    },
    data: {
      title: "Canonical.Series.S01E01.Deutscher.Episodentitel.GERMAN.720p.WEB.h264-MEDiATHEK",
    },
  });
  expect(before).toEqual(job());
});

it("keeps a German alias already confirmed by the instance", async () => {
  state.show.mockResolvedValue({
    series: { title: "Canonical Series", aliases: ["Deutsche Serie"] },
    episodes: [{ seasonNumber: 1, episodeNumber: 1 }],
  });
  await prepareSonarrJobTitle(job(), lease);
  expect(state.update).not.toHaveBeenCalled();
});

it.each(["downloading", "completed", "failed"])("never renames a %s job", async (status) => {
  await prepareSonarrJobTitle({ ...job(), status }, lease);
  expect(state.session).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("does not reinterpret legacy or already transferred jobs", async () => {
  for (const value of [
    { ...job(), mediaExpectations: JSON.stringify(unknownJobMediaExpectations()) },
    { ...job(), downloadedBytes: BigInt(1) },
    { ...job(), filePath: "/synthetic/existing.mkv" },
    { ...job(), title: "Synthetic custom download title" },
  ])
    await prepareSonarrJobTitle(value, lease);
  expect(state.session).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("defers the queued job before transfer on missing metadata or an unavailable consumer", async () => {
  state.show.mockResolvedValue({ series: { title: "Canonical Series" }, episodes: [] });
  await expect(prepareSonarrJobTitle(job(), lease)).rejects.toThrow();
  state.show.mockRejectedValue(Error("synthetic unavailable consumer"));
  await expect(prepareSonarrJobTitle(job(), lease)).rejects.toThrow(
    "synthetic unavailable consumer"
  );
  expect(state.update).not.toHaveBeenCalled();
});

it("rejects a conflict between the title coordinate and frozen binding", async () => {
  await expect(
    prepareSonarrJobTitle({ ...job(), title: job().title.replace("S01E01", "S01E02") }, lease)
  ).rejects.toThrow("frozen episode binding");
  expect(state.session).not.toHaveBeenCalled();
  expect(state.update).not.toHaveBeenCalled();
});

it("preserves existing staging artifacts instead of abandoning them under a new directory name", async () => {
  const directory = path.join(state.root, "incomplete", jobDirectoryName(job().title, job().id));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "partial.video"), "retained");
  await expect(prepareSonarrJobTitle(job(), lease)).rejects.toThrow("Existing job artifacts");
  expect(await readFile(path.join(directory, "partial.video"), "utf8")).toBe("retained");
  expect(state.update).not.toHaveBeenCalled();
});
