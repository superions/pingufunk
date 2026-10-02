import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { arteVideoId, parseArteVersion, resolveArteSeriesEditions } from "./arte-editions";
import { selectLanguageVariants } from "./language-editions";
import { readLanguagePolicy } from "@/lib/language-policy";
import type { ApiResultItem, TvdbData } from "@/types";
import { queryMediathekView } from "@/lib/mediathek-client";
vi.mock("@/lib/mediathek-client", () => ({
  MEDIATHEK_VIEW_MAX_PAGE_SIZE: 1000,
  queryMediathekView: vi.fn(async () => []),
}));

const show: TvdbData = {
  id: 42,
  name: "Northern Case",
  germanName: "Nordfall",
  aliases: [],
  episodes: [],
};
const item: ApiResultItem = {
  channel: "ARTE.FR",
  topic: "Fernsehfilme und Serien - Serien",
  title: "Nordfall (1/6)",
  description: "",
  filmlisteTimestamp: 1,
  duration: 2400,
  size: 5,
  url_website: "https://www.arte.tv/fr/videos/123456-001-A/nordfall/",
  url_video: "https://fixture.akamaized.net/french.mp4",
  url_video_low: "",
  url_video_hd: "",
};
function stream(code = "VA", url = "https://fixture.akamaized.net/german.mp4") {
  return { protocol: "HTTPS", url, versions: [{ eStat: { ml5: code } }] };
}
function config(streams = [stream()]) {
  return {
    data: {
      attributes: {
        rights: { begin: "2020-01-01T00:00:00Z", end: "2099-01-01T00:00:00Z" },
        metadata: {
          providerId: "123456-001-A",
          title: "Nordfall",
          subtitle: "(1/6)",
          link: { url: "https://www.arte.tv/de/videos/123456-001-A/nordfall/" },
          duration: { seconds: 2400 },
        },
        streams,
      },
    },
  };
}
function mockPlayer(value = config(), status = 200) {
  vi.mocked(queryMediathekView).mockResolvedValue([
    { ...item, url_video: "https://fixture.akamaized.net/german.mp4" },
    { ...item, url_video: "https://fixture.akamaized.net/ov.mp4" },
    { ...item, url_video: "https://fixture.akamaized.net/ad.mp4" },
  ]);
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response(JSON.stringify(value), { status })
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe("ARTE source and edition contracts", () => {
  it("accepts only exact official HTTPS video pages, never locale as audio", () => {
    expect(arteVideoId(item.url_website)).toBe("123456-001-A");
    for (const url of [
      "https://evil.arte.tv/de/videos/123456-001-A/",
      "https://www.arte.tv.evil.test/de/videos/123456-001-A/",
      "https://user:password@arte.tv/de/videos/123456-001-A/",
      "https://arte.tv/de/videos/LIVE/",
      "http://arte.tv/de/videos/123456-001-A/",
    ])
      expect(arteVideoId(url)).toBeNull();
    expect(parseArteVersion("VA")).toMatchObject({ audioLanguage: "de", originalVersion: false });
    expect(parseArteVersion("VOF-STA")).toMatchObject({
      audioLanguage: "fr",
      originalVersion: true,
      subtitleLanguage: "de",
    });
    expect(parseArteVersion("VAAUD")).toMatchObject({
      audioLanguage: "de",
      audioDescription: true,
    });
    expect(parseArteVersion("VO-STA")).toMatchObject({ audioLanguage: null });
    expect(parseArteVersion("VA-UNKNOWN")).toBeNull();
  });
  it("resolves the same ID before language filtering and passes current progressive URL", async () => {
    const fetch = mockPlayer(config([stream("VOF-STA", item.url_video), stream()]));
    const budget = new HttpRequestBudget();
    const result = await resolveArteSeriesEditions([item], show, budget);
    expect(result).toHaveLength(2);
    expect(result!.find((item) => item.audioLanguage === "de")).toMatchObject({
      audioLanguage: "de",
      title: "Nordfall: (1/6)",
      url_video: "https://fixture.akamaized.net/german.mp4",
      url_video_hd: "",
      size: 0,
    });
    expect(selectLanguageVariants(result!, readLanguagePolicy(null))).toHaveLength(1);
    expect(budget.remainingAttempts).toBe(9); // The mocked index does not spend HTTP attempts.
    expect(fetch.mock.calls[0][0]).toBe("https://api.arte.tv/api/player/v2/config/de/123456-001-A");
    expect(fetch.mock.calls[0][1]).not.toHaveProperty("headers.x-validated-age");
  });
  it("never requests a foreign series in the same catalogue", async () => {
    const fetch = mockPlayer();
    expect(
      await resolveArteSeriesEditions(
        [{ ...item, title: "Other Series (1/6)" }],
        show,
        new HttpRequestBudget()
      )
    ).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "missing",
    "foreign-id",
    "coordinates",
    "unknown-code",
    "hls",
    "conflicting-versions",
    "geoblocked",
    "expired",
  ])("fails closed for %s", async (kind) => {
    const value = config();
    if (kind === "missing") value.data.attributes.streams = [stream("VF")];
    if (kind === "foreign-id") value.data.attributes.metadata.providerId = "654321-001-A";
    if (kind === "coordinates") value.data.attributes.metadata.subtitle = "(2/6)";
    if (kind === "unknown-code") value.data.attributes.streams = [stream("VA-UNKNOWN")];
    if (kind === "hls") value.data.attributes.streams[0].protocol = "HLS";
    if (kind === "conflicting-versions")
      value.data.attributes.streams[0].versions.push({ eStat: { ml5: "VF" } });
    if (kind === "geoblocked")
      Object.assign(value.data.attributes, {
        restriction: { geoblocking: { restrictedArea: true } },
      });
    if (kind === "expired") value.data.attributes.rights.end = "2020-01-02T00:00:00Z";
    mockPlayer(value);
    const result = await resolveArteSeriesEditions([item], show, new HttpRequestBudget());
    expect(
      result === null ? null : selectLanguageVariants(result, readLanguagePolicy(null))
    ).toEqual(kind === "foreign-id" ? null : []);
  });
  it("distinguishes absent editions from provider outage without partial results", async () => {
    mockPlayer(config(), 404);
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toEqual([]);
    mockPlayer(config(), 403);
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toBeNull();
  });
  it("keeps verified OV and AD independently of row and stream order", async () => {
    const streams = [
      stream("VOA", "https://fixture.akamaized.net/ov.mp4"),
      stream("VAAUD", "https://fixture.akamaized.net/ad.mp4"),
      stream(),
    ];
    mockPlayer(config(streams));
    const first = await resolveArteSeriesEditions(
      [item, { ...item, url_video: "https://fixture.akamaized.net/other.mp4" }],
      show,
      new HttpRequestBudget()
    );
    mockPlayer(config(streams.reverse()));
    const second = await resolveArteSeriesEditions(
      [{ ...item, url_video: "https://fixture.akamaized.net/other.mp4" }, item],
      show,
      new HttpRequestBudget()
    );
    expect(first).toEqual(second);
    expect(first).toHaveLength(3);
    expect(first!.find((value) => value.originalVersion)?.audioLanguage).toBe("de");
    expect(first!.find((value) => value.audioDescription)?.audioLanguage).toBe("de");
  });
  it("does not retain an outage or signed URL across later calls", async () => {
    mockPlayer(config(), 403);
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toBeNull();
    mockPlayer(config([stream("VA", "https://fixture.akamaized.net/german.mp4?sig=new")]));
    expect(
      (await resolveArteSeriesEditions([item], show, new HttpRequestBudget()))![0].url_video
    ).toContain("sig=new");
  });
  it("rejects contradictory audio codes for one rendition regardless of stream order", async () => {
    const streams = [stream("VA"), stream("VF")];
    mockPlayer(config(streams));
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toEqual([]);
    mockPlayer(config(streams.reverse()));
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toEqual([]);
  });
  it("uses indexed quality slots and rejects a foreign ID from the German-title search", async () => {
    mockPlayer();
    vi.mocked(queryMediathekView).mockResolvedValue([
      { ...item, url_video: "", url_video_hd: "https://fixture.akamaized.net/german.mp4" },
      {
        ...item,
        url_website: "https://www.arte.tv/de/videos/654321-001-A/",
        url_video: "https://fixture.akamaized.net/german.mp4",
      },
    ]);
    const result = await resolveArteSeriesEditions([item], show, new HttpRequestBudget());
    expect(result).toHaveLength(1);
    expect(result![0]).toMatchObject({
      url_video: "",
      url_video_hd: "https://fixture.akamaized.net/german.mp4",
    });
    expect(queryMediathekView).toHaveBeenLastCalledWith(
      [{ fields: ["title"], query: "Nordfall" }],
      1000,
      expect.objectContaining({ offset: 0 })
    );
  });
  it("does not publish the first edition page when a later page fails", async () => {
    mockPlayer();
    vi.mocked(queryMediathekView)
      .mockResolvedValueOnce(
        Array.from({ length: 1000 }, () => ({
          ...item,
          url_video: "https://fixture.akamaized.net/german.mp4",
        }))
      )
      .mockResolvedValueOnce(null);
    expect(await resolveArteSeriesEditions([item], show, new HttpRequestBudget())).toBeNull();
    expect(queryMediathekView).toHaveBeenLastCalledWith(
      expect.any(Array),
      1000,
      expect.objectContaining({ offset: 1000 })
    );
  });
});
