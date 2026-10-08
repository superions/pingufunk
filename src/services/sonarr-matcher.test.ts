import { describe, expect, it } from "vitest";
import { matchSonarrEpisodes, sonarrDurationCheck } from "./sonarr-matcher";
import type { ApiResultItem, TvdbData } from "@/types";
import { withDecisionDiagnostics } from "@/server/decision-diagnostics";

const show: TvdbData = {
  id: 123,
  name: "Synthetic series",
  germanName: null,
  aliases: [],
  episodes: [
    {
      name: "Region: Missing episode",
      seasonNumber: 2,
      episodeNumber: 3,
      aired: new Date("2026-09-29T18:00:00Z"),
      runtime: 2,
      metadataSource: "sonarr",
    },
  ],
};
const item: ApiResultItem = {
  channel: "ARD",
  topic: "Synthetic series",
  title: "Synthetic series: Missing episode",
  description: "",
  filmlisteTimestamp: 1_795_000_000,
  duration: 120,
  size: 12345,
  url_video: "https://example.invalid/media.mp4",
  url_video_hd: "",
  url_video_low: "",
  url_website: "https://example.invalid/episode",
};

it("records real alias/coordinate/runtime causes without turning a score into evidence", async () => {
  const { result, report } = await withDecisionDiagnostics(async () =>
    matchSonarrEpisodes(
      show,
      [
        { ...item, topic: "Unrelated private series" },
        { ...item, title: "Missing episode (S01/E03)" },
        { ...item, duration: 200 },
        item,
      ],
      300,
      10
    )
  );
  expect(result).toHaveLength(1);
  for (const reason of [
    "alias_conflict",
    "coordinate_conflict",
    "runtime_outside_tolerance",
    "identity_verified",
  ])
    expect(report.events.some((event) => event.reason === reason)).toBe(true);
  expect(JSON.stringify(report)).not.toMatch(/Unrelated|Synthetic|example\.invalid/);
});

describe("supplemental duration policy", () => {
  it.each([108, 120, 132])("accepts the inclusive short-episode boundary %s", (duration) => {
    expect(sonarrDurationCheck(duration, 120, 300, 10)).toEqual({
      accepted: true,
      expectedVerified: true,
    });
  });
  it.each([107.999, 132.001, 0, -1, NaN, Infinity])(
    "rejects outside/unknown duration %s",
    (duration) => {
      expect(sonarrDurationCheck(duration, 120, 300, 10).accepted).toBe(false);
    }
  );
  it("uses exact duration for zero tolerance and never calls unknown expectation verified", () => {
    expect(sonarrDurationCheck(120, 120, 300, 0).accepted).toBe(true);
    expect(sonarrDurationCheck(120.001, 120, 300, 0).accepted).toBe(false);
    expect(sonarrDurationCheck(300, null, 300, 10)).toEqual({
      accepted: true,
      expectedVerified: false,
    });
    expect(sonarrDurationCheck(120, null, 300, 10).accepted).toBe(false);
  });
});

describe("identity before duration/identity stamping", () => {
  it("requires supplemental coordinate verification for a preserved base TBA episode", () => {
    const base = {
      ...show,
      episodes: [{ ...show.episodes[0], name: "TBA", metadataSource: undefined }],
    };
    const source = { ...item, title: "Actual title (S02/E03)" };
    expect(matchSonarrEpisodes(base, [source], 300, 10)).toEqual([]);
    expect(
      matchSonarrEpisodes({ ...base, sonarrVerifiedCoordinates: ["2:3"] }, [source], 300, 10)
    ).toHaveLength(1);
    expect(
      matchSonarrEpisodes(
        { ...base, sonarrVerifiedCoordinates: ["2:3"] },
        [{ ...source, title: "TBA" }],
        300,
        10
      )
    ).toEqual([]);
  });
  it.each(["TBA", "TBD", "To be announced", "Episode 3", "Folge 3"])(
    "accepts %s only with explicit complete coordinates, series and runtime",
    (name) => {
      const placeholder = { ...show, episodes: [{ ...show.episodes[0], name }] };
      const source = { ...item, title: "Actual source title (S02/E03)" };
      expect(matchSonarrEpisodes(placeholder, [source], 300, 10)).toHaveLength(1);
      for (const override of [
        { topic: "Foreign series" },
        { title: "Actual source title (S01/E03)" },
        { title: "Actual source title (S02/E04)" },
        { title: "Actual source title" },
        { duration: 200 },
      ])
        expect(matchSonarrEpisodes(placeholder, [{ ...source, ...override }], 300, 10)).toEqual([]);
      expect(
        matchSonarrEpisodes(
          { ...placeholder, episodes: [{ ...placeholder.episodes[0], runtime: null }] },
          [source],
          300,
          10
        )
      ).toEqual([]);
      expect(
        matchSonarrEpisodes(
          { ...placeholder, sonarrBlockedCoordinates: ["2:3"] },
          [source],
          300,
          10
        )
      ).toEqual([]);
      expect(
        matchSonarrEpisodes(
          {
            ...placeholder,
            episodes: [{ ...placeholder.episodes[0], name: "Concrete different title" }],
          },
          [source],
          300,
          10
        )
      ).toEqual([]);
    }
  );
  it("uses verified umlaut aliases and explicit coordinates for generic metadata titles", () => {
    const generic = {
      ...show,
      aliases: [{ name: "Synthetische Serie - Toedliches Schweigen", language: "und" }],
      episodes: [{ ...show.episodes[0], name: "Episode 3" }],
    };
    const source = {
      ...item,
      topic: "Synthetische Serie - Tödliches Schweigen",
      title: "Folge 3 | Synthetische Serie - Tödliches Schweigen (S02/E03)",
    };
    expect(matchSonarrEpisodes(generic, [source], 300, 10)).toHaveLength(1);
    for (const override of [
      { topic: "Foreign series" },
      { title: "Folge 3 (S01/E03)" },
      { duration: 200 },
      { title: "Folge 3" },
    ])
      expect(matchSonarrEpisodes(generic, [{ ...source, ...override }], 300, 10)).toEqual([]);
    expect(
      matchSonarrEpisodes(
        { ...generic, episodes: [{ ...generic.episodes[0], runtime: null }] },
        [source],
        300,
        10
      )
    ).toEqual([]);
  });
  it("resolves an ARTE fraction only from a complete unambiguous single-season Sonarr inventory", () => {
    const episodes = [1, 2, 3, 4].map((episodeNumber) => ({
      ...show.episodes[0],
      episodeNumber,
      name: `Episode ${episodeNumber}`,
    }));
    const verified = {
      ...item,
      title: "Synthetic series (3/4) - Translated episode title",
      topic: "Fernsehfilme und Serien - Serien",
      url_website: "https://www.arte.tv/de/videos/123456-003-A/",
      arteVerifiedVideoId: "123456-003-A",
    };
    expect(matchSonarrEpisodes({ ...show, episodes }, [verified], 300, 10)).toMatchObject([
      { episode: { seasonNumber: 2, episodeNumber: 3 } },
    ]);
    for (const list of [
      episodes.slice(0, 3),
      [...episodes, { ...episodes[0], seasonNumber: 3 }],
      episodes.map((episode) => ({ ...episode, metadataSource: undefined })),
    ])
      expect(matchSonarrEpisodes({ ...show, episodes: list }, [verified], 300, 10)).toEqual([]);
    expect(
      matchSonarrEpisodes(
        { ...show, episodes },
        [{ ...verified, arteVerifiedVideoId: undefined }],
        300,
        10
      )
    ).toEqual([]);
    expect(
      matchSonarrEpisodes(
        { ...show, episodes, sonarrBlockedCoordinates: ["2:3"] },
        [verified],
        300,
        10
      )
    ).toEqual([]);
  });
  it("requires adapter proof and verified series prefix for a shared ARTE topic", () => {
    const candidate = {
      ...item,
      topic: "Fernsehfilme und Serien - Serien",
      url_website: "https://www.arte.tv/de/videos/123456-001-A/",
      audioLanguage: "de",
    };
    expect(matchSonarrEpisodes(show, [candidate], 300, 10)).toEqual([]);
    expect(
      matchSonarrEpisodes(show, [{ ...candidate, arteVerifiedVideoId: "123456-001-A" }], 300, 10)
    ).toHaveLength(1);
    expect(
      matchSonarrEpisodes(
        show,
        [
          {
            ...candidate,
            title: "Foreign series: Missing episode",
            arteVerifiedVideoId: "123456-001-A",
          },
        ],
        300,
        10
      )
    ).toEqual([]);
  });
  it("accepts an exact title or verified-series prefix with a long-enough last segment", () => {
    expect(matchSonarrEpisodes(show, [item], 300, 10)).toMatchObject([
      { tvdbId: 123, episode: { seasonNumber: 2, episodeNumber: 3 } },
    ]);
    expect(
      matchSonarrEpisodes(show, [{ ...item, title: "Region: Missing episode" }], 300, 10)
    ).toHaveLength(1);
  });
  it.each([
    { topic: "Foreign series" },
    { title: "Foreign series: Missing episode" },
    { title: "Synthetic series: Missing episode (2025)" },
    { title: "Synthetic series: Missing episode (S01/E03)" },
    { title: "Synthetic series: Missing episode (S02/E04)" },
    { title: "Synthetic series: Missing episode Trailer" },
    { title: "Synthetic series: Missing episode (klare Sprache)" },
    { duration: NaN },
    { duration: 0 },
    { url_video: "https://example.invalid/video.m3u8" },
    { url_video: "https://example.invalid/video.mpd" },
    { url_video: "https://example.invalid/episode" },
    { url_video: "file:///private/media.mp4" },
    { url_video: "https://user:secret@example.invalid/media.mp4" },
  ])("rejects an unsafe candidate %j", (override) => {
    expect(matchSonarrEpisodes(show, [{ ...item, ...override }], 300, 10)).toEqual([]);
  });
  it("removes disallowed renditions individually and does not mutate the candidate", () => {
    const candidate = { ...item, url_video_hd: "https://example.invalid/video.m3u8" };
    expect(matchSonarrEpisodes(show, [candidate], 300, 10)[0].item.url_video_hd).toBe("");
    expect(candidate.url_video_hd).toContain("m3u8");
  });
  it("allows verified supplemental HLS only under the existing explicit HLS setting", () => {
    const candidate = { ...item, url_video: "https://example.invalid/video.m3u8" };
    expect(matchSonarrEpisodes(show, [candidate], 300, 10)).toEqual([]);
    const matched = matchSonarrEpisodes(show, [candidate], 300, 10, undefined, true);
    expect(matched).toHaveLength(1);
    expect(matched[0].item.url_video).toBe(candidate.url_video);
    expect(
      matchSonarrEpisodes(
        show,
        [{ ...candidate, url_video: "https://user:secret@example.invalid/video.m3u8" }],
        300,
        10,
        undefined,
        true
      )
    ).toEqual([]);
  });

  it("keeps accessibility variants subject to the existing language-evidence policy", () => {
    const accessible = { ...item, title: "Synthetic series: Missing episode (klare Sprache)" };
    expect(matchSonarrEpisodes(show, [accessible], 300, 10)).toEqual([]);
    expect(
      matchSonarrEpisodes(show, [{ ...accessible, audioLanguage: "deu" }], 300, 10)
    ).toHaveLength(1);
  });
  it("rejects conflicting and ambiguous coordinates rather than choosing a newest episode", () => {
    expect(
      matchSonarrEpisodes({ ...show, sonarrBlockedCoordinates: ["2:3"] }, [item], 300, 10)
    ).toEqual([]);
    expect(
      matchSonarrEpisodes(
        { ...show, episodes: [...show.episodes, { ...show.episodes[0], episodeNumber: 4 }] },
        [item],
        300,
        10
      )
    ).toEqual([]);
  });
});
