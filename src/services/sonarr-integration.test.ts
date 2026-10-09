import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import type { ApiResultItem, Ruleset } from "@/types";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  addToQueue: vi.fn(),
  rulesets: [] as Ruleset[],
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    config: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        state.settings.has(where.key) ? { value: state.settings.get(where.key) } : null
      ),
      findMany: vi.fn(async () => [...state.settings].map(([key, value]) => ({ key, value }))),
    },
  },
}));
vi.mock("./rulesets", () => ({
  getRulesetContext: () => "synthetic-rules",
  ensureRulesetsLoaded: async () => {},
  getAllTopics: () => state.rulesets.map((ruleset) => ruleset.topic),
  getRulesetsForTopic: (topic: string) =>
    state.rulesets.filter((ruleset) => ruleset.topic === topic),
  getRulesetsForTopicAndTvdbId: (topic: string, tvdbId: number) =>
    state.rulesets.filter(
      (ruleset) => ruleset.topic === topic && ruleset.media.media_tvdbId === tvdbId
    ),
  getOrGenerateRulesetForShow: async () => null,
}));
vi.mock("./download", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./download")>()),
  addToQueue: state.addToQueue,
}));
import { GET } from "@/app/api/newznab/route";
import { GET as downloadNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { POST as addfile } from "@/app/api/route";
import { parseNzbContent } from "./download";
import { clearMetadataCaches, mediathekCache } from "@/lib/cache";
import { clearSettingsCache } from "@/lib/settings";
import { mediaSourceIdentity } from "./source-audio";
import { syntheticMp4, mp4RangeResponse } from "@/lib/__fixtures__/mp4";

let fetchMock: ReturnType<typeof vi.fn<(value: string) => Promise<Response>>>;
const source: ApiResultItem = {
  channel: "ARD",
  topic: "Synthetic series",
  title: "Missing episode",
  description: "Synthetic short episode",
  filmlisteTimestamp: Date.now() / 1000,
  duration: 120,
  size: 123456,
  url_video: "https://example.invalid/media.mp4?token=synthetic-expiring",
  url_video_low: "",
  url_video_hd: "",
  url_website: "https://example.invalid/episode",
};

beforeEach(() => {
  clearMetadataCaches();
  mediathekCache.clear();
  clearSettingsCache();
  state.settings.clear();
  state.rulesets = [];
  state.settings.set("integration.sonarr.enabled", "true");
  state.settings.set("integration.sonarr.url", "https://example.invalid/sonarr");
  state.settings.set("download.quality", "720p");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY", "synthetic-integration-key");
  vi.stubEnv("PINGUFUNK_SONARR_API_KEY_FILE", undefined);
  state.addToQueue.mockReset();
  state.addToQueue.mockResolvedValue({ id: "synthetic-job" });
  fetchMock = vi.fn(async (value: string) => {
    const url = new URL(value);
    if (url.hostname === "raw.githubusercontent.com")
      return Response.json([
        {
          tvdbId: 123,
          name: "Synthetic series",
          germanName: "Synthetic series",
          aliases: [],
          episodes: [
            {
              name: "Existing episode",
              seasonNumber: 1,
              episodeNumber: 1,
              aired: "2026-01-01T12:00:00Z",
              runtime: 40,
            },
          ],
        },
      ]);
    if (url.pathname.endsWith("/system/status")) return Response.json({ version: "4.0.16.2944" });
    if (url.pathname.endsWith("/series"))
      return Response.json([{ id: 12, tvdbId: 123, title: "Synthetic series", monitored: true }]);
    if (url.pathname.endsWith("/episode"))
      return Response.json([
        {
          id: 45,
          seriesId: 12,
          seasonNumber: 2,
          episodeNumber: 3,
          title: "Missing episode",
          airDateUtc: new Date(Date.now() - 3600_000).toISOString(),
          runtime: 2,
        },
      ]);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({
        result: {
          results: [
            source,
            {
              ...source,
              topic: "Foreign series",
              url_video: "https://example.invalid/foreign.mp4",
            },
            {
              ...source,
              title: "Missing episode Trailer",
              url_video: "https://example.invalid/trailer.mp4",
            },
          ],
        },
        err: null,
      });
    throw new Error("Unexpected synthetic request");
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearSettingsCache();
  clearMetadataCaches();
  mediathekCache.clear();
});

it("exposes a source-coordinate-bound future TBA duration conflict consistently without releasing its NZB", async () => {
  const base = fetchMock.getMockImplementation()!;
  state.settings.set("matching.sonarr.tolerancePercent", "15");
  state.settings.set("download.quality", "best");
  fetchMock.mockImplementation(async (value: string, init?: RequestInit) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/episode"))
      return Response.json([
        {
          id: 45,
          seriesId: 12,
          seasonNumber: 2,
          episodeNumber: 3,
          title: "TBA",
          airDateUtc: "2099-01-01T12:00:00Z",
          runtime: 50,
        },
      ]);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({
        result: {
          results: [
            {
              ...source,
              channel: "ZDF",
              title: "Actual title (S02/E03)",
              duration: 3540,
              url_video: "https://rodlzdf-a.akamaihd.net/synthetic/episode.mp4",
            },
          ],
        },
        err: null,
      });
    if (url.hostname === "rodlzdf-a.akamaihd.net") return mp4RangeResponse(syntheticMp4(), init!);
    return base(value);
  });
  for (const query of [
    "tvdbid=123&season=2&ep=3",
    "tvdbid=123&season=2",
    "q=Synthetic.series&season=2&ep=3",
    "q=Synthetic%20series&season=2",
  ]) {
    const response = await GET(new NextRequest(`http://localhost/api/newznab?t=tvsearch&${query}`));
    expect(response.status).toBe(200);
    const channel = (await parseStringPromise(await response.text())).rss.channel[0];
    expect(channel.item).toHaveLength(1);
    const release = channel.item[0];
    expect(release.title[0]).toContain("S02E03.Actual.title");
    expect(release.title[0]).toContain("1080p");
    expect(release.title[0]).toContain("GERMAN");
    expect(release.description[0]).toContain("Laufzeitkonflikt");
    expect(release.description[0]).toContain("±15 %");
    const nzb = await downloadNzb(
      new NextRequest(new URL(release.enclosure[0].$.url, "http://localhost"))
    );
    expect(nzb.status).toBe(409);
    expect(await nzb.text()).not.toContain("<nzb");
  }
  expect(state.addToQueue).not.toHaveBeenCalled();
});

it("does not bind a title-only query to either of two authoritative alias owners", async () => {
  const base = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/series"))
      return Response.json([
        {
          id: 12,
          tvdbId: 123,
          title: "First series",
          monitored: true,
          alternateTitles: [{ title: "Shared alias", seasonNumber: -1 }],
        },
        {
          id: 13,
          tvdbId: 124,
          title: "Second series",
          monitored: true,
          alternateTitles: [{ title: "Shared alias", seasonNumber: -1 }],
        },
      ]);
    return base(value);
  });
  const response = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&q=Shared%20alias&season=2&ep=3")
  );
  expect(response.status).toBe(200);
  const channel = (await parseStringPromise(await response.text())).rss.channel[0];
  expect(channel.item ?? []).toHaveLength(0);
  expect(
    fetchMock.mock.calls.some(([value]) => new URL(value).hostname === "mediathekviewweb.de")
  ).toBe(false);
});

it("finds an already listed future-airdate episode by exact/season search without granting RSS advance access", async () => {
  const base = fetchMock.getMockImplementation()!;
  const future = new Date(Date.now() + 7 * 86400_000).toISOString();
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/episode"))
      return Response.json([
        {
          id: 45,
          seriesId: 12,
          seasonNumber: 2,
          episodeNumber: 3,
          title: "Missing episode",
          airDateUtc: future,
          runtime: 2,
        },
      ]);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({
        result: { results: [{ ...source, timestamp: Date.parse(future) / 1000 }] },
        err: null,
      });
    return base(value);
  });
  for (const query of ["t=tvsearch&tvdbid=123&season=2&ep=3", "t=tvsearch&tvdbid=123&season=2"]) {
    const response = await GET(new NextRequest(`http://localhost/api/newznab?${query}`));
    expect(response.status).toBe(200);
    const channel = (await parseStringPromise(await response.text())).rss.channel[0];
    expect(channel.item).toHaveLength(1);
    expect(channel.item[0].title[0]).toContain("S02E03");
    expect(channel.item[0].pubDate[0]).toBe(
      new Date(source.filmlisteTimestamp * 1000).toUTCString()
    );
    const nzb = await downloadNzb(
      new NextRequest(new URL(channel.item[0].enclosure[0].$.url, "http://localhost"))
    );
    expect(parseNzbContent(await nzb.text())?.url).toBe(source.url_video);
  }
  const rss = await GET(new NextRequest("http://localhost/api/newznab?t=tvsearch&cat=5000"));
  const rssBody = await rss.text();
  // The native endpoint preserves its shipped empty-feed validation item, not the future episode.
  expect(rssBody).not.toContain("S02E03");
  expect(rssBody).not.toContain(source.url_video);
  expect(rssBody).toContain("RundfunkArr.Validation");
  expect(state.addToQueue).not.toHaveBeenCalled();
});

it.each(["ard", "arte", "zdf"] as const)(
  "finds a complete unbundled %s season with generic metadata and exact source audio through RSS/NZB/queue",
  async (provider) => {
    state.settings.set("download.quality", "best");
    const count = provider === "ard" ? 6 : provider === "arte" ? 4 : 2;
    const tvdbId = 98765;
    const season = provider === "arte" ? 2 : 1;
    const name = "Synthetic Harbour";
    const alias = "Stille Bucht - Toedliches Schweigen";
    const sourceName = "Stille Bucht - Tödliches Schweigen";
    const rows = Array.from({ length: count }, (_, index): ApiResultItem => {
      const n = index + 1;
      const id =
        provider === "ard"
          ? Buffer.from(`crid://example.invalid/synthetic/${n}`).toString("base64url")
          : `123456-${String(n).padStart(3, "0")}-A`;
      return {
        ...source,
        topic:
          provider === "ard"
            ? sourceName
            : provider === "arte"
              ? "Fernsehfilme und Serien - Serien"
              : "Lokales Polizeirevier",
        title:
          provider === "ard"
            ? `Folge ${n} | ${sourceName} (S01/E${String(n).padStart(2, "0")})`
            : provider === "arte"
              ? `${name} (${n}/${count}) - Synthetischer Titel`
              : `Synthetischer Titel ${n} (S01/E${String(n).padStart(2, "0")})`,
        url_website:
          provider === "ard"
            ? `https://www.ardmediathek.de/video/synthetic/${id}`
            : provider === "arte"
              ? `https://www.arte.tv/de/videos/${id}/synthetic/`
              : `https://www.zdf.de/video/serien/synthetic/${n}`,
        url_video:
          provider === "ard"
            ? `https://ctv-videos.daserste.de/synthetic/${n}.mp4`
            : provider === "arte"
              ? `https://arteptweb-a.akamaihd.net/synthetic/${n}.mp4`
              : `https://rodlzdf-a.akamaihd.net/synthetic/${n}.mp4`,
        url_video_hd:
          provider === "ard"
            ? `https://ctv-videos.daserste.de/synthetic/${n}-hd.mp4`
            : provider === "arte"
              ? `https://arteptweb-a.akamaihd.net/synthetic/${n}-hd.mp4`
              : `https://rodlzdf-a.akamaihd.net/synthetic/${n}-hd.mp4`,
      };
    });
    if (provider === "zdf")
      state.rulesets = [
        {
          id: 1,
          mediaId: 1,
          topic: "Lokales Polizeirevier",
          priority: 0,
          filters: "[]",
          titleRegexRules: "[]",
          seasonRegex: null,
          episodeRegex: null,
          matchingStrategy: "SeasonAndEpisodeNumber" as Ruleset["matchingStrategy"],
          media: {
            media_id: 1,
            media_name: name,
            media_type: "show",
            media_tvdbId: tvdbId,
            media_tmdbId: null,
            media_imdbId: null,
          },
        },
      ];
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (value: string, init?: RequestInit) => {
      const url = new URL(value);
      if (url.pathname.endsWith("/series"))
        return Response.json([
          {
            id: 67,
            tvdbId,
            title: name,
            monitored: true,
            alternateTitles: provider === "zdf" ? [] : [{ title: alias, seasonNumber: -1 }],
          },
        ]);
      if (url.pathname.endsWith("/episode"))
        return Response.json(
          rows.map((_, index) => ({
            id: 700 + index,
            seriesId: 67,
            seasonNumber: season,
            episodeNumber: index + 1,
            title: provider === "zdf" ? "TBA" : `Episode ${index + 1}`,
            runtime: 2,
            airDateUtc: new Date(Date.now() - 3600_000).toISOString(),
          }))
        );
      if (url.hostname === "mediathekviewweb.de")
        return Response.json({
          result: {
            results:
              provider !== "zdf" ||
              JSON.parse(String(init?.body)).queries[0].query === "Lokales Polizeirevier"
                ? rows
                : [],
          },
          err: null,
        });
      if (url.hostname === "rodlzdf-a.akamaihd.net")
        return mp4RangeResponse(syntheticMp4(1280, 720), init!);
      if (url.hostname === "api.ardmediathek.de") {
        const id = url.pathname.split("/").at(-1)!;
        const row = rows.find((row) => row.url_website.endsWith(id))!;
        return Response.json({
          widgets: [
            {
              id,
              type: "player_ondemand",
              blockedByLoginOnly: false,
              blockedByFsk: false,
              geoblocked: false,
              availableTo: "2099-01-01T00:00:00Z",
              mediaCollection: {
                embedded: {
                  meta: { ovLanguageCode: "eng" },
                  streams: [
                    {
                      kind: "main",
                      media: [row.url_video, row.url_video_hd].map((mediaUrl, index) => ({
                        url: mediaUrl,
                        mimeType: "video/mp4",
                        audios: [{ kind: "standard", languageCode: "deu" }],
                        maxHResolutionPx: index === 0 ? 960 : 1280,
                        maxVResolutionPx: index === 0 ? 540 : 720,
                      })),
                    },
                  ],
                },
              },
            },
          ],
        });
      }
      if (url.hostname === "api.arte.tv") {
        const id = url.pathname.split("/").at(-1)!;
        const n = Number(id.split("-")[1]);
        return Response.json({
          data: {
            attributes: {
              rights: { begin: "2020-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z" },
              metadata: {
                providerId: id,
                title: name,
                subtitle: `(${n}/${count})`,
                link: { url: rows[n - 1].url_website },
                duration: { seconds: 120 },
              },
              streams: [
                {
                  protocol: "API_HLS_NG_MA",
                  url: "https://fixture.akamaized.net/master.m3u8",
                  versions: [{ eStat: { ml5: "VOF-STA" } }],
                },
              ],
            },
          },
        });
      }
      if (url.hostname === "www.arte.tv") {
        const id = /streams\/([^/]+)/.exec(url.pathname)![1];
        const row = rows[Number(id.split("-")[1]) - 1];
        return Response.json({
          videoStreams: [row.url_video, row.url_video_hd].map((mediaUrl, index) => ({
            programId: id,
            url: mediaUrl,
            audioCode: "VA",
            width: index === 0 ? 960 : 1280,
            height: index === 0 ? 540 : 720,
          })),
        });
      }
      return base(value);
    });
    const response = await GET(
      new NextRequest(`http://localhost/api/newznab?t=tvsearch&tvdbid=${tvdbId}&season=${season}`)
    );
    expect(response.status).toBe(200);
    const channel = (await parseStringPromise(await response.text())).rss.channel[0];
    expect(channel["newznab:response"][0].$).toEqual({ offset: "0", total: String(count) });
    expect(channel.item).toHaveLength(count);
    for (const [index, release] of channel.item.entries()) {
      const n = index + 1;
      expect(release.title[0]).toContain(
        `S${String(season).padStart(2, "0")}E${String(n).padStart(2, "0")}`
      );
      expect(release.title[0]).toContain("GERMAN.720p");
      expect(release.title[0]).not.toMatch(/\.OV\.|SUBBED/);
      expect(release.link[0]).toBe(rows[index].url_video_hd);
      const nzbResponse = await downloadNzb(
        new NextRequest(new URL(release.enclosure[0].$.url, "http://localhost"))
      );
      const nzb = await nzbResponse.text();
      const parsed = parseNzbContent(nzb);
      if (!parsed) throw new Error("Expected a valid NZB release");
      expect(parsed).toMatchObject({
        url: rows[index].url_video_hd,
        mediaExpectations: {
          version: 3,
          mediaKind: "series",
          audio: provider === "zdf" ? { language: "de", provenance: "provider_audio" } : null,
          durations: {
            source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
            metadata: { seconds: 120, provenance: "episode_metadata", tolerancePercent: 10 },
          },
          ...(provider === "zdf"
            ? { resolution: { width: 1280, height: 720, provenance: "provider_dimensions" } }
            : {
                sourceAudio: {
                  provider: provider === "ard" ? "ard_media" : "arte_hbbtv",
                  language: "de",
                  mediaIdentity: mediaSourceIdentity(rows[index].url_video_hd),
                },
              }),
        },
      });
      expect(
        (
          await addfile(
            new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
              method: "POST",
              body: nzb,
            })
          )
        ).status
      ).toBe(200);
      expect(state.addToQueue).toHaveBeenLastCalledWith(
        rows[index].url_video_hd,
        release.title[0],
        "sonarr",
        parsed.mediaExpectations
      );
    }
    const page = await GET(
      new NextRequest(
        `http://localhost/api/newznab?t=tvsearch&tvdbid=${tvdbId}&season=${season}&limit=1&offset=1`
      )
    );
    const second = (await parseStringPromise(await page.text())).rss.channel[0];
    expect(second["newznab:response"][0].$).toEqual({ offset: "1", total: String(count) });
    expect(second.item[0].guid).toEqual(channel.item[1].guid);
    expect(fetchMock.mock.calls.every(([url]) => !new URL(url).pathname.includes("/command"))).toBe(
      true
    );
  }
);

it.each([false, true])(
  "supplements and round-trips exact, season and RSS through NZB to the queue with HLS enabled=%s",
  async (hlsEnabled) => {
    const expectedUrl = hlsEnabled ? "https://example.invalid/media.m3u8" : source.url_video;
    if (hlsEnabled) {
      state.settings.set("download.enableHLS", "true");
      const fetchSource = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (value: string) => {
        if (new URL(value).hostname === "mediathekviewweb.de")
          return Response.json({
            result: { results: [{ ...source, url_video: expectedUrl }] },
            err: null,
          });
        return fetchSource(value);
      });
    }
    for (const query of [
      "t=tvsearch&tvdbid=123&season=2&ep=3",
      "t=tvsearch&tvdbid=123&season=2",
      "t=tvsearch&cat=5000",
    ]) {
      const response = await GET(
        new NextRequest(`http://localhost/api/newznab?${query}&limit=1&offset=0`)
      );
      expect(response.status).toBe(200);
      const parsed = await parseStringPromise(await response.text());
      const channel = parsed.rss.channel[0];
      expect(channel["newznab:response"][0].$).toEqual({ offset: "0", total: "1" });
      const release = channel.item[0];
      expect(release.title[0]).toContain("S02E03");
      expect(release.title[0]).not.toContain("GERMAN");
      expect(release.link[0]).toBe(expectedUrl);
      const enclosure = release.enclosure[0].$.url;
      const nzbResponse = await downloadNzb(
        new NextRequest(new URL(enclosure, "http://localhost"))
      );
      expect(nzbResponse.status).toBe(200);
      const nzb = await nzbResponse.text();
      const mediaExpectations = {
        version: 3,
        mediaKind: "series",
        durations: {
          source: { seconds: 120, provenance: "source_catalogue", tolerancePercent: 10 },
          metadata: { seconds: 120, provenance: "episode_metadata", tolerancePercent: 10 },
        },
        sourceAudio: null,
        audio: null,
        resolution: null,
      };
      expect(parseNzbContent(nzb)).toEqual({
        title: release.title[0],
        url: expectedUrl,
        mediaExpectations,
      });
      expect(
        (
          await addfile(
            new NextRequest("http://localhost/api?mode=addfile&cat=sonarr", {
              method: "POST",
              body: nzb,
            })
          )
        ).status
      ).toBe(200);
      expect(state.addToQueue).toHaveBeenLastCalledWith(
        expectedUrl,
        release.title[0],
        "sonarr",
        mediaExpectations
      );
    }
    const episodeCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes("api/v3/episode")
    );
    expect(episodeCalls).toHaveLength(1);
    const beforePage = fetchMock.mock.calls.length;
    const page = await GET(
      new NextRequest("http://localhost/api/newznab?t=tvsearch&cat=5000&limit=1&offset=1")
    );
    const parsed = await parseStringPromise(await page.text());
    expect(parsed.rss.channel[0]["newznab:response"][0].$).toEqual({ offset: "1", total: "1" });
    expect(parsed.rss.channel[0].item).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(beforePage + 2);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("api/v3/episode"))
    ).toHaveLength(1);
  }
);

it("refreshes exact ARD URL/audio/rights in repeated RSS, never returning the previous body as proof", async () => {
  const base = fetchMock.getMockImplementation()!;
  const id = Buffer.from("crid://example.invalid/synthetic/fresh").toString("base64url");
  let token = "first";
  let language = "deu";
  let expired = false;
  const mediaUrl = () => `https://ctv-videos.daserste.de/synthetic/fresh.mp4?token=${token}`;
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({
        result: {
          results: [
            {
              ...source,
              url_website: `https://www.ardmediathek.de/video/synthetic/${id}`,
              url_video: mediaUrl(),
            },
          ],
        },
        err: null,
      });
    if (url.hostname === "api.ardmediathek.de")
      return Response.json({
        widgets: [
          {
            id,
            type: "player_ondemand",
            blockedByLoginOnly: false,
            blockedByFsk: false,
            geoblocked: false,
            availableTo: expired ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
            mediaCollection: {
              embedded: {
                meta: { ovLanguageCode: "eng" },
                streams: [
                  {
                    kind: "main",
                    media: [
                      {
                        url: mediaUrl(),
                        mimeType: "video/mp4",
                        audios: [{ languageCode: language, kind: "standard" }],
                        maxHResolutionPx: 1280,
                        maxVResolutionPx: 720,
                      },
                    ],
                  },
                ],
              },
            },
          },
        ],
      });
    return base(value);
  });
  const read = async () =>
    (
      await parseStringPromise(
        await (
          await GET(new NextRequest("http://localhost/api/newznab?t=tvsearch&cat=5000"))
        ).text()
      )
    ).rss.channel[0];
  const first = await read();
  expect(first.item[0].title[0]).toContain("GERMAN");
  expect(first.item[0].link[0]).toBe(mediaUrl());
  const guid = first.item[0].guid[0]._;
  token = "rotated";
  language = "fra";
  const second = await read();
  expect(second.item[0].title[0]).toContain("RundfunkArr.Validation");
  expect(JSON.stringify(second)).not.toContain("S02E03");
  expect(JSON.stringify(second)).not.toContain(mediaUrl());
  // The configured German policy rejects the newly French rendition; a
  // rotated signature alone does not manufacture a new release GUID.
  language = "deu";
  const third = await read();
  expect(third.item[0].guid[0]._).toBe(guid);
  expect(third.item[0].link[0]).toBe(mediaUrl());
  const nzb = await downloadNzb(
    new NextRequest(new URL(third.item[0].enclosure[0].$.url, "http://localhost"))
  );
  expect(parseNzbContent(await nzb.text())?.url).toBe(mediaUrl());
  expired = true;
  const final = await read();
  expect(final.item[0].title[0]).toContain("RundfunkArr.Validation");
  expect(JSON.stringify(final)).not.toContain("S02E03");
  expect(JSON.stringify(final)).not.toContain(mediaUrl());
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes("api.ardmediathek.de"))
  ).toHaveLength(4);
  expect(state.addToQueue).not.toHaveBeenCalled();
});

it("does not republish a verified Sonarr episode as an unknown candidate or requested neighbor", async () => {
  state.settings.set("matching.minDuration", "0");
  const own = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=2&ep=3")
  );
  expect(await own.text()).toContain('total="1"');
  const neighbor = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=1&ep=1")
  );
  expect(await neighbor.text()).toContain('total="0"');
});

it("does not turn an unavailable missing episode into a cached empty HTTP success", async () => {
  fetchMock.mockImplementation(async (value: string) => {
    if (new URL(value).pathname.endsWith("/system/status"))
      return new Response("private upstream payload", { status: 401 });
    return Response.json([
      {
        tvdbId: 123,
        name: "Synthetic series",
        germanName: "Synthetic series",
        aliases: [],
        episodes: [
          {
            name: "Existing episode",
            seasonNumber: 1,
            episodeNumber: 1,
            aired: "2026-01-01T12:00:00Z",
            runtime: 40,
          },
        ],
      },
    ]);
  });
  const response = await GET(
    new NextRequest("http://localhost/api/newznab?t=tvsearch&tvdbid=123&season=2&ep=3")
  );
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("private upstream payload");
});

it("retains independently verified exact and RSS base hits during a Sonarr outage", async () => {
  state.rulesets = [
    {
      id: 1,
      mediaId: 1,
      topic: "Synthetic series",
      priority: 1,
      filters: "[]",
      titleRegexRules: JSON.stringify([{ type: "regex", field: "title", pattern: "^(.*)$" }]),
      seasonRegex: null,
      episodeRegex: null,
      matchingStrategy: "ItemTitleExact" as Ruleset["matchingStrategy"],
      media: {
        media_id: 1,
        media_name: "Synthetic series",
        media_type: "tv",
        media_tvdbId: 123,
        media_tmdbId: null,
        media_imdbId: null,
      },
    },
  ];
  const independent = { ...source, title: "Existing episode", duration: 2400 };
  const original = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (value: string) => {
    const url = new URL(value);
    if (url.pathname.endsWith("/system/status")) return new Response(null, { status: 401 });
    if (url.hostname === "mediathekviewweb.de")
      return Response.json({ result: { results: [independent] }, err: null });
    return original(value);
  });
  for (const query of ["t=tvsearch&tvdbid=123&season=1&ep=1", "t=tvsearch&cat=5000"]) {
    const response = await GET(new NextRequest(`http://localhost/api/newznab?${query}`));
    expect(response.status).toBe(200);
    const rss = await response.text();
    expect(rss).toContain("S01E01");
    expect(rss).not.toContain("S02E03");
  }
  expect(
    fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/v3/episode"))
  ).toHaveLength(0);
});
