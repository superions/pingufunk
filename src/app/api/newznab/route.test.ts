import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import type { ApiResultItem } from "@/types";
import { convertItemsToRss, generateGenericRssItems } from "@/services/newznab";
import { parseNzbContent } from "@/services/download";
import { GET as downloadNzb } from "./fake_nzb_download/route";

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

vi.mock("@/services/mediathek", () => mediathekMocks);
vi.mock("@/services/shows", () => showMocks);
vi.mock("@/services/tmdb", () => tmdbMocks);

import { GET } from "./route";

const EMPTY_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss xmlns:newznab="http://www.newznab.com/DTD/2010/feeds/attributes/">
  <channel><newznab:response offset="0" total="0"/></channel>
</rss>`;

beforeEach(() => {
  vi.clearAllMocks();
  mediathekMocks.fetchSearchResultsForRssSync.mockResolvedValue(EMPTY_RSS);
});

describe("Newznab indexer validation", () => {
  it("passes TVDB, season and episode coordinates from the indexer route to its owner", async () => {
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
        "http://localhost/api/newznab/api?t=tvsearch&tvdbid=12345&season=02&ep=2&limit=25&offset=5"
      )
    );

    expect(response.status).toBe(200);
    expect(showMocks.getShowInfoByTvdbId).toHaveBeenCalledWith(12345);
    expect(mediathekMocks.fetchSearchResultsById).toHaveBeenCalledWith(show, "02", "2", 25, 5);
    expect(await response.text()).toBe(EMPTY_RSS);
  });

  it("characterizes the Newznab RSS to NZB route and queue-parser boundary", async () => {
    const source: ApiResultItem = {
      channel: "ARD",
      topic: "Example Show",
      title: "Episode with a tricky URL",
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
    const downloadResponse = await downloadNzb(new NextRequest(`http://localhost${enclosureUrl}`));
    const nzbContent = await downloadResponse.text();

    expect(searchResponse.status).toBe(200);
    expect(rssItem.title[0]).toBe(release.title);
    expect(rssItem.link[0]).toBe(source.url_video);
    expect(downloadResponse.status).toBe(200);
    expect(nzbContent).toContain(Buffer.from(release.title).toString("base64"));
    expect(nzbContent).toContain(Buffer.from(source.url_video).toString("base64"));
    // P02.3 owns closing this existing gap: the queue parser requires a filename attribute.
    expect(parseNzbContent(nzbContent)).toBeNull();
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
    expect(mediathekMocks.fetchSearchResultsByString).toHaveBeenCalledWith("Test", null, 100, 0);
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
