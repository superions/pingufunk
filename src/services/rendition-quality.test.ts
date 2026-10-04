import { describe, expect, it } from "vitest";
import type { ApiResultItem, MatchedEpisodeInfo } from "@/types";
import { renditionDimensions, selectRenditions } from "./rendition-quality";
import {
  buildReleaseGuid,
  generateGenericRssItems,
  generateMovieRssItems,
  generateRssItems,
} from "./newznab";
import { decodeMediaExpectations, generateFakeNzb } from "./nzb-release";
import { parseNzbContent } from "./download";
import { validateMediaProbe } from "@/server/media-probe";

const item: ApiResultItem = {
  channel: "ARTE.DE",
  topic: "Synthetic",
  title: "Synthetic Film",
  description: "",
  filmlisteTimestamp: 1700000000,
  duration: 7200,
  size: 1000,
  url_website: "https://www.arte.tv/de/videos/123456-001-A/synthetic/",
  url_video: "https://fixture.akamaized.net/standard.mp4",
  url_video_hd: "https://fixture.akamaized.net/hd.mp4",
  url_video_low: "",
  audioLanguage: "de",
  sourceVideoDimensions: [
    { url: "https://fixture.akamaized.net/hd.mp4", width: 1280, height: 720 },
    { url: "https://fixture.akamaized.net/standard.mp4", width: 1920, height: 1080 },
  ],
};
const movie = {
  tmdbId: 7,
  title: item.title,
  germanTitle: item.title,
  productionYear: 2020,
  runtime: 120,
  imdbId: null,
  releaseDate: null,
};
const episode: MatchedEpisodeInfo = {
  item,
  showName: "Synthetic",
  matchedTitle: "Synthetic",
  tvdbId: 7,
  episode: { name: "Episode", aired: null, runtime: 120, seasonNumber: 1, episodeNumber: 1 },
};

describe("rendition resolution, not catalogue slot quality", () => {
  it("selects measured quality before best/preference and retains independent URLs", () => {
    expect(selectRenditions(item, "720p", false).map((r) => r.url)).toEqual([item.url_video_hd]);
    expect(selectRenditions(item, "1080p", false).map((r) => r.url)).toEqual([item.url_video]);
    expect(selectRenditions(item, "best", false)[0].url).toBe(item.url_video);
    expect(selectRenditions(item, "all", false)).toHaveLength(2);
  });
  it.each([
    undefined,
    [],
    [{ url: item.url_video_hd + "?other=1", width: 1280, height: 720 }],
    [{ url: item.url_video_hd, width: 0, height: 720 }],
    [{ url: item.url_video_hd, width: 1280, height: 720.5 }],
    [
      { url: item.url_video_hd, width: 1280, height: 720 },
      { url: item.url_video_hd, width: 1920, height: 1080 },
    ],
  ])(
    "does not manufacture dimensions for missing/invalid/conflicting declarations %j",
    (evidence) => {
      const source = { ...item, url_video: "", sourceVideoDimensions: evidence };
      expect(renditionDimensions(source, item.url_video_hd)).toBeNull();
      const [release] = generateGenericRssItems(source, "all");
      expect(release.title).toContain(".GERMAN.UNKNOWN.");
      expect(release.title).not.toMatch(/(?:480|720|1080)p/);
      expect(release.title).not.toContain(".WEB.");
      expect(release.attributes.filter((a) => a.name === "category").map((a) => a.value)).toEqual([
        "5000",
      ]);
      expect(
        decodeMediaExpectations(
          new URL(release.enclosure.url, "http://localhost").searchParams.get(
            "encodedExpectations"
          )!
        ).resolution
      ).toBeNull();
    }
  );
  it("keeps selection hints for unknown sources without publishing their old resolution label", () => {
    const source = { ...item, sourceVideoDimensions: undefined };
    expect(selectRenditions(source, "1080p", false)[0]).toMatchObject({
      url: item.url_video_hd,
      quality: "UNKNOWN",
    });
  });
  it("does not inherit a source-title resolution or change a shipped GUID when evidence appears", () => {
    const source = {
      ...item,
      topic: "Synthetic 1920x1080",
      title: "Synthetic Film 1080p",
      sourceVideoDimensions: undefined,
    };
    const [unknown] = generateGenericRssItems(source, "1080p", false, "movie");
    const [proved] = generateGenericRssItems(
      { ...source, sourceVideoDimensions: item.sourceVideoDimensions },
      "720p",
      false,
      "movie"
    );
    expect(unknown.title).toContain("UNKNOWN.h264");
    expect(unknown.title).not.toMatch(/1080|1920x1080|\.WEB\./);
    expect(proved.title).toContain(".720p.WEB.");
    expect(proved.title).not.toContain("1080");
    expect(proved.guid).toEqual(unknown.guid);
  });
  it("keeps unsupported dimensions as worker facts without guessing a scene-resolution label", () => {
    const source = {
      ...item,
      url_video: "",
      sourceVideoDimensions: [{ url: item.url_video_hd, width: 1920, height: 800 }],
    };
    const [release] = generateGenericRssItems(source, "all");
    expect(release.title).toContain("UNKNOWN.h264");
    expect(
      decodeMediaExpectations(
        new URL(release.enclosure.url, "http://localhost").searchParams.get("encodedExpectations")!
      ).resolution
    ).toEqual({ width: 1920, height: 800, provenance: "provider_dimensions" });
  });
  it("does not double-publish one URL or bypass HLS opt-in", () => {
    expect(selectRenditions({ ...item, url_video: item.url_video_hd }, "all", false)).toHaveLength(
      1
    );
    expect(
      selectRenditions(
        { ...item, url_video: item.url_video_hd, sourceVideoDimensions: undefined },
        "720p",
        false
      )[0]
    ).toMatchObject({ url: item.url_video_hd, quality: "UNKNOWN", identity: "720p" });
    const source = { ...item, url_video: "", url_video_hd: "https://example.invalid/stream.m3u8" };
    expect(selectRenditions(source, "all", false)).toEqual([]);
    expect(selectRenditions(source, "all", true)[0].quality).toBe("UNKNOWN");
  });
  it.each(["generic", "movie", "tv"])(
    "keeps %s RSS/NZB/worker dimensions and shipped GUID identity consistent",
    (kind) => {
      const [release] =
        kind === "generic"
          ? generateGenericRssItems(item, "720p", false, "movie")
          : kind === "movie"
            ? generateMovieRssItems(
                { item, score: 1, titleMatch: "exact", durationDiff: 0 },
                movie,
                "720p"
              )
            : generateRssItems(episode, "720p");
      expect(release.title).toContain(".GERMAN.720p.");
      expect(release.title).not.toContain("1080p");
      expect(release.link).toBe(item.url_video_hd);
      expect(release.guid.value).toBe(
        buildReleaseGuid(
          item,
          "1080p",
          item.url_video_hd,
          kind === "tv" ? "tvdb:7:S1E1:standard" : "candidate:movie"
        )
      );
      const expected = decodeMediaExpectations(
        new URL(release.enclosure.url, "http://localhost").searchParams.get("encodedExpectations")!
      );
      expect(expected.resolution).toEqual({
        width: 1280,
        height: 720,
        provenance: "provider_dimensions",
      });
      expect(
        parseNzbContent(
          generateFakeNzb({ title: release.title, url: release.link, mediaExpectations: expected })
        )?.mediaExpectations
      ).toEqual(expected);
      const probe = (width: number, height: number) => ({
        format: { format_name: "matroska", duration: "7200" },
        streams: [
          { codec_type: "video", codec_name: "h264", width, height },
          {
            codec_type: "audio",
            codec_name: "aac",
            channels: 2,
            sample_rate: "48000",
            tags: { language: "deu" },
          },
        ],
      });
      expect(validateMediaProbe(probe(1280, 720), expected, 10).expectedChecks.resolution).toBe(
        "passed"
      );
      expect(() => validateMediaProbe(probe(1920, 1080), expected, 10)).toThrow(
        "Local media validation failed"
      );
      expect(() => validateMediaProbe(probe(1920, 720), expected, 10)).toThrow(
        "Local media validation failed"
      );
    }
  );
});
