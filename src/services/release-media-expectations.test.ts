import { expect, it } from "vitest";
import type { ApiResultItem, TvdbEpisode } from "@/types";
import { releaseMediaExpectations } from "./release-media-expectations";
import { generateGenericRssItems, generateMovieRssItems, generateRssItems } from "./newznab";
import { decodeMediaExpectations } from "./nzb-release";

const source: ApiResultItem = {
  channel: "ARD",
  topic: "Synthetic",
  title: "Synthetic GERMAN 1080p",
  description: "Synthetic only",
  filmlisteTimestamp: 1700000000,
  duration: 120,
  size: 1000,
  url_website: "https://example.invalid/page",
  url_video: "https://example.invalid/media.mp4",
  url_video_low: "",
  url_video_hd: "",
};

it("uses seconds from catalogue and converts verified episode minutes exactly once", () => {
  expect(releaseMediaExpectations(source)).toEqual({
    version: 1,
    duration: { seconds: 120, provenance: "source_catalogue" },
    audio: null,
    resolution: null,
  });
  expect(releaseMediaExpectations(source, 3).duration).toEqual({
    seconds: 180,
    provenance: "episode_metadata",
  });
});

it.each([0, -1, NaN, Infinity])(
  "does not fabricate duration evidence from invalid seconds %s",
  (duration) => {
    expect(releaseMediaExpectations({ ...source, duration })).toEqual({
      version: 1,
      duration: null,
      audio: null,
      resolution: null,
    });
  }
);

it.each(["und", "und-Latn", "mul", "zxx", "not a code"])(
  "does not turn ambiguous language %s into an expectation",
  (audioLanguage) => {
    expect(releaseMediaExpectations({ ...source, audioLanguage }).audio).toBeNull();
  }
);

it.each([
  ["de-DE", "de"],
  ["deutsch", "de"],
  ["fra", "fr"],
  ["eng", "en"],
])("preserves explicit audio evidence %s as %s", (audioLanguage, language) => {
  expect(releaseMediaExpectations({ ...source, audioLanguage }).audio).toEqual({
    language,
    provenance: "provider_audio",
  });
});

it("all own RSS producer families include v1, even when every fact is unknown", () => {
  const item = { ...source, duration: 0 };
  const episode: TvdbEpisode = {
    name: "Episode",
    aired: null,
    runtime: null,
    seasonNumber: 1,
    episodeNumber: 1,
  };
  const releases = [
    ...generateGenericRssItems(item, "720p"),
    ...generateRssItems(
      { item, episode, showName: "Synthetic", matchedTitle: item.title, tvdbId: 7 },
      "720p"
    ),
    ...generateMovieRssItems(
      { item, score: 1, titleMatch: "exact", durationDiff: 0 },
      {
        tmdbId: 7,
        title: "Synthetic",
        germanTitle: "Synthetic",
        releaseDate: null,
        runtime: null,
        imdbId: null,
      },
      "720p"
    ),
  ];
  expect(releases.length).toBe(3);
  for (const release of releases) {
    const encoded = new URL(release.enclosure.url, "http://localhost").searchParams.get(
      "encodedExpectations"
    );
    expect(encoded).not.toBeNull();
    expect(decodeMediaExpectations(encoded!)).toEqual({
      version: 1,
      duration: null,
      audio: null,
      resolution: null,
    });
  }
});
