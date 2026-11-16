import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { parseStringPromise } from "xml2js";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { mp4RangeResponse, syntheticMp4 } from "@/lib/__fixtures__/mp4";

const state = vi.hoisted(() => ({ malformed: false, mismatched: false }));
vi.mock("@/lib/settings", () => ({
  getSetting: async (key: string) =>
    (
      ({
        "integration.radarr.enabled": "true",
        "integration.radarr.url": "http://radarr:7878",
        "integration.radarr.inventoryMaxMiB": "8",
        "provider.youtube.enabled": "false",
        "provider.srf.enabled": "false",
        "download.quality": "all",
      }) as Record<string, string>
    )[key] ?? null,
  getMinDurationSeconds: async () => 300,
  withSettingsSnapshot: async <T>(operation: () => Promise<T>) => operation(),
}));
vi.mock("@/lib/db", () => ({ prisma: { config: {} } }));
import { getRadarrMovie } from "./radarr-provider";
import { fetchMovieSearchForRssSync } from "./mediathek";
import { clearMetadataCaches } from "@/lib/cache";
import { sourceMediaFacts } from "./source-media-facts";
import { GET as getRss } from "@/app/api/newznab/route";
import { GET as getNzb } from "@/app/api/newznab/fake_nzb_download/route";
import { parseNzbContent } from "./nzb-release";

const media =
  "https://arteptweb-a.akamaihd.net/am/ptweb/123000/123400/123456-001-A_SQ_0_VA_1_MP4-2200_fixture.mp4";
const movie = {
  tmdbId: 42,
  imdbId: "tt0000042",
  title: "Beispielfilm",
  originalTitle: "Synthetic Film",
  year: 2001,
  runtime: 90,
  alternateTitles: [],
  monitored: true,
};
beforeEach(() => {
  clearMetadataCaches();
  state.malformed = false;
  state.mismatched = false;
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY", "synthetic-radarr-key");
  vi.stubEnv("PINGUFUNK_RADARR_API_KEY_FILE", undefined);
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof globalThis.fetch>(async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "radarr") {
        if (url.pathname === "/api/v3/system/status")
          return Response.json({ version: "7.0.3.10918" });
        if (url.pathname === "/api/v3/movie")
          return Response.json([
            {
              ...movie,
              ...(state.malformed ? { title: "" } : {}),
              tmdbId: state.mismatched ? 99 : 42,
            },
          ]);
      }
      if (url.hostname === "mediathekviewweb.de")
        return Response.json({
          result: {
            results: [
              {
                title: "Beispielfilm (2001)",
                topic: "Kino",
                channel: "ARTE.DE",
                description: "",
                duration: 5400,
                size: 1,
                filmlisteTimestamp: 1,
                url_website: "https://www.arte.tv/de/videos/123456-001-A/synthetic/",
                url_video: media,
                url_video_hd: "",
                url_video_low: "",
              },
            ],
          },
        });
      if (url.toString() === media) return mp4RangeResponse(syntheticMp4(1280, 720), init!);
      throw new Error("Unexpected synthetic provider request");
    })
  );
});
afterEach(async () => {
  await sourceMediaFacts.idle();
  clearMetadataCaches();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("carries Radarr 7 API-v3 goals through real movie RSS enrichment and NZB without a product-version gate", async () => {
  const request = () => new NextRequest("http://fixture.invalid/api/newznab?t=movie&cat=2000");
  await getRss(request());
  await sourceMediaFacts.idle();
  const result = await getRss(request());
  expect(result.status).toBe(200);
  const xml = await result.text();
  const rss = await parseStringPromise(xml);
  const items = rss.rss.channel[0].item;
  expect(items).toHaveLength(1);
  expect(items[0].title[0]).toContain("Beispielfilm.2001.GERMAN.720p");
  expect(items[0]["newznab:attr"]).toContainEqual({ $: { name: "tmdbid", value: "42" } });
  const response = await getNzb(new NextRequest(items[0].enclosure[0].$.url));
  expect(parseNzbContent(await response.text())?.url).toBe(media);
  expect(await getRadarrMovie(42, null, new HttpRequestBudget())).toMatchObject({
    tmdbId: 42,
    germanTitle: "Beispielfilm",
    productionYear: 2001,
  });
});
it("withholds RSS for malformed movie metadata and rejects a conflicting requested identity", async () => {
  state.malformed = true;
  await expect(fetchMovieSearchForRssSync(100, 0)).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
  state.malformed = false;
  state.mismatched = true;
  await expect(getRadarrMovie(42, null, new HttpRequestBudget())).rejects.toThrow(
    "Optional movie metadata unavailable"
  );
});
