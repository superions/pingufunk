import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStringPromise } from "xml2js";
import { NextRequest } from "next/server";
import type { ApiResultItem, TvdbData, Ruleset } from "@/types";
import { MatchingStrategy } from "@/types";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const fixtures = vi.hoisted(() => ({ shows: new Map<number, TvdbData>(), rules: [] as Ruleset[] }));
vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn(async (key: string) => (key === "download.quality" ? "720p" : null)),
  getMinDurationSeconds: vi.fn(async () => 300),
}));
vi.mock("./rulesets", () => ({
  ensureRulesetsLoaded: vi.fn(async () => {}),
  getRulesetContext: () => "arte-fixture",
  getRulesetsForTopic: () => fixtures.rules,
  getRulesetsForTopicAndTvdbId: (_topic: string, id: number) =>
    fixtures.rules.filter((rule) => rule.media.media_tvdbId === id),
  getAllTopics: () => ["Fernsehfilme und Serien - Serien"],
  getOrGenerateRulesetForShow: vi.fn(async () => null),
}));
vi.mock("./shows", () => ({
  getBaseShowInfoByTvdbId: vi.fn(async (id: number) => fixtures.shows.get(id) ?? null),
  getBaseShowForSonarrRss: vi.fn(async (id: number) => fixtures.shows.get(id) ?? null),
}));
vi.mock("./category", () => ({ getCategoriesForTopics: vi.fn(async () => new Map()) }));
import { fetchSearchResultsById, fetchSearchResultsForRssSync } from "./mediathek";
import { mediathekCache } from "@/lib/cache";
import { GET as getNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { parseNzbContent } from "./download";

const topic = "Fernsehfilme und Serien - Serien";
function makeShow(id: number, name: string): TvdbData {
  return {
    id,
    name,
    germanName: null,
    aliases: [],
    episodes: [
      { name: "First episode", seasonNumber: 1, episodeNumber: 1, runtime: 40, aired: null },
    ],
  };
}
function makeItem(name: string, id: string, edition: string): ApiResultItem {
  return {
    channel: "ARTE",
    topic,
    title: `${name} S01E01`,
    description: "",
    duration: 2400,
    size: 5,
    filmlisteTimestamp: 1,
    url_website: `https://www.arte.tv/fr/videos/${id}/fixture/`,
    url_video: `https://fixture.akamaized.net/${id}-${edition}.mp4`,
    url_video_hd: "",
    url_video_low: "",
  };
}
function player(show: TvdbData, id: string) {
  return {
    data: {
      attributes: {
        rights: { begin: "2020-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z" },
        metadata: {
          providerId: id,
          title: show.name,
          subtitle: "S01E01",
          link: { url: `https://www.arte.tv/de/videos/${id}/fixture/` },
          duration: { seconds: 2400 },
        },
        streams: [
          {
            protocol: "HTTPS",
            url: `https://fixture.akamaized.net/${id}-de.mp4?sig=current`,
            versions: [{ eStat: { ml5: "VA" } }],
          },
        ],
      },
    },
  };
}
beforeEach(() => {
  mediathekCache.clear();
  fixtures.shows.clear();
  fixtures.rules = [];
  for (const show of [makeShow(42, "Nordfall"), makeShow(43, "Suedfall")]) {
    fixtures.shows.set(show.id, show);
    fixtures.rules.push({
      id: show.id,
      mediaId: show.id,
      topic,
      priority: 0,
      filters: "[]",
      titleRegexRules: "[]",
      seasonRegex: "S(\\d+)",
      episodeRegex: "E(\\d+)",
      matchingStrategy: MatchingStrategy.SeasonAndEpisodeNumber,
      media: {
        media_id: show.id,
        media_name: show.name,
        media_type: "show",
        media_tvdbId: show.id,
        media_tmdbId: null,
        media_imdbId: null,
      },
    });
  }
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe("ARTE editions through the actual RSS and NZB owners", () => {
  it("keeps two series in one topic distinct and forwards the fresh German URL through NZB", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
      if (String(url).includes("/config/")) {
        const id = String(url).split("/").at(-1)!;
        return Response.json(player(fixtures.shows.get(id === "123456-001-A" ? 42 : 43)!, id));
      }
      const body = JSON.parse(String(init?.body));
      const title = body.queries?.[0]?.query;
      const rows = title
        ? [makeItem(title, title === "Nordfall" ? "123456-001-A" : "654321-001-A", "de")]
        : [makeItem("Suedfall", "654321-001-A", "fr"), makeItem("Nordfall", "123456-001-A", "fr")];
      return Response.json({ result: { results: rows } });
    });
    vi.stubGlobal("fetch", fetch);
    const xml = await fetchSearchResultsForRssSync(50, 0);
    expect(xml).toContain('total="2"');
    const parsed = await parseStringPromise(xml);
    const rssItems = parsed.rss.channel[0].item;
    const north = rssItems.find((item: { title: string[] }) =>
      item.title[0].startsWith("Nordfall.")
    );
    const south = rssItems.find((item: { title: string[] }) =>
      item.title[0].startsWith("Suedfall.")
    );
    expect(north.title[0]).toContain("GERMAN");
    expect(north["newznab:attr"]).toContainEqual({ $: { name: "tvdbid", value: "42" } });
    expect(south["newznab:attr"]).toContainEqual({ $: { name: "tvdbid", value: "43" } });
    const nzb = await getNzb(
      new NextRequest(new URL(north.enclosure[0].$.url, "http://localhost"))
    );
    expect(nzb.status).toBe(200);
    expect(parseNzbContent(await nzb.text())?.url).toBe(
      "https://fixture.akamaized.net/123456-001-A-de.mp4?sig=current"
    );
    expect(fetch).toHaveBeenCalledTimes(5);
  });
  it("does not publish or cache partial results when an edition page fails", async () => {
    const cacheWrite = vi.spyOn(mediathekCache, "set");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof globalThis.fetch>(async (url, init) => {
        if (String(url).includes("/config/"))
          return Response.json(player(fixtures.shows.get(42)!, "123456-001-A"));
        const body = JSON.parse(String(init?.body));
        if (body.queries?.[0]?.fields?.[0] === "title")
          return new Response("Unavailable", { status: 403 });
        return Response.json({ result: { results: [makeItem("Nordfall", "123456-001-A", "fr")] } });
      })
    );
    await expect(
      fetchSearchResultsById(
        fixtures.shows.get(42)!,
        { query: null, tvdbId: 42, season: "1", episode: "1" },
        50,
        0,
        new HttpRequestBudget()
      )
    ).rejects.toThrow("Search provider unavailable");
    expect(cacheWrite).not.toHaveBeenCalled();
  });
});
