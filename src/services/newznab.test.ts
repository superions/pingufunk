import { describe, it, expect } from "vitest";
import {
  generateAttributes,
  getEmptyRssResult,
  serializeRss,
  convertItemsToRss,
  generateFakeNzb,
  getCapabilitiesXml,
  generateMovieRssItems,
  generateGenericRssItems,
  generateRssItems,
  getValidationRss,
  isMovieCategoryRequest,
  parseNewznabCategoryIds,
  parseEpisodeFromTitle,
} from "./newznab";
import type { NewznabItem, ApiResultItem, MatchedEpisodeInfo, TmdbMovieData } from "@/types";

it.each(["Example S02E12", "Example S02/E12", "Example S02E12E13"])(
  "recognizes source coordinates before an unknown-candidate fallback: %s",
  (title) => {
    expect(parseEpisodeFromTitle(title)).toMatchObject({
      season: 2,
      episodes: title.endsWith("E13") ? [12, 13] : [12],
    });
  }
);

describe("generateAttributes", () => {
  it("should generate category attributes", () => {
    const attrs = generateAttributes(null, ["5000", "5040"]);

    expect(attrs).toHaveLength(2);
    expect(attrs[0]).toEqual({ name: "category", value: "5000" });
    expect(attrs[1]).toEqual({ name: "category", value: "5040" });
  });

  it("should add season attribute when provided", () => {
    const attrs = generateAttributes("01", ["5000"]);

    expect(attrs).toHaveLength(2);
    expect(attrs[1]).toEqual({ name: "season", value: "01" });
  });

  it("should add tvdbid attribute when provided", () => {
    const attrs = generateAttributes(null, ["5000"], 12345);

    expect(attrs).toHaveLength(2);
    expect(attrs[1]).toEqual({ name: "tvdbid", value: "12345" });
  });

  it("should include all attributes when all params provided", () => {
    const attrs = generateAttributes("02", ["5000", "5040"], 99999);

    expect(attrs).toHaveLength(4);
    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "tvdbid")).toEqual({ name: "tvdbid", value: "99999" });
  });
});

describe("getEmptyRssResult", () => {
  it("should return empty RSS structure", () => {
    const result = getEmptyRssResult();

    expect(result.channel.title).toBe("RundfunkArr");
    expect(result.channel.response.offset).toBe(0);
    expect(result.channel.response.total).toBe(0);
    expect(result.channel.items).toEqual([]);
  });
});

describe("serializeRss", () => {
  it("should serialize empty RSS to valid XML", () => {
    const rss = getEmptyRssResult();
    const xml = serializeRss(rss);

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<rss");
    expect(xml).toContain("xmlns:newznab");
    expect(xml).toContain("<channel>");
    expect(xml).toContain("<title>RundfunkArr</title>");
  });

  it("should include newznab:response with offset and total", () => {
    const rss = getEmptyRssResult();
    const xml = serializeRss(rss);

    expect(xml).toContain("newznab:response");
    expect(xml).toContain('offset="0"');
    expect(xml).toContain('total="0"');
  });
});

describe("convertItemsToRss", () => {
  const mockItem: NewznabItem = {
    title: "Test.Show.S01E01.720p.WEB.h264-TEST",
    guid: { isPermaLink: true, value: "http://example.com/1" },
    link: "http://example.com/video.mp4",
    comments: "http://example.com/page",
    pubDate: "Mon, 01 Jan 2024 12:00:00 GMT",
    category: "TV > HD",
    description: "Test description",
    enclosure: {
      url: "/api/download?id=1",
      length: 1000000,
      type: "application/x-nzb",
    },
    attributes: [{ name: "category", value: "5040" }],
  };

  it("should convert items to RSS XML", () => {
    const xml = convertItemsToRss([mockItem], 100, 0);

    expect(xml).toContain("Test.Show.S01E01.720p.WEB.h264-TEST");
    expect(xml).toContain('total="1"');
  });

  it("should handle pagination with offset", () => {
    const items = [mockItem, { ...mockItem, title: "Second.Item" }];
    const xml = convertItemsToRss(items, 1, 1);

    expect(xml).toContain("Second.Item");
    expect(xml).not.toContain("Test.Show.S01E01");
    expect(xml).toContain('offset="1"');
    expect(xml).toContain('total="2"');
  });

  it("preserves the requested offset for an empty result page", () => {
    const xml = convertItemsToRss([], 100, 5);

    expect(xml).toContain('total="0"');
    expect(xml).toContain('offset="5"');
    expect(xml).not.toContain("<item>");
  });

  it("should respect limit parameter", () => {
    const items = Array(5)
      .fill(null)
      .map((_, i) => ({ ...mockItem, title: `Item${i}` }));
    const xml = convertItemsToRss(items, 2, 0);

    expect(xml).toContain("Item0");
    expect(xml).toContain("Item1");
    expect(xml).not.toContain("Item2");
  });
});

describe("Newznab validation categories", () => {
  it("parses unique numeric category IDs", () => {
    expect(parseNewznabCategoryIds("2040, 2030,2040,invalid")).toEqual(["2040", "2030"]);
  });

  it("detects movie categories using exact IDs", () => {
    expect(isMovieCategoryRequest(["2040"])).toBe(true);
    expect(isMovieCategoryRequest(["12000"])).toBe(false);
  });

  it("adds the movie parent category to a validation result", () => {
    const xml = getValidationRss(["2040"], new Date("2026-09-01T00:00:00Z"));

    expect(xml).toContain('name="category" value="2040"');
    expect(xml).toContain('name="category" value="2000"');
    expect(xml).not.toContain('name="category" value="5000"');
    expect(xml).not.toContain(".GERMAN.");
  });
});

describe("generateFakeNzb", () => {
  it("should generate valid NZB XML", () => {
    const nzb = generateFakeNzb({
      url: "http://example.com/video.mp4",
      title: "Test.Show.S01E01",
    });

    expect(nzb).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(nzb).toContain("<!DOCTYPE nzb");
    expect(nzb).toContain("<nzb");
  });

  it("should include URL in comment", () => {
    const url = "http://example.com/video.mp4";
    const nzb = generateFakeNzb({ url, title: "Test" });

    expect(nzb).toContain(`<!-- ${Buffer.from("Test").toString("base64")} -->`);
    expect(nzb).toContain(`<!-- ${Buffer.from(url).toString("base64")} -->`);
  });

  it("should include title in meta", () => {
    const title = "My.Show.S01E01.720p";
    const nzb = generateFakeNzb({ url: "http://example.com", title });

    expect(nzb).toContain(`<meta type="title">${title}</meta>`);
  });

  it("should include the base64-encoded URL comment", () => {
    const url = "http://example.com/test.mp4";
    const nzb = generateFakeNzb({ url, title: "Test" });
    const encoded = Buffer.from(url, "utf-8").toString("base64");

    expect(nzb).toContain(`<!-- ${encoded} -->`);
  });

  it("escapes display metadata while comments preserve the exact release title", () => {
    const title = `März & \"Heute\" <Finale>`;
    const nzb = generateFakeNzb({ url: "https://example.org/a--b?x=1&y=2", title });

    expect(nzb).toContain(`<!-- ${Buffer.from(title, "utf-8").toString("base64")} -->`);
    expect(nzb).toContain("März &amp; &quot;Heute&quot; &lt;Finale&gt;");
    expect(nzb).not.toContain("a--b");
  });

  it("keeps invalid XML control characters out of display metadata", () => {
    const title = "Example\u0001.Show";
    const nzb = generateFakeNzb({ url: "https://example.org/video.mp4", title });

    expect(nzb).not.toContain("\u0001");
    expect(nzb).toContain(`<!-- ${Buffer.from(title, "utf-8").toString("base64")} -->`);
  });
});

describe("getCapabilitiesXml", () => {
  it("should return valid capabilities XML", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain("<caps>");
  });

  it("should include server info", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('title="RundfunkArr"');
    expect(xml).toContain("German Public TV Indexer");
  });

  it("should include supported search types", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain("<searching>");
    expect(xml).toContain('available="yes"');
    expect(xml).toContain("tv-search");
    expect(xml).toContain("movie-search");
  });

  it("should include category definitions", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain('id="5000"');
    expect(xml).toContain('name="TV"');
    expect(xml).toContain('id="2000"');
    expect(xml).toContain('name="Movies"');
  });

  it("should indicate registration is not available", () => {
    const xml = getCapabilitiesXml();

    expect(xml).toContain("<registration");
    expect(xml).toContain('available="no"');
  });
});

describe("generateGenericRssItems", () => {
  const baseItem: ApiResultItem = {
    channel: "ARD",
    topic: "Beispielserie",
    title: "Folge 5: Der Anfang",
    description: "An example description",
    filmlisteTimestamp: 1700000000,
    duration: 2700,
    size: 1_000_000_000,
    url_website: "https://example.com/video",
    url_video: "https://example.com/video_720.mp4",
    url_video_low: "https://example.com/video_480.mp4",
    url_video_hd: "https://example.com/video_1080.mp4",
  };

  it("URL-encodes Base64 plus characters in generated download links", () => {
    const url = "https://example.org/~~~";
    const encoded = Buffer.from(url).toString("base64");
    expect(encoded).toContain("+");
    const [item] = generateGenericRssItems({ ...baseItem, url_video: url }, "720p");
    expect(new URL(item.enclosure.url, "http://localhost").searchParams.get("encodedUrl")).toBe(
      encoded
    );
  });

  it("emits one item per available quality with preference all", () => {
    const items = generateGenericRssItems(baseItem, "all");

    expect(items).toHaveLength(3);
    const guids = items.map((i) => i.guid.value);
    expect(guids.some((g) => /#1080p-[a-f0-9]{20}$/.test(g))).toBe(true);
    expect(guids.some((g) => /#720p-[a-f0-9]{20}$/.test(g))).toBe(true);
    expect(guids.some((g) => /#480p-[a-f0-9]{20}$/.test(g))).toBe(true);
  });

  it("picks only the highest quality with preference best", () => {
    const items = generateGenericRssItems(baseItem, "best");

    expect(items).toHaveLength(1);
    expect(items[0].guid.value).toMatch(/^https:\/\/example\.com\/video#1080p-[a-f0-9]{20}$/);
  });

  it("parses an episode-only title without inventing a season", () => {
    const items = generateGenericRssItems(baseItem, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toBeUndefined();
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "05" });
    expect(items[0].title).not.toContain("S01E05");
  });

  it("parses explicit S<season>/E<episode> titles", () => {
    const items = generateGenericRssItems({ ...baseItem, title: "Tolle Folge (S02/E03)" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "03" });
  });

  it("still emits a generic item when no episode info is present", () => {
    const items = generateGenericRssItems(
      { ...baseItem, title: "Reportage without a number" },
      "best"
    );

    expect(items).toHaveLength(1);
    expect(items[0].attributes.find((a) => a.name === "episode")).toBeUndefined();
    expect(items[0].attributes.some((a) => a.name === "category")).toBe(true);
  });
});

describe("generateGenericRssItems - edge cases", () => {
  const base: ApiResultItem = {
    channel: "ARD",
    topic: "Beispielserie",
    title: "",
    description: "An example description",
    filmlisteTimestamp: 1700000000,
    duration: 2700,
    size: 1_000_000_000,
    url_website: "https://example.com/video",
    url_video: "https://example.com/video_720.mp4",
    url_video_low: "https://example.com/video_480.mp4",
    url_video_hd: "https://example.com/video_1080.mp4",
  };

  it("keeps episode 0 and does not let later patterns overwrite it", () => {
    const items = generateGenericRssItems({ ...base, title: "Folge 0 (2/6)" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "00" });
    expect(attrs.find((a) => a.name === "season")).toBeUndefined();
    expect(items[0].title).not.toContain("S01E00");
  });

  it("parses Staffel N Folge N", () => {
    const items = generateGenericRssItems({ ...base, title: "Staffel 2 Folge 3" }, "best");
    const attrs = items[0].attributes;

    expect(attrs.find((a) => a.name === "season")).toEqual({ name: "season", value: "02" });
    expect(attrs.find((a) => a.name === "episode")).toEqual({ name: "episode", value: "03" });
  });

  it("emits only the available quality variant", () => {
    const only720 = { ...base, title: "Some show", url_video_hd: "", url_video_low: "" };
    const items = generateGenericRssItems(only720, "all");

    expect(items).toHaveLength(1);
    expect(items[0].guid.value).toMatch(/^https:\/\/example\.com\/video#720p-[a-f0-9]{20}$/);
  });
});

describe("P01.1 explicit episode coordinates", () => {
  const base: ApiResultItem = {
    channel: "ARD",
    topic: "Example Show",
    title: "",
    description: "Synthetic coordinate input",
    filmlisteTimestamp: 1_700_000_000,
    duration: 2700,
    size: 1_000_000_000,
    url_website: "https://example.org/show/episode-2",
    url_video: "https://example.org/episode-2-720.mp4",
    url_video_low: "",
    url_video_hd: "",
  };

  it.each(["Staffel", "Season", "Saison", "Temporada", "Stagione"])(
    "keeps explicit %s 2 (2/6) as season 2 in release, attributes, and encodedTitle",
    (seasonLabel) => {
      const [item] = generateGenericRssItems(
        { ...base, title: `Example - ${seasonLabel} 2 (2/6)` },
        "720p"
      );
      const encodedTitle = new URL(item.enclosure.url, "http://localhost").searchParams.get(
        "encodedTitle"
      );

      expect(item.title).toContain("Example.Show.S02E02");
      expect(item.attributes.find((attribute) => attribute.name === "season")).toEqual({
        name: "season",
        value: "02",
      });
      expect(item.attributes.find((attribute) => attribute.name === "episode")).toEqual({
        name: "episode",
        value: "02",
      });
      expect(encodedTitle).toBe(Buffer.from(item.title, "utf-8").toString("base64"));
      expect(Buffer.from(encodedTitle!, "base64").toString("utf-8")).toBe(item.title);
    }
  );

  it.each([
    ["Reportage (2/6)", "02"],
    ["Folge 5: Der Anfang", "05"],
  ])("does not invent season 1 for ambiguous title %s", (title, expectedEpisode) => {
    const [item] = generateGenericRssItems({ ...base, title }, "720p");

    expect(item.title).not.toMatch(/\.S01E\d+/);
    expect(item.attributes.find((attribute) => attribute.name === "season")).toBeUndefined();
    expect(item.attributes.find((attribute) => attribute.name === "episode")).toEqual({
      name: "episode",
      value: expectedEpisode,
    });
  });

  it("keeps the complete multi-episode coordinate in release and encodedTitle", () => {
    const [item] = generateGenericRssItems({ ...base, title: "Example S02/E12E13" }, "720p");
    const encodedTitle = new URL(item.enclosure.url, "http://localhost").searchParams.get(
      "encodedTitle"
    );

    expect(item.title).toContain("Example.Show.S02E12E13");
    expect(item.attributes.find((attribute) => attribute.name === "season")).toEqual({
      name: "season",
      value: "02",
    });
    expect(item.attributes.find((attribute) => attribute.name === "episode")).toEqual({
      name: "episode",
      value: "12",
    });
    expect(Buffer.from(encodedTitle!, "base64").toString("utf-8")).toBe(item.title);
  });

  it("keeps source seasons above 99 in explicit S/E coordinates", () => {
    const [item] = generateGenericRssItems({ ...base, title: "Example (S2026/E02)" }, "720p");

    expect(item.title).toContain("Example.Show.S2026E02");
    expect(item.attributes.find((attribute) => attribute.name === "season")).toEqual({
      name: "season",
      value: "2026",
    });
    expect(item.attributes.find((attribute) => attribute.name === "episode")).toEqual({
      name: "episode",
      value: "02",
    });
  });

  it("preserves seasons above 99 and the daily release for year-based episodes", () => {
    const info: MatchedEpisodeInfo = {
      episode: {
        name: "Heute",
        aired: new Date("2026-09-01T00:00:00Z"),
        runtime: 30,
        seasonNumber: 2026,
        episodeNumber: 12,
      },
      item: { ...base, title: "Heute" },
      showName: "Tagesschau",
      matchedTitle: "Tagesschau",
      tvdbId: 12345,
    };
    const items = generateRssItems(info, "720p");

    expect(items).toHaveLength(2);
    expect(items[0].title).toContain("Tagesschau.S2026E12");
    expect(items[1].title).toContain("Tagesschau.2026-09-01");
    expect(
      items.map((item) => {
        const encodedTitle = new URL(item.enclosure.url, "http://localhost").searchParams.get(
          "encodedTitle"
        );
        return Buffer.from(encodedTitle!, "base64").toString("utf-8");
      })
    ).toEqual(items.map((item) => item.title));
    expect(
      items.every((item) =>
        item.attributes.some(
          (attribute) => attribute.name === "season" && attribute.value === "2026"
        )
      )
    ).toBe(true);
  });
});

describe("P00 historical release characterizations", () => {
  it("fixes A2: a neutral ARTE.FR legacy release is visible without a false GERMAN label", () => {
    const [item] = generateGenericRssItems(
      {
        channel: "ARTE.FR",
        topic: "Example Show",
        title: "Example episode GERMAN",
        description: "Synthetic unverified language characterization input",
        filmlisteTimestamp: 1_700_000_000,
        duration: 2700,
        size: 1_000_000_000,
        url_website: "https://www.arte.tv/fr/videos/example",
        url_video: "https://example.org/example-720.mp4",
        url_video_low: "",
        url_video_hd: "",
      },
      "720p"
    );

    expect(item.title).not.toMatch(/(?:^|\.)GERMAN(?:\.|$)/);
    expect(item.comments).toContain("/fr/videos/");
  });

  it("fixes A3: distinct same-quality source renditions receive distinct stable GUIDs", () => {
    const source = {
      channel: "ARD",
      topic: "Example Show",
      title: "Example episode",
      description: "Synthetic rendition characterization input",
      filmlisteTimestamp: 1_700_000_000,
      duration: 2700,
      size: 1_000_000_000,
      url_website: "https://example.org/show/episode-1",
      url_video: "https://example.org/edition-a-720.mp4",
      url_video_low: "",
      url_video_hd: "",
    };
    const [firstEdition] = generateGenericRssItems(source, "720p");
    const [secondEdition] = generateGenericRssItems(
      { ...source, url_video: "https://example.org/edition-b-720.mp4" },
      "720p"
    );

    expect(firstEdition.link).not.toBe(secondEdition.link);
    expect(firstEdition.guid).not.toEqual(secondEdition.guid);
    expect(generateGenericRssItems(source, "720p")[0].guid).toEqual(firstEdition.guid);
  });

  it("carries proven audio language through RSS and its encoded fake NZB title", () => {
    const [item] = generateGenericRssItems(
      {
        channel: "ARD",
        topic: "Example Show",
        title: "Example episode",
        description: "Synthetic German audio evidence",
        filmlisteTimestamp: 1_700_000_000,
        duration: 2700,
        size: 1_000_000_000,
        audioLanguage: "de",
        url_website: "https://example.org/show/episode-1",
        url_video: "https://example.org/episode-720.mp4",
        url_video_low: "",
        url_video_hd: "",
      },
      "720p"
    );
    const encodedTitle = new URL(item.enclosure.url, "http://localhost").searchParams.get(
      "encodedTitle"
    );

    expect(item.title).toContain("GERMAN");
    expect(Buffer.from(encodedTitle!, "base64").toString("utf-8")).toBe(item.title);
  });

  it("normalizes original-audio and subtitle source markers into neutral release tokens", () => {
    const [item] = generateGenericRssItems(
      {
        channel: "ARTE.FR",
        topic: "Example Show",
        title: "Example episode (OV, deutsche Untertitel)",
        description: "Synthetic OV subtitle edition",
        filmlisteTimestamp: 1_700_000_000,
        duration: 2700,
        size: 1_000_000_000,
        url_website: "https://www.arte.tv/fr/videos/123456/example",
        url_video: "https://example.org/episode-720.mp4",
        url_video_low: "",
        url_video_hd: "",
      },
      "720p"
    );

    expect(item.title).toContain(".OV.SUBBED.UNKNOWN");
    expect(item.title).not.toContain("GERMAN");
    expect(item.title).not.toContain("deutsche.Untertitel");
  });

  it("applies the same evidence rule to matched TV and movie RSS producers", () => {
    const item: ApiResultItem = {
      channel: "ARD",
      topic: "Example Show",
      title: "Example episode",
      description: "Synthetic RSS item",
      filmlisteTimestamp: 1_700_000_000,
      duration: 2700,
      size: 1_000_000_000,
      url_website: "https://example.org/example",
      url_video: "https://example.org/example-720.mp4",
      url_video_low: "",
      url_video_hd: "",
    };
    const movieData: TmdbMovieData = {
      tmdbId: 123,
      imdbId: null,
      title: "Example Movie",
      germanTitle: "Example Movie",
      runtime: 60,
      releaseDate: "2024-01-01",
    };
    const episodeInfo: MatchedEpisodeInfo = {
      episode: {
        name: "Episode",
        aired: new Date("2024-01-01T00:00:00Z"),
        runtime: 45,
        seasonNumber: 1,
        episodeNumber: 1,
      },
      item,
      showName: "Example Show",
      matchedTitle: "Example Show",
      tvdbId: 123,
    };
    const movieMatch = { item, score: 100, titleMatch: "exact" as const, durationDiff: 0 };
    const neutralTv = generateRssItems(episodeInfo, "720p")[0];
    const neutralMovie = generateMovieRssItems(movieMatch, movieData, "720p")[0];
    const provenItem = { ...item, audioLanguage: "de" };
    const germanTv = generateRssItems({ ...episodeInfo, item: provenItem }, "720p")[0];
    const germanMovie = generateMovieRssItems(
      { ...movieMatch, item: provenItem },
      movieData,
      "720p"
    )[0];

    expect(neutralTv.title).not.toContain("GERMAN");
    expect(neutralMovie.title).not.toContain("GERMAN");
    expect(germanTv.title).toContain("GERMAN");
    expect(germanMovie.title).toContain("GERMAN");
  });

  it("keeps 720p and 1080p as separate GUID identities", () => {
    const items = generateGenericRssItems(
      {
        channel: "ARD",
        topic: "Example Show",
        title: "Example episode",
        description: "Synthetic multi-quality input",
        filmlisteTimestamp: 1_700_000_000,
        duration: 2700,
        size: 1_000_000_000,
        url_website: "https://example.org/show/episode-1",
        url_video: "https://example.org/episode-720.mp4",
        url_video_low: "https://example.org/episode-480.mp4",
        url_video_hd: "https://example.org/episode-1080.mp4",
        sourceVideoDimensions: [
          { url: "https://example.org/episode-720.mp4", width: 1280, height: 720 },
          { url: "https://example.org/episode-1080.mp4", width: 1920, height: 1080 },
        ],
      },
      "all"
    );

    expect(items.map((item) => item.title)).toEqual(
      expect.arrayContaining([expect.stringContaining("720p"), expect.stringContaining("1080p")])
    );
    expect(new Set(items.map((item) => item.guid.value)).size).toBe(items.length);
  });

  it("keeps distinct source editions separate when URL and quality are the same", () => {
    const source: ApiResultItem = {
      channel: "ARTE.FR",
      topic: "Example Show",
      title: "Example episode (OV, deutsche Untertitel)",
      description: "Synthetic source variants",
      filmlisteTimestamp: 1_700_000_000,
      duration: 2700,
      size: 1_000_000_000,
      url_website: "https://www.arte.tv/fr/videos/123456-001-A/example/",
      url_video: "https://cdn.example.org/example.mp4",
      url_video_low: "",
      url_video_hd: "",
    };
    const [subtitleEdition] = generateGenericRssItems(source, "720p");
    const [germanAudioEdition] = generateGenericRssItems(
      { ...source, audioLanguage: "de" },
      "720p"
    );

    expect(subtitleEdition.link).toBe(germanAudioEdition.link);
    expect(subtitleEdition.guid).not.toEqual(germanAudioEdition.guid);
    expect(subtitleEdition.title).not.toContain("GERMAN");
    expect(germanAudioEdition.title).toContain("GERMAN");
  });
});

describe("RSS rendition eligibility", () => {
  const item: ApiResultItem = {
    channel: "ARD",
    topic: "Example Show",
    title: "Example Show (S02/E03)",
    description: "Synthetic mixed renditions",
    filmlisteTimestamp: 1_700_000_000,
    duration: 3600,
    size: 1_000_000_000,
    url_website: "https://example.org/show/episode-3",
    url_video: "https://example.org/720.m3u8",
    url_video_low: "https://example.org/480.m3u8",
    url_video_hd: "https://example.org/progressive-hd.mp4",
  };

  const episodeInfo: MatchedEpisodeInfo = {
    episode: {
      name: "Episode 3",
      aired: new Date("2024-01-08T00:00:00Z"),
      runtime: 45,
      seasonNumber: 2,
      episodeNumber: 3,
    },
    item,
    showName: "Example Show",
    matchedTitle: "Example Show",
    tvdbId: 12345,
  };

  const movieData: TmdbMovieData = {
    tmdbId: 123,
    imdbId: null,
    title: "Example Movie",
    germanTitle: "Example Movie",
    runtime: 60,
    releaseDate: "2024-01-01",
  };

  it("filters each TV, movie, and generic rendition when HLS is disabled", () => {
    const tvItems = generateRssItems(episodeInfo, "all", false);
    const movieItems = generateMovieRssItems(
      { item, score: 100, titleMatch: "exact", durationDiff: 0 },
      movieData,
      "all",
      false
    );
    const genericItems = generateGenericRssItems(item, "all", false);

    expect(tvItems.map((rssItem) => rssItem.link)).toEqual([
      "https://example.org/progressive-hd.mp4",
    ]);
    expect(movieItems.map((rssItem) => rssItem.link)).toEqual([
      "https://example.org/progressive-hd.mp4",
    ]);
    expect(genericItems.map((rssItem) => rssItem.link)).toEqual([
      "https://example.org/progressive-hd.mp4",
    ]);
  });

  it("preserves every available rendition when HLS is enabled", () => {
    const tvItems = generateRssItems(episodeInfo, "all", true);
    const movieItems = generateMovieRssItems(
      { item, score: 100, titleMatch: "exact", durationDiff: 0 },
      movieData,
      "all",
      true
    );
    const genericItems = generateGenericRssItems(item, "all", true);
    const expectedLinks = [
      "https://example.org/progressive-hd.mp4",
      "https://example.org/720.m3u8",
      "https://example.org/480.m3u8",
    ];

    expect(tvItems.map((rssItem) => rssItem.link)).toEqual(expectedLinks);
    expect(movieItems.map((rssItem) => rssItem.link)).toEqual(expectedLinks);
    expect(genericItems.map((rssItem) => rssItem.link)).toEqual(expectedLinks);
  });

  it("keeps stable SRF references unchanged when HLS is enabled", () => {
    const srfUrl =
      "https://www.srf.ch/play/tv/redirect/detail/11111111-1111-4111-8111-111111111111";
    const srfItem = { ...item, url_video: srfUrl, url_video_low: "", url_video_hd: "" };

    expect(generateGenericRssItems(srfItem, "all", false)).toHaveLength(0);
    expect(generateGenericRssItems(srfItem, "all", true).map((rssItem) => rssItem.link)).toEqual([
      srfUrl,
    ]);
  });
});
