import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { validateMediaProbe } from "@/server/media-probe";
import { assertMediaRuntimeCompatible, parseMediaExpectations } from "@/lib/media-expectations";
import { DEFAULT_LANGUAGE_POLICY } from "@/lib/language-policy";

const state = vi.hoisted(() => ({
  configs: new Map<string, { key: string; value: string }>(),
  jobs: new Map<
    string,
    {
      id: string;
      title: string;
      url: string;
      category: string;
      status: string;
      mediaExpectations: string;
    }
  >(),
  source: {
    channel: "ZDF",
    topic: "Synthetic series",
    title: "Concrete title (S06/E01)",
    description: "",
    filmlisteTimestamp: 1_795_000_000,
    duration: 3540,
    size: 1234,
    url_website: "https://example.invalid/episode",
    url_video_hd: "https://rodlzdf-a.akamaihd.net/synthetic/hd.mp4",
    url_video: "",
    url_video_low: "",
  },
  enrichedLanguage: "de" as string | null,
  dimensions: true,
  trigger: vi.fn(),
  failedWrite: false,
  lostCommit: false,
  show: {
    series: {
      sonarrId: 7,
      tvdbId: 123,
      title: "Synthetic series",
      monitored: true,
      aliases: [] as string[],
    },
    episodes: [
      {
        sonarrId: 11,
        seriesId: 7,
        seasonNumber: 6,
        episodeNumber: 1,
        title: "TBA",
        aired: new Date("2027-01-01T00:00:00Z"),
        expectedRuntimeSeconds: 3000,
      },
    ],
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(
        async ({ where }: { where: { key: string } }) => state.configs.get(where.key) ?? null
      ),
    },
    download: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => state.jobs.get(where.id) ?? null
      ),
    },
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<void>) => {
      const configs = new Map(state.configs),
        jobs = new Map(state.jobs);
      const result = await operation({
        config: {
          create: async ({ data }: { data: { key: string; value: string } }) => {
            if (configs.has(data.key)) throw new Error("Duplicate");
            configs.set(data.key, data);
            return data;
          },
        },
        download: {
          create: async ({
            data,
          }: {
            data: typeof state.jobs extends Map<string, infer T> ? T : never;
          }) => {
            if (state.failedWrite || jobs.has(data.id)) throw new Error("Write failed");
            jobs.set(data.id, data);
            return data;
          },
        },
      });
      state.configs = configs;
      state.jobs = jobs;
      if (state.lostCommit) throw new Error("Lost acknowledgement");
      return result;
    }),
  },
}));
vi.mock("./download", () => ({ triggerDownloadProcessing: state.trigger }));
vi.mock("@/lib/settings", () => ({
  getMinDurationSeconds: async () => 300,
  getSetting: async () => "15",
}));
vi.mock("@/lib/cache", () => ({ cacheContextEpoch: () => 1 }));
vi.mock("./shows", () => ({ getBaseShowInfoByTvdbId: async () => null }));
vi.mock("./sonarr-provider", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  openSonarrSession: async () => ({
    inventory: async () => [state.show.series],
    show: async () => structuredClone(state.show),
  }),
}));
vi.mock("./mediathek", () => ({
  queryTvSourceCandidates: async () => [structuredClone(state.source)],
}));
vi.mock("./tv-search-terms", () => ({ verifiedRuleTopics: () => [] }));
vi.mock("./content-search", () => ({
  getConfiguredLanguagePolicy: async () => DEFAULT_LANGUAGE_POLICY,
}));
// Review unit tests do not own a metadata worker or external HTTP. Exercise
// its queue boundary here; the worker's range/cache lifecycle has its own suite.
vi.mock("./source-media-facts", () => ({ sourceMediaFacts: { enqueue: vi.fn() } }));
vi.mock("./source-audio", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  enrichSourceAudio: async (items: Array<typeof state.source>) =>
    new Map(
      items.map((item) => [
        item,
        [
          {
            ...item,
            audioLanguage: state.enrichedLanguage,
            ...(state.dimensions
              ? { sourceVideoDimensions: [{ url: item.url_video_hd, width: 1920, height: 1080 }] }
              : {}),
          },
        ],
      ])
    ),
}));
import {
  searchTvSourceReviews,
  previewTvSource,
  confirmTvSource,
  revalidateApprovedTvJob,
} from "./tv-source-review";
import { prisma } from "@/lib/db";
import { sourceMediaFacts } from "./source-media-facts";
import { NextRequest } from "next/server";
import { generateRssItems } from "./newznab";
import { GET as downloadNzb } from "@/app/api/newznab/fake_nzb_download/route";

beforeEach(() => {
  vi.clearAllMocks();
  state.configs.clear();
  state.jobs.clear();
  state.trigger.mockClear();
  state.failedWrite = false;
  state.lostCommit = false;
  state.source.duration = 3540;
  state.source.title = "Concrete title (S06/E01)";
  state.source.topic = "Synthetic series";
  state.enrichedLanguage = "de";
  state.dimensions = true;
  state.show.episodes[0].title = "TBA";
  state.show.episodes[0].expectedRuntimeSeconds = 3000;
});
async function preview() {
  const found = await searchTvSourceReviews("Synthetic.series");
  expect(found).toHaveLength(1);
  expect(found![0].review).toMatchObject({
    sourceSeconds: 3540,
    metadataSeconds: 3000,
    tolerancePercent: 15,
    runtimeConflict: true,
  });
  return previewTvSource(found![0].review.selector);
}

it("publishes verified conflict coordinates without allowing an ordinary NZB or forged grant", async () => {
  const found = (await searchTvSourceReviews("Synthetic series"))!;
  expect(sourceMediaFacts.enqueue).toHaveBeenCalledWith([state.source.url_video_hd, "", ""]);
  const info = {
    ...found[0].info,
    item: {
      ...found[0].info.item,
      audioLanguage: "de",
      sourceVideoDimensions: [{ url: state.source.url_video_hd, width: 1920, height: 1080 }],
    },
  };
  const releases = generateRssItems(info, "all", false);
  expect(releases).toHaveLength(1);
  expect(releases[0].title).toMatch(/S06E01.*GERMAN.*1080p/);
  const denied = await downloadNzb(
    new NextRequest(new URL(releases[0].enclosure.url, "http://localhost"))
  );
  expect(denied.status).toBe(409);
  expect(state.jobs.size).toBe(0);
  const checked = await preview();
  const id = randomUUID();
  await confirmTvSource(checked.selector, checked.fingerprint, id);
  const query = new URLSearchParams({
    encodedUrl: Buffer.from(state.source.url_video_hd).toString("base64"),
    encodedTitle: Buffer.from(state.jobs.get(id)!.title).toString("base64"),
    encodedExpectations: Buffer.from(state.jobs.get(id)!.mediaExpectations).toString("base64"),
  });
  expect(
    (await downloadNzb(new NextRequest(`http://localhost/api/newznab/fake_nzb_download?${query}`)))
      .status
  ).toBe(409);
  expect(state.jobs.size).toBe(1);
});

it("preview/cancel creates no job or receipt, even for future TBA episodes", async () => {
  const value = await preview();
  expect(value).toMatchObject({ width: 1920, height: 1080, language: "de" });
  expect(state.jobs.size).toBe(0);
  expect(state.configs.size).toBe(0);
  expect(state.trigger).not.toHaveBeenCalled();
});

it("atomically binds original references and decision to one job; repeat/lost ACK returns it", async () => {
  const value = await preview();
  const id = randomUUID();
  const result = await confirmTvSource(value.selector, value.fingerprint, id);
  expect(result).toEqual({ id, status: "queued" });
  const job = state.jobs.get(id)!;
  expect(job.title).toBe("Synthetic.series.S06E01.Concrete.title.GERMAN.1080p.WEB.h264-MEDiATHEK");
  expect(job.category).toBe("sonarr");
  const expected = parseMediaExpectations(job.mediaExpectations);
  expect(expected).toMatchObject({
    version: 4,
    durations: {
      source: { seconds: 3540, tolerancePercent: 10 },
      metadata: { seconds: 3000, tolerancePercent: 15 },
    },
    approval: { jobId: id, fingerprint: value.fingerprint },
  });
  expect(state.configs.size).toBe(1);
  expect(state.jobs.size).toBe(1);
  expect(await confirmTvSource(value.selector, value.fingerprint, randomUUID())).toEqual(result);
  expect(state.jobs.size).toBe(1);
  await revalidateApprovedTvJob(job, expected);
  await expect(revalidateApprovedTvJob({ ...job, id: randomUUID() }, expected)).rejects.toThrow();
  expect(() => assertMediaRuntimeCompatible(expected)).toThrow();
  state.jobs.delete(id);
  expect(await confirmTvSource(value.selector, value.fingerprint, randomUUID())).toEqual({
    id,
    status: "history_removed",
  });
  expect(state.jobs.size).toBe(0);
});

it("reconciles a committed transaction whose acknowledgement was lost without inserting again", async () => {
  const value = await preview();
  state.lostCommit = true;
  const id = randomUUID();
  expect(await confirmTvSource(value.selector, value.fingerprint, id)).toEqual({
    id,
    status: "queued",
  });
  expect(state.jobs.size).toBe(1);
  expect(state.configs.size).toBe(1);
});

it("rolls back receipt when job insertion fails; never acknowledges or starts a worker", async () => {
  const value = await preview();
  state.failedWrite = true;
  await expect(confirmTvSource(value.selector, value.fingerprint, randomUUID())).rejects.toThrow();
  expect(state.configs.size).toBe(0);
  expect(state.jobs.size).toBe(0);
  expect(state.trigger).not.toHaveBeenCalled();
});

it.each(["duration", "title", "series", "language", "resolution", "coordinate", "metadata"])(
  "refuses changed %s evidence instead of expanding the approval",
  async (change) => {
    const value = await preview();
    if (change === "duration") state.source.duration++;
    if (change === "title") state.source.title = "Foreign title (S06/E01)";
    if (change === "series") state.source.topic = "Foreign series";
    if (change === "language") state.enrichedLanguage = "fr";
    if (change === "resolution") state.dimensions = false;
    if (change === "coordinate") state.source.title = "Concrete title (S06/E02)";
    if (change === "metadata") state.show.episodes[0].expectedRuntimeSeconds = 3060;
    await expect(
      confirmTvSource(value.selector, value.fingerprint, randomUUID())
    ).rejects.toThrow();
    expect(state.configs.size).toBe(0);
    expect(state.jobs.size).toBe(0);
  }
);

it("refuses unknown source audio and worker-time changed source before transfer", async () => {
  const value = await preview();
  const id = randomUUID();
  await confirmTvSource(value.selector, value.fingerprint, id);
  const job = state.jobs.get(id)!;
  const expected = parseMediaExpectations(job.mediaExpectations);
  state.enrichedLanguage = null;
  await expect(revalidateApprovedTvJob(job, expected)).rejects.toThrow();
  await expect(previewTvSource(value.selector)).rejects.toThrow();
});

it("exempts only metadata duration; source/sample/quality/audio failures remain failures", async () => {
  const value = await preview();
  const id = randomUUID();
  await confirmTvSource(value.selector, value.fingerprint, id);
  const expected = parseMediaExpectations(state.jobs.get(id)!.mediaExpectations);
  const media = {
    format: { format_name: "mp4", duration: "3540" },
    streams: [
      { codec_type: "video", codec_name: "h264", width: 1920, height: 1080 },
      {
        codec_type: "audio",
        codec_name: "aac",
        sample_rate: "48000",
        channels: 2,
        tags: { language: "deu" },
      },
    ],
  };
  expect(validateMediaProbe(media, expected, 15).expectedChecks).toEqual({
    duration: "passed",
    audio: "passed",
    resolution: "passed",
  });
  for (const bad of [
    { ...media, format: { ...media.format, duration: "120" } },
    { ...media, streams: [{ ...media.streams[0], height: 720 }, media.streams[1]] },
    { ...media, streams: [media.streams[0], { ...media.streams[1], tags: { language: "fra" } }] },
    { ...media, streams: [...media.streams, { ...media.streams[1], tags: { language: "und" } }] },
  ])
    expect(() => validateMediaProbe(bad, expected, 25)).toThrow();
});

it("never uses duration to choose between ambiguous episodes or bypasses a concrete title conflict", async () => {
  state.show.episodes[0].title = "Another concrete title";
  expect(await searchTvSourceReviews("Synthetic series")).toEqual([]);
  expect(prisma.$transaction).not.toHaveBeenCalled();
});
