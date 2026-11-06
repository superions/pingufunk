import { afterEach, expect, it, vi } from "vitest";
import { parseArteHls, isArteHls } from "./arte-hls";
import { enrichSourceAudio } from "./source-audio";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { generateMovieRssItems } from "./newznab";
import type { ApiResultItem } from "@/types";
import { sourceMediaFacts } from "./source-media-facts";
import { selectLanguageVariants } from "./language-editions";
import { DEFAULT_LANGUAGE_POLICY } from "@/lib/language-policy";

const master =
  "https://manifest-arte.akamaized.net/api/manifest/v1/Generate/synthetic/de/XQ/123456-001-B.m3u8";
const base = "https://fixture.akamaized.net/am/123456-001-B/";
const manifest = `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="fr",NAME="Original",DEFAULT=YES,CHARACTERISTICS="tv.arte.audio.version.vo-fra",URI="${base}original.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="de",NAME="Deutsch (Audiodeskription)",CHARACTERISTICS="tv.arte.audio.version.vaaud-deu,public.accessibility.describes-video",URI="${base}ad.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="de",NAME="Deutsch (Klare Sprache)",CHARACTERISTICS="tv.arte.audio.version.voa-deu,public.accessibility.enhances-speech-intelligibility",URI="${base}clear.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="de",NAME="Deutsch",DEFAULT=NO,CHARACTERISTICS="tv.arte.audio.version.va-deu",URI="${base}german.m3u8"
#EXT-X-STREAM-INF:CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="audio"
${base}video1080.m3u8
#EXT-X-STREAM-INF:CODECS="avc1.64001F,mp4a.40.2",RESOLUTION=1280x720,AUDIO="audio"
${base}video720.m3u8
`;

it("accepts the official secure manifest host and rejects lookalike hosts", () => {
  const secure = master.replace("//manifest-arte.", "//secure-manifest-arte.");
  expect(isArteHls(secure, "123456-001-A")).toBe(true);
  expect(parseArteHls(manifest, secure, 720).audioUrl).toBe(base + "german.m3u8");
  const reassembled = secure.replace("001-B.m3u8", "001-C.m3u8");
  expect(isArteHls(reassembled, "123456-001-A")).toBe(true);
  expect(parseArteHls(manifest.replaceAll("001-B/", "001-C/"), reassembled, 720).height).toBe(720);
  expect(isArteHls(secure.replace(".akamaized.net", ".akamaized.net.example.invalid"))).toBe(false);
});
afterEach(async () => {
  sourceMediaFacts.clear();
  await sourceMediaFacts.idle();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("advances past the foreground limit across automatic polls without manual searches", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const id = String(input).match(/(\d{6}-\d{3})-B\.m3u8/)![1];
    return new Response(manifest.replaceAll("123456-001", id));
  });
  vi.stubGlobal("fetch", fetch);
  const sources: ApiResultItem[] = Array.from({ length: 5 }, (_, i) => ({
    title: `Synthetic film ${i}`,
    channel: "ARTE.DE",
    topic: "Film",
    description: "",
    duration: 7200,
    size: 1,
    filmlisteTimestamp: 1,
    url_website: `https://www.arte.tv/de/videos/123456-00${i}-A/film/`,
    url_video: master.replaceAll("123456-001", `123456-00${i}`),
    url_video_low: "",
    url_video_hd: "",
  }));
  const first = await enrichSourceAudio(sources, new HttpRequestBudget());
  expect([...first.values()].flat()).toHaveLength(4);
  await sourceMediaFacts.idle();
  expect(fetch).toHaveBeenCalledTimes(5);
  const later = Date.now() + 30 * 60_000;
  vi.spyOn(Date, "now").mockReturnValue(later);
  const next = await enrichSourceAudio(sources, new HttpRequestBudget());
  expect([...next.values()].flat()).toHaveLength(5);
  expect([...next.values()].flat().every((item) => item.audioLanguage === "de")).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(5);
});

it("uses the explicit German language without requiring a provider version token", () => {
  const languageOnly = manifest
    .replace('LANGUAGE="de",NAME="Deutsch",', 'LANGUAGE="deu",NAME="Deutsch",')
    .replace('CHARACTERISTICS="tv.arte.audio.version.va-deu",', "");
  expect(parseArteHls(languageOnly, master, 720)).toEqual({
    audioUrl: base + "german.m3u8",
    videoUrl: base + "video720.m3u8",
    width: 1280,
    height: 720,
    originalVersion: false,
    clearSpeech: false,
  });
});

it.each(["only-ad", "foreign-programme", "foreign-host", "ambiguous", "no-video"])(
  "rejects %s instead of silently using original audio",
  (kind) => {
    let value = manifest;
    if (kind === "only-ad")
      value = value
        .split("\n")
        .filter((line) => !line.includes("clear.m3u8"))
        .join("\n")
        .replace('LANGUAGE="de",NAME="Deutsch",', 'LANGUAGE="fr",NAME="Deutsch",');
    if (kind === "foreign-programme") value = value.replaceAll("/123456-001-B/", "/654321-001-B/");
    if (kind === "foreign-host")
      value = value.replaceAll("fixture.akamaized.net", "example.invalid");
    if (kind === "ambiguous")
      value += `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",LANGUAGE="de",NAME="Deutsch",CHARACTERISTICS="tv.arte.audio.version.va-deu",URI="${base}other.m3u8"\n`;
    if (kind === "no-video") value = value.replaceAll("avc1.", "hvc1.");
    expect(() => parseArteHls(value, master)).toThrow();
  }
);

it("publishes the normal German film from a multi-edition master through enrichment and RSS", async () => {
  const sourceManifest = manifest.replaceAll("version.va-deu", "version.voa-deu");
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(sourceManifest));
  vi.stubGlobal("fetch", fetch);
  const source: ApiResultItem = {
    title: "Synthetic Movie",
    channel: "ARTE.DE",
    topic: "Kino",
    description: "",
    duration: 7200,
    size: 1,
    filmlisteTimestamp: 1,
    url_website: "https://www.arte.tv/de/videos/123456-001-A/synthetic/",
    url_video: master,
    url_video_hd: "",
    url_video_low: "",
  };
  const [item] = (await enrichSourceAudio([source], new HttpRequestBudget())).get(source)!;
  expect(item).toMatchObject({
    audioLanguage: "de",
    audioDescription: false,
    clearSpeech: false,
    originalVersion: true,
  });
  const [cached] = (await enrichSourceAudio([source], new HttpRequestBudget())).get(source)!;
  expect(cached).toMatchObject({ audioLanguage: "de", clearSpeech: false, originalVersion: true });
  const rss = generateMovieRssItems(
    { item, score: 1, titleMatch: "exact", durationDiff: 0 },
    {
      tmdbId: 1,
      title: source.title,
      germanTitle: source.title,
      productionYear: 2020,
      runtime: 120,
      imdbId: null,
      releaseDate: null,
    },
    "all",
    true
  );
  expect(rss).toHaveLength(1);
  expect(rss[0].title).toContain(".GERMAN.1080p.");
  expect(rss[0].title).not.toContain(".AD.");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(master);

  sourceMediaFacts.clear();
  const clearOnly = sourceManifest
    .split("\n")
    .filter((line) => !line.includes("german.m3u8"))
    .join("\n");
  fetch.mockImplementation(async () => new Response(clearOnly));
  await enrichSourceAudio([source], new HttpRequestBudget());
  const [clear] = (await enrichSourceAudio([source], new HttpRequestBudget())).get(source)!;
  expect(clear).toMatchObject({ audioLanguage: "de", clearSpeech: true, audioDescription: false });
  expect(
    selectLanguageVariants([clear], { ...DEFAULT_LANGUAGE_POLICY, includeClearSpeech: false })
  ).toEqual([]);
  expect(
    selectLanguageVariants([clear], { ...DEFAULT_LANGUAGE_POLICY, includeClearSpeech: true })
  ).toHaveLength(1);
});
