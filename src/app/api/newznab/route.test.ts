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
}));
const showMocks = vi.hoisted(() => ({
  getShowInfoByTvdbId: vi.fn(),
}));
const tmdbMocks = vi.hoisted(() => ({
  getMovieInfoByTmdbId: vi.fn(),
  getMovieInfoByImdbId: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({ addToQueue: vi.fn() }));

vi.mock("@/services/mediathek", () => mediathekMocks);
vi.mock("@/services/shows", () => showMocks);
vi.mock("@/services/tmdb", () => tmdbMocks);
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
  mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(EMPTY_RSS);
  downloadMocks.addToQueue.mockResolvedValue({ id: "synthetic-queue-item" });
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
    expect(showMocks.getShowInfoByTvdbId).toHaveBeenCalledWith(12345);
    expect(mediathekMocks.fetchSearchResultsById).toHaveBeenCalledWith(
      show,
      { query: null, tvdbId: 12345, season: "2", episode: "2" },
      25,
      5
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
    expect(mediathekMocks.fetchSearchResultsByString).toHaveBeenCalledWith(context, 100, 0);
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
    expect(parseNzbContent(nzbContent)).toEqual({ title: release.title, url: source.url_video });
    expect(queueResponse.status).toBe(200);
    expect(downloadMocks.addToQueue).toHaveBeenCalledWith(
      source.url_video,
      release.title,
      "sonarr"
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
      expect(parsed).toEqual({ title, url: source.url_video });
      expect(queueResponse.status).toBe(200);
      expect(downloadMocks.addToQueue).toHaveBeenLastCalledWith(source.url_video, title, "sonarr");
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

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "synthetic provider failure" });
  });

  it("routes t=movie text queries through provider-aware movie search", async () => {
    mediathekMocks.fetchMovieSearchByQuery.mockResolvedValue(EMPTY_RSS);
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=movie&q=Rundschau&limit=20&offset=5")
    );
    expect(mediathekMocks.fetchMovieSearchByQuery).toHaveBeenCalledWith("Rundschau", 20, 5);
    expect(await response.text()).toBe(EMPTY_RSS);
  });
  it("returns a movie-category result for the Radarr sync request", async () => {
    const response = await GET(
      new NextRequest(
        "http://localhost/api/newznab/api?t=search&extended=1&cat=2040,2030,2000&apikey=test&limit=100&offset=0"
      )
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/xml");
    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="2040"');
    expect(body).toContain('name="category" value="2030"');
    expect(body).toContain('name="category" value="2000"');
    expect(body).not.toContain('name="category" value="5000"');
    expect(mediathekMocks.fetchSearchResultsForRssSync).toHaveBeenCalledWith(100, 0);
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
    mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(rss);

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

  it("uses the shared movie validation response for t=movie", async () => {
    const response = await GET(
      new NextRequest("http://localhost/api/newznab/api?t=movie&limit=100&offset=0")
    );
    const body = await response.text();

    expect(body).toContain('total="1"');
    expect(body).toContain('name="category" value="2000"');
    expect(body).toContain('name="category" value="2040"');
    expect(body).not.toContain('name="category" value="5000"');
  });
});
