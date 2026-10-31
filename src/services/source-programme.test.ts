import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import {
  programmeBinding,
  programmeItem,
  programmeShow,
  programmeExpectations,
} from "@/lib/__fixtures__/mediathek-programme";
import type { ApiResultItem, TvdbData } from "@/types";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  fresh: vi.fn(),
  base: vi.fn(),
  merge: vi.fn(),
  transfer: vi.fn(),
  settings: vi.fn(),
}));
vi.mock("@/lib/mediathek-client", async (original) => ({
  ...(await original<typeof import("@/lib/mediathek-client")>()),
  queryMediathekView: state.query,
}));
vi.mock("./sonarr-provider", () => ({
  openSonarrSession: async () => ({ show: state.fresh }),
  mergeSonarrShow: state.merge,
}));
vi.mock("./shows", () => ({ getBaseShowInfoByTvdbId: state.base }));
vi.mock("@/lib/settings", () => ({
  getSetting: state.settings,
  getMinDurationSeconds: async () => 300,
}));
vi.mock("@/server/download-transfer", () => ({ downloadFile: state.transfer }));

import {
  hasMediathekProgrammeBinding,
  matchBoundSourceEpisode,
  revalidateMediathekProgramme,
  validateMediathekProgrammeAdmission,
} from "./source-programme";
import { releaseSourceAdmission } from "./source-enqueue";
import { downloadSource, transferSource } from "@/server/source-download";
import { GET as downloadNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { createFakeNzbDownloadUrl, parseNzbContent } from "./nzb-release";

let directory: string | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  state.query.mockResolvedValue([structuredClone(programmeItem)]);
  state.fresh.mockResolvedValue({ synthetic: true });
  state.base.mockResolvedValue(structuredClone(programmeShow));
  state.merge.mockReturnValue(structuredClone(programmeShow));
  state.settings.mockResolvedValue("10");
  state.transfer.mockImplementation(async (_url, output: string) => {
    await writeFile(output, "owned synthetic media");
    return null;
  });
});
afterEach(async () => {
  if (directory) await rm(directory, { recursive: true });
  directory = undefined;
});

it("keeps publisher identity and the one verified canonical target without changing either input", () => {
  const source = structuredClone(programmeItem),
    show = structuredClone(programmeShow);
  const result = matchBoundSourceEpisode(source, show, 300, 10);
  expect(result).toMatchObject({
    tvdbId: 123,
    episode: { seasonNumber: 8, episodeNumber: 1, runtime: 2 },
    mediathekProgramme: { source: { season: 2019, episode: 1 }, target: { season: 8, episode: 1 } },
  });
  expect(hasMediathekProgrammeBinding(source, show)).toBe(true);
  expect(source).toEqual(programmeItem);
  expect(show).toEqual(programmeShow);
});

it.each<Partial<ApiResultItem>>([
  { url_website: "https://example.invalid/programmes/foreign" },
  { channel: "Foreign broadcaster" },
  { topic: "Foreign series" },
  { title: "Different programme (S2019/E01)" },
  { title: "Synthetic Solstice (S2019/E02)" },
  { title: "Synthetic Solstice (S08/E01)" },
  { title: "Synthetic Solstice (S2019/E01-E02)" },
  { title: "Synthetic Solstice (S2019/E01) (Audiodeskription)" },
  { audioDescription: true },
  { signLanguage: true },
  { clearSpeech: true },
  { originalVersion: true },
  { audioLanguage: "fr" },
  { duration: 60 },
  { duration: 0 },
])("never waives another programme, edition, language or duration: %j", (changes) => {
  expect(
    matchBoundSourceEpisode({ ...programmeItem, ...changes }, programmeShow, 300, 10, true)
  ).toBeNull();
});

it.each<Partial<TvdbData>>([
  { mediathekProgrammes: [] },
  { mediathekProgrammes: [programmeBinding, programmeBinding] },
  { sonarrUnavailable: true },
  { sonarrBlockedCoordinates: ["8:1"] },
  {
    sonarrVerifiedCoordinates: [],
    episodes: [{ ...programmeShow.episodes[0], metadataSource: undefined }],
  },
  { episodes: [] },
  { episodes: [programmeShow.episodes[0], programmeShow.episodes[0]] },
  { episodes: [{ ...programmeShow.episodes[0], runtime: 1 }] },
  { episodes: [{ ...programmeShow.episodes[0], runtime: null }] },
])("requires one current independently verified target: %j", (changes) => {
  expect(
    matchBoundSourceEpisode(programmeItem, { ...programmeShow, ...changes }, 300, 10, true)
  ).toBeNull();
});

it("revalidates new admission through the current catalogue and a forced fresh instance read", async () => {
  const admit = releaseSourceAdmission(programmeItem.url_video, programmeExpectations);
  expect(admit).toBeTypeOf("function");
  await expect(admit!()).resolves.toBeUndefined();
  expect(state.fresh).toHaveBeenCalledWith(123, expect.anything(), true);
  expect(state.base).toHaveBeenCalledWith(123, expect.anything());
  state.merge.mockReturnValue({ ...programmeShow, mediathekProgrammes: [] });
  await expect(admit!()).rejects.toThrow("Source binding changed");
  state.merge.mockReturnValue(programmeShow);
  state.settings.mockResolvedValue("15");
  await expect(
    validateMediathekProgrammeAdmission(programmeItem.url_video, programmeExpectations)
  ).rejects.toThrow("Programme policy changed");
  expect(state.transfer).not.toHaveBeenCalled();
});

it("emits a bound NZB only while the exact source and current target remain verified", async () => {
  const request = new NextRequest(
    new URL(
      createFakeNzbDownloadUrl({
        title: "Synthetic.Series.S08E01.Midsummer.GERMAN.720p.WEB.h264-Pingufunk",
        url: programmeItem.url_video,
        mediaExpectations: programmeExpectations,
      }),
      "http://localhost"
    )
  );
  const accepted = await downloadNzb(request);
  expect(accepted.status).toBe(200);
  expect(parseNzbContent(await accepted.text())?.mediaExpectations).toEqual(programmeExpectations);
  state.merge.mockReturnValue({ ...programmeShow, sonarrBlockedCoordinates: ["8:1"] });
  const rejected = await downloadNzb(request);
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toEqual({
    error: "Source binding changed; search and verify the source again",
  });
  expect(state.transfer).not.toHaveBeenCalled();
});

it.each(["missing", "changed", "ambiguous", "other-rendition", "incomplete"])(
  "rejects %s source evidence before transferring bytes",
  async (kind) => {
    state.query.mockResolvedValue(
      kind === "missing"
        ? []
        : kind === "changed"
          ? [{ ...programmeItem, duration: 121 }]
          : kind === "ambiguous"
            ? [programmeItem, programmeItem]
            : kind === "other-rendition"
              ? [{ ...programmeItem, url_video: "https://example.invalid/other.mp4" }]
              : Array.from({ length: 100 }, () => programmeItem)
    );
    directory = await mkdtemp(path.join(os.tmpdir(), "pingufunk-programme-"));
    await expect(
      transferSource(downloadSource(programmeItem.url_video, programmeExpectations), {
        stagingDirectory: directory,
        filename: "owned-programme",
        expectations: programmeExpectations,
        signal: new AbortController().signal,
        getContainer: async () => "mp4",
        onProgress: async () => {},
      })
    ).rejects.toThrow("Programme source no longer verified");
    expect(state.transfer).not.toHaveBeenCalled();
  }
);

it("an accepted job retains its frozen intent when the later catalogue or target changes", async () => {
  const frozen = structuredClone(programmeExpectations);
  state.fresh.mockResolvedValue(null);
  state.merge.mockReturnValue(null);
  directory = await mkdtemp(path.join(os.tmpdir(), "pingufunk-programme-"));
  await expect(
    transferSource(downloadSource(programmeItem.url_video, frozen), {
      stagingDirectory: directory,
      filename: "owned-programme",
      expectations: frozen,
      signal: new AbortController().signal,
      getContainer: async () => "mp4",
      onProgress: async () => {},
    })
  ).resolves.toEqual({ path: path.join(directory, "owned-programme.mp4"), extension: ".mp4" });
  expect(state.transfer).toHaveBeenCalledOnce();
  expect(state.fresh).not.toHaveBeenCalled();
  expect(state.base).not.toHaveBeenCalled();
  expect(frozen).toEqual(programmeExpectations);
});

it("cancels programme verification before provider or transfer work", async () => {
  const abort = new AbortController();
  abort.abort();
  await expect(
    revalidateMediathekProgramme(
      programmeItem.url_video,
      programmeExpectations,
      undefined,
      abort.signal
    )
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(state.query).not.toHaveBeenCalled();
  expect(state.transfer).not.toHaveBeenCalled();
});
