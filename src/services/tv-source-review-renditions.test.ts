import { beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { ApiResultItem } from "@/types";
import { syntheticYoutubeSource } from "@/lib/__fixtures__/youtube";
import { youtubeRenditionFingerprint } from "@/lib/youtube-source";
import { parseMediaExpectations } from "@/lib/media-expectations";
import { DEFAULT_LANGUAGE_POLICY } from "@/lib/language-policy";
const state = vi.hoisted(() => ({
  item: null as ApiResultItem | null,
  configs: new Map<string, { value: string }>(),
  jobs: [] as Array<{ id: string; title: string; mediaExpectations: string }>,
  enrich: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    download: {
      findUnique: async ({ where }: { where: { id: string } }) =>
        state.jobs.find((job) => job.id === where.id) ?? null,
    },
    config: {
      findUnique: async ({ where }: { where: { key: string } }) =>
        state.configs.get(where.key) ?? null,
    },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        config: {
          create: async ({ data }: { data: { key: string; value: string } }) =>
            state.configs.set(data.key, { value: data.value }),
        },
        download: {
          create: async ({
            data,
          }: {
            data: { id: string; title: string; mediaExpectations: string };
          }) => {
            state.jobs.push(data);
            return data;
          },
        },
      }),
  },
}));
vi.mock("./download", () => ({ triggerDownloadProcessing: vi.fn() }));
vi.mock("@/lib/settings", () => ({
  getMinDurationSeconds: async () => 0,
  getSetting: async () => "10",
}));
vi.mock("@/lib/cache", () => ({ cacheContextEpoch: () => 1 }));
vi.mock("./shows", () => ({ getBaseShowInfoByTvdbId: async () => null }));
vi.mock("./sonarr-provider", async (original) => ({
  ...(await original<object>()),
  openSonarrSession: async () => ({
    inventory: async () => [{ tvdbId: 42, title: "Synthetic series", aliases: [] }],
    show: async () => ({
      series: { tvdbId: 42, title: "Synthetic series", aliases: [] },
      episodes: [
        {
          seasonNumber: 1,
          episodeNumber: 1,
          title: "Concrete episode",
          aired: null,
          expectedRuntimeSeconds: 180,
        },
      ],
    }),
  }),
}));
vi.mock("./mediathek", () => ({
  queryTvSourceCandidates: async () => [structuredClone(state.item)],
}));
vi.mock("./content-search", () => ({
  getConfiguredLanguagePolicy: async () => DEFAULT_LANGUAGE_POLICY,
}));
vi.mock("./tv-search-terms", () => ({ verifiedRuleTopics: () => [] }));
vi.mock("./source-media-facts", () => ({ sourceMediaFacts: { enqueue: vi.fn() } }));
vi.mock("./source-enqueue", () => ({ releaseSourceAdmission: () => undefined }));
vi.mock("./source-audio", async (original) => ({
  ...(await original<object>()),
  enrichSourceAudio: state.enrich,
}));
import { searchTvSourceReviews, previewTvSource, confirmTvSource } from "./tv-source-review";
beforeEach(() => {
  state.configs.clear();
  state.jobs = [];
  state.enrich
    .mockReset()
    .mockImplementation(
      async (items: ApiResultItem[]) => new Map(items.map((item) => [item, [item]]))
    );
  const source = syntheticYoutubeSource();
  const refs = [2160, 1080, 720, 576, 480].map((height) => ({
    ...source,
    selection: { ...source.selection, videoFormat: "avc-" + height, width: height * 2, height },
  }));
  state.item = {
    channel: "Synthetic channel",
    topic: "Synthetic series",
    title: "Concrete episode",
    description: "Synthetic",
    filmlisteTimestamp: 1,
    duration: 120,
    size: 0,
    url_website: "https://www.youtube.com/watch?v=abcdefghijk",
    url_video: "",
    url_video_hd: "",
    url_video_low: "",
    sourceProviderId: "youtube",
    sourceRef: refs[0],
    sourceRenditions: refs,
    audioLanguage: "de",
    sourceAudioEvidence: {
      provider: "youtube",
      videoId: source.videoId,
      channelId: source.channelId,
      mediaIdentity: youtubeRenditionFingerprint(refs[0]),
      language: "de",
      selection: refs[0].selection,
    },
    sourceVideoDimensions: [
      { url: "https://www.youtube.com/watch?v=abcdefghijk", width: 4320, height: 2160 },
    ],
  };
});
it("preserves all five measured selectors through preview, exact job naming, explicit approval and stored receipt despite a shared Watch URL", async () => {
  const found = await searchTvSourceReviews("Synthetic series");
  expect(found).toHaveLength(1);
  const review = found![0].review;
  expect(review.availableRenditions).toEqual(["2160p", "1080p", "720p", "576p", "480p"]);
  for (const rendition of review.availableRenditions) {
    const selector = { ...review.selector, rendition };
    const preview = await previewTvSource(selector);
    expect(preview.height).toBe(Number.parseInt(rendition));
    await confirmTvSource(selector, preview.fingerprint, randomUUID());
    const job = state.jobs.at(-1)!;
    const facts = parseMediaExpectations(JSON.parse(job.mediaExpectations));
    expect(job.title).toContain("." + rendition + ".");
    expect(facts.resolution?.height).toBe(preview.height);
    expect(facts).toMatchObject({
      version: 4,
      sourceRef: { selection: { height: preview.height } },
      approval: { rendition },
    });
    expect(state.enrich.mock.calls.at(-1)?.[4]).toBe("approval");
  }
  expect(state.jobs).toHaveLength(5);
  const facts = JSON.parse(state.jobs[2].mediaExpectations);
  facts.approval.rendition = "1080p";
  expect(() => parseMediaExpectations(facts)).toThrow();
});
