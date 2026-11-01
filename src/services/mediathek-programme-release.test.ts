import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { programmeItem, programmeShow } from "@/lib/__fixtures__/mediathek-programme";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { generateGenericRssItems, generateRssItems } from "./newznab";
import { createUiNzbDownloads } from "./ui-nzb";
import { decodeMediaExpectations, parseNzbContent } from "./nzb-release";
import type { ApiResultItem } from "@/types";

vi.mock("@/lib/db", () => ({ prisma: {} }));
const proved: ApiResultItem = {
  ...programmeItem,
  audioLanguage: "de",
  sourceVideoDimensions: [{ url: programmeItem.url_video, width: 1280, height: 720 }],
};
beforeEach(() =>
  vi.stubGlobal(
    "fetch",
    vi.fn(() => {
      throw Error("No external consumer calls");
    })
  )
);
afterEach(() => vi.unstubAllGlobals());

it("publishes the same canonical single target and frozen v6 through RSS and the UI NZB", () => {
  const source = structuredClone(proved),
    show = structuredClone(programmeShow);
  const [match] = matchSonarrEpisodes(show, [source], 300, 10);
  expect(match).toMatchObject({
    episode: { seasonNumber: 8, episodeNumber: 1 },
    mediathekProgramme: { source: { season: 2019, episode: 1 }, target: { season: 8, episode: 1 } },
  });
  const releases = generateRssItems(match, "all");
  expect(releases).toHaveLength(1);
  const [release] = releases;
  expect(release.title).toMatch(/^Synthetic\.Series\.S08E01\.Midsummer\.GERMAN\.720p\./);
  expect(release.title).not.toContain("2019");
  const expected = decodeMediaExpectations(
    new URL(release.enclosure.url, "http://localhost").searchParams.get("encodedExpectations")!
  );
  expect(expected).toMatchObject({
    version: 6,
    mediaKind: "series",
    durations: { source: { seconds: 120 }, metadata: { seconds: 120 } },
    sourceProgramme: {
      website: programmeItem.url_website,
      tvdbId: 123,
      source: { season: 2019 },
      target: { season: 8 },
    },
  });
  const ui = createUiNzbDownloads(match.item, false, match.episode, match);
  expect(Object.keys(ui)).toEqual(["sd"]);
  expect(parseNzbContent(ui.sd!)).toEqual({
    title: release.title,
    url: release.link,
    mediaExpectations: expected,
  });
  const [neutral] = generateGenericRssItems(source, "all");
  expect(neutral.guid).not.toEqual(release.guid);
  expect(generateRssItems(match, "all")[0].guid).toEqual(release.guid);
  expect(source).toEqual(proved);
  expect(show).toEqual(programmeShow);
  expect(fetch).not.toHaveBeenCalled();
});

it.each<Partial<ApiResultItem>>([
  { title: "Synthetic Solstice (S08/E01)" },
  { title: "Foreign programme (S2019/E01)" },
  { url_website: "https://example.invalid/programmes/foreign" },
  { duration: 60 },
  { audioDescription: true },
  { audioLanguage: "fr" },
])("cannot reinterpret a changed registered source through the ordinary matcher: %j", (changes) => {
  expect(
    matchSonarrEpisodes(
      programmeShow,
      [{ ...proved, ...changes }],
      300,
      10,
      undefined,
      false,
      true,
      [],
      true
    )
  ).toEqual([]);
});

it.each<Partial<ApiResultItem>>([
  { audioLanguage: undefined },
  { sourceVideoDimensions: undefined },
])("keeps a cold bound rendition pending instead of emitting an unproved NZB: %j", (changes) => {
  const [match] = matchSonarrEpisodes(
    programmeShow,
    [{ ...proved, ...changes }],
    300,
    10,
    undefined,
    false,
    true
  );
  expect(match).toBeDefined();
  expect(generateRssItems(match)).toEqual([]);
  expect(createUiNzbDownloads(match.item, false, match.episode, match)).toEqual({});
});

it("requires fresh independently verified target coordinates and cannot choose the short special", () => {
  for (const show of [
    {
      ...programmeShow,
      sonarrVerifiedCoordinates: [],
      episodes: [{ ...programmeShow.episodes[0], metadataSource: undefined }],
    },
    { ...programmeShow, sonarrBlockedCoordinates: ["8:1"] },
    { ...programmeShow, episodes: [{ ...programmeShow.episodes[0], runtime: 1 }] },
    { ...programmeShow, episodes: [{ ...programmeShow.episodes[0], seasonNumber: 0 }] },
  ])
    expect(matchSonarrEpisodes(show, [proved], 300, 10)).toEqual([]);
});
