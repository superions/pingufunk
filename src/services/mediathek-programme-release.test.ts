import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  programmeItem,
  programmeShow,
  pairedProgrammeItem,
  pairedProgrammeShow,
} from "@/lib/__fixtures__/mediathek-programme";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { generateGenericRssItems, generateRssItems } from "./newznab";
import { createUiNzbDownloads } from "./ui-nzb";
import { decodeMediaExpectations, parseNzbContent } from "./nzb-release";
import type { ApiResultItem } from "@/types";
import { applyDesiredEpisodeFilter, getDesiredEpisodes } from "./tv-search-matcher";
import { tvReviewMediaExpectations } from "./release-media-expectations";

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

it("both member searches publish one identical whole-programme GUID, filename and frozen v7 NZB", () => {
  const source = {
    ...pairedProgrammeItem,
    audioLanguage: "de",
    sourceVideoDimensions: [{ url: pairedProgrammeItem.url_video, width: 1280, height: 720 }],
  };
  const [match] = matchSonarrEpisodes(pairedProgrammeShow, [source], 0, 10);
  expect(match.pairedEpisodes).toEqual(pairedProgrammeShow.episodes);
  const byMember = [2, 3].map((episode) => {
    const context = { query: null, tvdbId: 123, season: "0", episode: String(episode) };
    const desired = getDesiredEpisodes(pairedProgrammeShow, context);
    const matched = applyDesiredEpisodeFilter([match], desired, context);
    expect(matched).toHaveLength(1);
    return generateRssItems(matched[0]);
  });
  expect(byMember[0]).toEqual(byMember[1]);
  expect(byMember[0]).toHaveLength(1);
  const release = byMember[0][0];
  expect(release.title).toMatch(/^Synthetic\.Series\.S00E02E03\.Whole\.Programme\.GERMAN\.720p\./);
  const expected = decodeMediaExpectations(
    new URL(release.enclosure.url, "http://localhost").searchParams.get("encodedExpectations")!
  );
  expect(expected).toMatchObject({
    version: 7,
    sourceProgramme: {
      source: { season: 10, episode: 13 },
      targets: [
        { season: 0, episode: 2 },
        { season: 0, episode: 3 },
      ],
    },
    episodeDurations: [{ seconds: 60 }, { seconds: 60 }],
    durations: { source: { seconds: 120 }, metadata: { seconds: 120 } },
  });
  expect(
    parseNzbContent(createUiNzbDownloads(match.item, false, match.episode, match).sd!)
  ).toEqual({ title: release.title, url: release.link, mediaExpectations: expected });
  expect(
    tvReviewMediaExpectations(match.item, match.episode.runtime!, release.link, 10, match)
  ).toEqual(expected);
  for (const [season, episode] of [
    ["10", "13"],
    ["0", "1"],
    ["0", "4"],
  ]) {
    const context = { query: null, tvdbId: 123, season, episode };
    expect(applyDesiredEpisodeFilter([match], null, context)).toEqual([]);
  }
  expect(source.title).toBe(pairedProgrammeItem.title);
});

it.each(["missing", "unknown", "blocked", "duplicate", "duration", "source-scope"])(
  "never publishes an incomplete or inconsistent pair: %s",
  (kind) => {
    const show = structuredClone(pairedProgrammeShow),
      item = { ...pairedProgrammeItem, audioLanguage: "de" };
    if (kind === "missing") show.episodes.pop();
    if (kind === "unknown") show.episodes[1].runtime = null;
    if (kind === "blocked") show.sonarrBlockedCoordinates = ["0:3"];
    if (kind === "duplicate") show.episodes.push(show.episodes[1]);
    if (kind === "duration") item.duration = 60;
    if (kind === "source-scope") item.title = "Whole Programme (S10/E13-E14)";
    expect(matchSonarrEpisodes(show, [item], 0, 10, undefined, false, true, [], true)).toEqual([]);
  }
);
