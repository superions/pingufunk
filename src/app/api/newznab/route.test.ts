import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import type { ApiResultItem, TvSearchContext } from "@/types";
import { convertItemsToRss, generateGenericRssItems, generateRssItems } from "@/services/newznab";
import { parseNzbContent } from "@/services/download";
import { GET as downloadNzb } from "./fake_nzb_download/route";
import { GET as GETApiAlias } from "./api/route";

const mediathekMocks = vi.hoisted(() => ({
  fetchSearchResultsById: vi.fn(),
  fetchSearchResultsByString: vi.fn(),
  fetchSearchResultsForRssSync: vi.fn(),
  fetchMovieSearchResults: vi.fn(),
  fetchMovieSearchByQuery: vi.fn(),
  fetchMovieSearchForRssSync: vi.fn(),
}));
const showMocks = vi.hoisted(() => ({
  getShowInfoByTvdbId: vi.fn(),
}));
const tmdbMocks = vi.hoisted(() => ({
  getMovieInfoByTmdbId: vi.fn(),
  getMovieInfoByImdbId: vi.fn(),
}));
const radarrMocks = vi.hoisted(() => ({ getRadarrMovie: vi.fn() }));
const downloadMocks = vi.hoisted(() => ({ addToQueue: vi.fn() }));

vi.mock("@/services/mediathek", () => mediathekMocks);
vi.mock("@/services/shows", () => showMocks);
vi.mock("@/services/tmdb", () => tmdbMocks);
vi.mock("@/services/radarr-provider", () => radarrMocks);
vi.mock("@/services/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/download")>();
  return { ...actual, addToQueue: downloadMocks.addToQueue };
});

import { GET } from "./route";
import { POST as addToQueue } from "../route";

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel><newznab:response offset="0" total="0"/></channel>
</rss>`;

beforeEach(() => {
  vi.clearAllMocks();
  radarrMocks.getRadarrMovie.mockResolvedValue(null);
  tmdbMocks.getMovieInfoByTmdbId.mockResolvedValue(null);
  tmdbMocks.getMovieInfoByImdbId.mockResolvedValue(null);
  mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(EMPTY_RSS);
  mediathekMocks.fetchMovieSearchForRssSync.mockResolvedValue(EMPTY_RSS);
  downloadMocks.addToQueue.mockResolvedValue({ id: "synthetic-queue-item" });
});

it.each([
  "limit=-1",
  "limit=0",
  "limit=5001",
  "limit=10junk",
  "limit=NaN",
  "limit=1&limit=1",
  "offset=-1",
  "offset=1junk",
  "offset=2147483648",
  "offset=0&offset=0",
  "t=movie&t=tvsearch",
])("rejects ambiguous or unsupported pagination before provider work: %s", async (parameters) => {
  const response = await GET(
    new NextRequest(
      "http://localhost/api/newznab?" +
        (parameters.startsWith("t=") ? parameters : "t=movie&" + parameters)
    )
  );
  expect(response.status).toBe(400);
  expect(radarrMocks.getRadarrMovie).not.toHaveBeenCalled();
  expect(mediathekMocks.fetchMovieSearchForRssSync).not.toHaveBeenCalled();
});

describe("one movie contract for direct and forwarded indexer requests", () => {
  const movie = {
    tmdbId: 42,
    imdbId: "tt0000042",
    title: "Original Film",
    germanTitle: "Beispielfilm",
    productionYear: 1998,
    releaseDate: null,
    runtime: 90,
  };

  it.each(["movie", "search&cat=2000"])(
    "resolves the search goal on the same budget: %s",
    async (type) => {
      radarrMocks.getRadarrMovie.mockResolvedValue(movie);
      mediathekMocks.fetchMovieSearchResults.mockResolvedValue(EMPTY_RSS);
      const response = await GETApiAlias(
        new NextRequest(
          "http://localhost/api/newznab/api?t=" +
            type +
            "&tmdbid=42&imdbid=0000042&q=Beispielfilm+1998"
        )
      );
      expect(response.status).toBe(200);
      const budget = radarrMocks.getRadarrMovie.mock.calls[0][2];
      expect(mediathekMocks.fetchMovieSearchResults).toHaveBeenCalledWith(movie, 100, 0, budget);
      expect(tmdbMocks.getMovieInfoByTmdbId).not.toHaveBeenCalled();
      expect(await response.text()).toBe(EMPTY_RSS);
    }
  );

  it("does not search after a metadata/query identity conflict", async () => {
    radarrMocks.getRadarrMovie.mockResolvedValue(movie);
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42&q=Foreign+Film")
    );
    expect(response.status).toBe(400);
    expect(mediathekMocks.fetchMovieSearchResults).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchMovieSearchByQuery).not.toHaveBeenCalled();
  });

  it("does not camouflage an enabled integration outage as successful empty RSS", async () => {
    radarrMocks.getRadarrMovie.mockRejectedValue(new Error("synthetic private detail"));
    const response = await GET(new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private detail");
    expect(tmdbMocks.getMovieInfoByTmdbId).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchMovieSearchByQuery).not.toHaveBeenCalled();
  });

  it("preserves offset when an ID cannot be resolved without any configured metadata", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42&offset=7")
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('offset="7" total="0"');
    expect(mediathekMocks.fetchMovieSearchByQuery).not.toHaveBeenCalled();
  });

  it("continues an independent text search after an optional lookup fails without resetting budget", async () => {
    radarrMocks.getRadarrMovie.mockRejectedValue(new Error("synthetic failure"));
    mediathekMocks.fetchMovieSearchByQuery.mockResolvedValue(EMPTY_RSS);
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=movie&tmdbid=42&q=Beispielfilm+1998")
    );
    const budget = radarrMocks.getRadarrMovie.mock.calls[0][2];
    expect(response.status).toBe(200);
    expect(mediathekMocks.fetchMovieSearchByQuery).toHaveBeenCalledWith(
      "Beispielfilm 1998",
      100,
      0,
      budget
    );
    expect(tmdbMocks.getMovieInfoByTmdbId).not.toHaveBeenCalled();
  });

  it("round-trips the same honest candidate through both paths, RSS, NZB and the queue parser", async () => {
    const source: ApiResultItem = {
      channel: "Synthetic Channel",
      topic: "Filmreihe",
      title: "Original Film",
      description: "No verified production year or language",
      filmlisteTimestamp: 1_700_000_000,
      duration: 5400,
      size: 1_000_000_000,
      url_website: "https://example.org/film",
      url_video: "https://example.org/film.mp4?quality=720p",
      url_video_low: "",
      url_video_hd: "",
    };
    const [release] = generateGenericRssItems(source, "720p", false, "movie");
    const rss = convertItemsToRss([release], 100, 0);
    mediathekMocks.fetchMovieSearchByQuery.mockResolvedValue(rss);
    const direct = await GET(
      new NextRequest("http://localhost/api/newznab?t=movie&q=Original+Film+1998")
    );
    const forwarded = await GETApiAlias(
      new NextRequest("http://localhost/api/newznab/api?t=search&cat=2000&q=Original+Film+1998")
    );
    expect(await direct.text()).toBe(await forwarded.text());
    expect(release.title).toContain("Original.Film");
    expect(release.title).not.toMatch(/1998|2023|GERMAN/);
    expect(release.attributes.map((attribute) => attribute.name)).not.toContain("tmdbid");
    expect(release.attributes.map((attribute) => attribute.name)).not.toContain("imdbid");
    const parsed = await parseStringPromise(rss);
    const enclosureUrl = parsed.rss.channel[0].item[0].enclosure[0].$.url;
    const nzbResponse = await downloadNzb(
      new NextRequest(new URL(enclosureUrl, "http://localhost"))
    );
    const content = await nzbResponse.text();
    const mediaExpectations = {
      version: 1,
      duration: { seconds: 5400, provenance: "source_catalogue" },
      audio: null,
      resolution: null,
    };
    expect(parseNzbContent(content)).toEqual({
      title: release.title,
      url: source.url_video,
      mediaExpectations,
    });
    const queued = await addToQueue(
      new NextRequest("http://localhost/api?mode=addfile&cat=radarr", {
        method: "POST",
        body: content,
      })
    );
    expect(queued.status).toBe(200);
    expect(downloadMocks.addToQueue).toHaveBeenCalledWith(
      source.url_video,
      release.title,
      "radarr",
      mediaExpectations
    );
  });
});

describe("Newznab indexer validation", () => {
  it("normalizes ep/episode aliases into one TV search context", async () => {
    const show = {
      id: 12345,
      name: "Example Show",
      germanName: "Beispielserie",
      aliases: [],
      episodes: [],
    };
    showMocks.getShowInfoByTvdbId.mockResolvedValue(show);
    mediathekMocks.fetchSearchResultsById.mockResolvedValue(EMPTY_RSS);

    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=tvsearch&tvdbid=12345&season=02&ep=2&episode=02&limit=25&offset=5"
      )
    );

    expect(response.status).toBe(200);
    const budget = showMocks.getShowInfoByTvdbId.mock.calls[0][1];
    expect(budget.remainingAttempts).toBe(32);
    expect(showMocks.getShowInfoByTvdbId).toHaveBeenCalledWith(12345, budget);
    expect(mediathekMocks.fetchSearchResultsById).toHaveBeenCalledWith(
      show,
      { query: null, tvdbId: 12345, season: "2", episode: "2" },
      25,
      5,
      budget
    );
    expect(await response.text()).toBe(EMPTY_RSS);
  });

  it("rejects conflicting ep and episode aliases before searching", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&q=Example&ep=12&episode=13")
    );

    expect(response.status).toBe(400);
    expect(mediathekMocks.fetchSearchResultsById).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchSearchResultsByString).not.toHaveBeenCalled();
  });

  it("rejects invalid TVDB identities before searching", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&q=Example&tvdbid=12x")
    );

    expect(response.status).toBe(400);
    expect(showMocks.getShowInfoByTvdbId).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchSearchResultsById).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchSearchResultsByString).not.toHaveBeenCalled();
  });

  it("uses the /api alias and keeps ID and coordinates in a text fallback", async () => {
    const context: TvSearchContext = {
      query: "Example Show",
      tvdbId: 12345,
      season: "2026",
      episode: "9/28",
    };
    showMocks.getShowInfoByTvdbId.mockResolvedValue(null);
    mediathekMocks.fetchSearchResultsByString.mockResolvedValue(EMPTY_RSS);

    const response = await GETApiAlias(
      new NextRequest(
        "http://localhost/api/newznab/api?t=tvsearch&tvdbid=12345&q=Example%20Show&season=2026&ep=09%2F28&episode=9%2F28"
      )
    );

    expect(response.status).toBe(200);
    expect(mediathekMocks.fetchSearchResultsByString).toHaveBeenCalledWith(
      context,
      100,
      0,
      showMocks.getShowInfoByTvdbId.mock.calls[0][1]
    );
    expect(mediathekMocks.fetchSearchResultsById).not.toHaveBeenCalled();
  });

  it("preserves the requested offset in an empty ID-only fallback", async () => {
    showMocks.getShowInfoByTvdbId.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=12345&limit=10&offset=7")
    );
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain('offset="7" total="0"');
    expect(mediathekMocks.fetchSearchResultsByString).not.toHaveBeenCalled();
  });

  it("preserves explicit coordinates through RSS/NZB and keeps the queue-parser boundary", async () => {
    const source: ApiResultItem = {
      channel: "ARD",
      topic: "Example Show",
      title: "Staffel 2 (2/6)",
      description: "Synthetic release identity",
      filmlisteTimestamp: 1_700_000_000,
      duration: 2700,
      size: 1_000_000_000,
      url_website: "https://example.org/show/episode-1",
      url_video: "https://example.org/a--b/~~~.mp4?quality=720p",
      url_video_low: "",
      url_video_hd: "",
    };
    const [release] = generateGenericRssItems(source, "720p");
    const rss = convertItemsToRss([release], 100, 0);
    mediathekMocks.fetchSearchResultsByString.mockResolvedValue(rss);

    const searchResponse = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&q=Example")
    );
    const searchXml = await searchResponse.text();
    const parsedRss = await parseStringPromise(searchXml);
    const rssItem = parsedRss.rss.channel[0].item[0];
    const enclosureUrl = rssItem.enclosure[0].$.url as string;
    const encodedTitle = new URL(enclosureUrl, "http://localhost").searchParams.get("encodedTitle");
    const downloadResponse = await downloadNzb(new NextRequest(`http://localhost${enclosureUrl}`));
    const nzbContent = await downloadResponse.text();
    const queueResponse = await addToQueue(
      new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
        method: "POST",
        body: nzbContent,
      })
    );

    expect(searchResponse.status).toBe(200);
    expect(rssItem.title[0]).toBe(release.title);
    expect(release.title).toContain("Example.Show.S02E02");
    expect(encodedTitle).toBe(Buffer.from(release.title).toString("base64"));
    expect(rssItem.link[0]).toBe(source.url_video);
    expect(downloadResponse.status).toBe(200);
    expect(nzbContent).toContain(`<!-- ${encodedTitle} -->`);
    expect(nzbContent).toContain(Buffer.from(source.url_video).toString("base64"));
    const mediaExpectations = {
      version: 1,
      duration: { seconds: 2700, provenance: "source_catalogue" },
      audio: null,
      resolution: null,
    };
    expect(parseNzbContent(nzbContent)).toEqual({
      title: release.title,
      url: source.url_video,
      mediaExpectations,
    });
    expect(queueResponse.status).toBe(200);
    expect(downloadMocks.addToQueue).toHaveBeenCalledWith(
      source.url_video,
      release.title,
      "sonarr",
      mediaExpectations
    );
  });

  it("round-trips matched standard and daily TV titles from RSS through the NZB parser", async () => {
    const source: ApiResultItem = {
      channel: "ARD",
      topic: "Example Show",
      title: "März & Heute",
      description: "Synthetic matched episode",
      filmlisteTimestamp: 1_700_000_000,
      duration: 2700,
      size: 1_000_000_000,
      url_website: "https://example.org/show/episode-1",
      url_video: "https://example.org/a--b/~~~.mp4?token=a+b",
      url_video_low: "",
      url_video_hd: "",
    };
    const releases = generateRssItems(
      {
        episode: {
          name: `März & "Heute" + Finale`,
          aired: new Date("2026-03-31T00:00:00Z"),
          runtime: 30,
          seasonNumber: 2026,
          episodeNumber: 12,
        },
        item: source,
        showName: "Example & Show",
        matchedTitle: "Example Show",
        tvdbId: 12345,
      },
      "720p"
    );
    mediathekMocks.fetchSearchResultsById.mockResolvedValue(convertItemsToRss(releases, 100, 0));
    showMocks.getShowInfoByTvdbId.mockResolvedValue({
      id: 12345,
      name: "Example Show",
      germanName: null,
      aliases: [],
      episodes: [],
    });

    const searchResponse = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=tvsearch&tvdbid=12345&season=2026&ep=12")
    );
    const rss = await parseStringPromise(await searchResponse.text());
    const rssItems = rss.rss.channel[0].item;

    expect(searchResponse.status).toBe(200);
    expect(rssItems).toHaveLength(2);
    for (const [index, rssItem] of rssItems.entries()) {
      const title = rssItem.title[0] as string;
      const enclosureUrl = rssItem.enclosure[0].$.url as string;
      const encodedTitle = new URL(enclosureUrl, "http://localhost").searchParams.get(
        "encodedTitle"
      );
      const downloadResponse = await downloadNzb(
        new NextRequest(`http://localhost${enclosureUrl}`)
      );
      const nzbContent = await downloadResponse.text();
      const parsed = parseNzbContent(nzbContent);
      const queueResponse = await addToQueue(
        new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
          method: "POST",
          body: nzbContent,
        })
      );

      expect(title).toBe(releases[index].title);
      expect(encodedTitle).toBe(Buffer.from(title, "utf-8").toString("base64"));
      expect(downloadResponse.status).toBe(200);
      const mediaExpectations = {
        version: 1,
        duration: { seconds: 1800, provenance: "episode_metadata" },
        audio: null,
        resolution: null,
      };
      expect(parsed).toEqual({ title, url: source.url_video, mediaExpectations });
      expect(queueResponse.status).toBe(200);
      expect(downloadMocks.addToQueue).toHaveBeenLastCalledWith(
        source.url_video,
        title,
        "sonarr",
        mediaExpectations
      );
    }
    expect(rssItems[0].title[0]).toContain("S2026E12");
    expect(rssItems[1].title[0]).toContain("2026-03-31");
  });

  it("returns an HTTP error when the search owner rejects", async () => {
    mediathekMocks.fetchSearchResultsByString.mockRejectedValue(
      new Error("synthetic provider failure")
    );

    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&q=Example")
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: "Search temporarily unavailable" });
  });

  it("routes t=movie text queries through provider-aware movie search", async () => {
    mediathekMocks.fetchMovieSearchByQuery.mockResolvedValue(EMPTY_RSS);
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=movie&q=Rundschau&limit=20&offset=5")
    );
    expect(mediathekMocks.fetchMovieSearchByQuery).toHaveBeenCalledWith(
      "Rundschau",
      20,
      5,
      expect.anything()
    );
    expect(await response.text()).toBe(EMPTY_RSS);
  });
  it("routes the Radarr sync request to the movie Recent owner", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=search&extended=1&cat=2040,2030,2000&apikey=test&limit=100&offset=0"
      )
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(body).toContain('total="0"');
    expect(body).not.toContain('name="category" value="5000"');
    expect(mediathekMocks.fetchMovieSearchForRssSync).toHaveBeenCalledWith(100, 0);
    expect(mediathekMocks.fetchSearchResultsForRssSync).not.toHaveBeenCalled();
  });

  it("returns a TV-category result for a Sonarr sync request", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=search&cat=5040,5030,5000&limit=100&offset=0"
      )
    );
    const body = await response.text();

    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="5040"');
    expect(body).toContain('name="category" value="5030"');
    expect(body).toContain('name="category" value="5000"');
    expect(body).not.toContain('name="category" value="2000"');
  });

  it("provides both parent categories when the client does not request categories", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&limit=100&offset=0")
    );
    const body = await response.text();

    expect(body).toContain('name="category" value="2000"');
    expect(body).toContain('name="category" value="5000"');
  });

  it("returns real RSS results unchanged", async () => {
    const rss = `<?xml version="1.0"?><rss><channel><newznab:response offset="0" total="1"/><item><title>Real result</title></item></channel></rss>`;
    mediathekMocks.fetchMovieSearchForRssSync.mockResolvedValue(rss);

    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&cat=2000")
    );

    await expect(response.text()).resolves.toBe(rss);
  });

  it("matches movie categories exactly instead of by substring", async () => {
    mediathekMocks.fetchSearchResultsByString.mockResolvedValue("<rss>generic search</rss>");

    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=search&q=Test&cat=12000")
    );

    await expect(response.text()).resolves.toBe("<rss>generic search</rss>");
    expect(mediathekMocks.fetchMovieSearchByQuery).not.toHaveBeenCalled();
    expect(mediathekMocks.fetchSearchResultsByString).toHaveBeenCalledWith(
      { query: "Test", tvdbId: null, season: null, episode: null },
      100,
      0
    );
  });

  it("returns a genuinely empty film RSS feed rather than inventing a validation release", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=movie&limit=100&offset=0")
    );
    const body = await response.text();

    expect(body).toContain('total="0"');
    expect(body).not.toContain("<item>");
    expect(mediathekMocks.fetchMovieSearchForRssSync).toHaveBeenCalledWith(100, 0);
  });
});
