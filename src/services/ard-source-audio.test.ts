import { afterEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import type { ApiResultItem } from "@/types";
import { ardEdition, ardVideoId, getArdMedia } from "./ard-source-audio";
import { enrichSourceAudio, mediaSourceIdentity, verifySourceAudio } from "./source-audio";
import { classifyLanguageEdition } from "./language-editions";
import { generateGenericRssItems } from "./newznab";
import { generateFakeNzb } from "./nzb-release";
import { parseNzbContent } from "./download";

const id = Buffer.from("crid://example.invalid/synthetic/one").toString("base64url");
const url = "https://ctv-videos.daserste.de/synthetic/one.mp4?quality=hd";
function page() {
  return {
    id: "different-page-id",
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
                media: [
                  {
                    url,
                    mimeType: "video/mp4",
                    audios: [{ languageCode: "deu", kind: "standard" }],
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
  };
}
const item: ApiResultItem = {
  channel: "ARD",
  topic: "Synthetic Harbour",
  title: "Episode (OV)",
  description: "",
  duration: 120,
  size: 123456,
  filmlisteTimestamp: 1700000000,
  url_website: `https://www.ardmediathek.de/video/synthetic/${id}`,
  url_video: url,
  url_video_hd: "",
  url_video_low: "",
};
function mock(value = page(), status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

it("accepts only canonical video identities and fetches the fixed JSON endpoint without redirects", async () => {
  expect(ardVideoId(item.url_website)).toBe(id);
  for (const website of [
    item.url_website.replace("https:", "http:"),
    item.url_website.replace("www.ardmediathek.de", "example.invalid"),
    item.url_website.replace("/video/", "/serie/"),
    `${item.url_website}?other=1`,
    `${item.url_website}#other`,
    `https://private:secret@www.ardmediathek.de/video/${id}`,
    `https://www.ardmediathek.de/video/${Buffer.from("not-a-crid").toString("base64url")}`,
  ])
    expect(ardVideoId(website)).toBeNull();
  const fetch = mock();
  const media = await getArdMedia(id, new HttpRequestBudget());
  expect(ardEdition(media, url)).toEqual({
    audioLanguage: "de",
    originalVersion: false,
    audioDescription: false,
    clearSpeech: false,
  });
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    `https://api.ardmediathek.de/page-gateway/pages/ard/item/${id}?embedded=true`,
    expect.objectContaining({ redirect: "error" })
  );
  await expect(getArdMedia("invalid", new HttpRequestBudget())).rejects.toThrow(
    "Invalid source identity"
  );
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each(["foreign-id", "expired", "login", "fsk", "geoblocked", "multiple-players"])(
  "does not use unavailable or ambiguous player evidence: %s",
  async (kind) => {
    const value = page();
    const player = value.widgets[0];
    if (kind === "foreign-id")
      player.id = Buffer.from("crid://other.invalid/video").toString("base64url");
    if (kind === "expired") player.availableTo = "2000-01-01T00:00:00Z";
    if (kind === "login") player.blockedByLoginOnly = true;
    if (kind === "fsk") player.blockedByFsk = true;
    if (kind === "geoblocked") player.geoblocked = true;
    if (kind === "multiple-players") value.widgets.push(player);
    mock(value);
    expect(await getArdMedia(id, new HttpRequestBudget())).toEqual([]);
  }
);

it.each(["selector", "mixed", "unknown", "no-audio", "unknown-kind", "hls", "auxiliary"])(
  "never infers German from original language or site locale with %s",
  async (kind) => {
    const value = page();
    const entry = value.widgets[0].mediaCollection.embedded.streams[0].media[0];
    if (kind === "selector") entry.url += "&audio=other";
    if (kind === "mixed") entry.audios.push({ languageCode: "fra", kind: "standard" });
    if (kind === "unknown") entry.audios[0].languageCode = "und";
    if (kind === "no-audio") entry.audios = [];
    if (kind === "unknown-kind") entry.audios[0].kind = "unconfirmed";
    if (kind === "hls") entry.mimeType = "application/vnd.apple.mpegurl";
    if (kind === "auxiliary")
      value.widgets[0].mediaCollection.embedded.streams[0].kind = "sign-language";
    mock(value);
    expect(ardEdition(await getArdMedia(id, new HttpRequestBudget()), url)).toBeNull();
  }
);

it("carries exact rendition evidence through RSS/NZB and requires fresh worker verification", async () => {
  const fetch = mock();
  const enriched = (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!;
  expect(enriched).toHaveLength(1);
  expect(classifyLanguageEdition(enriched[0])).toMatchObject({
    audioLanguage: "de",
    originalVersion: false,
  });
  expect(item).not.toHaveProperty("audioLanguage");
  const [rss] = generateGenericRssItems(enriched[0], "best", false, "tv");
  expect(rss.title).toContain("GERMAN.720p");
  const query = new URL(rss.enclosure.url, "http://localhost").searchParams;
  const { decodeMediaExpectations } = await import("./nzb-release");
  const expected = decodeMediaExpectations(query.get("encodedExpectations")!);
  expect(expected).toMatchObject({
    version: 2,
    audio: null,
    sourceAudio: {
      provider: "ard_media",
      videoId: id,
      language: "de",
      mediaIdentity: mediaSourceIdentity(url),
    },
    resolution: { width: 1280, height: 720 },
  });
  const nzb = generateFakeNzb({ title: rss.title, url, mediaExpectations: expected });
  expect(parseNzbContent(nzb)).toEqual({ title: rss.title, url, mediaExpectations: expected });
  if (expected.version !== 2) throw new Error("Expected source evidence");
  await expect(
    verifySourceAudio(expected.sourceAudio, url, new HttpRequestBudget())
  ).resolves.toEqual(expected.sourceAudio);
  expect(fetch).toHaveBeenCalledTimes(2);
  await expect(
    verifySourceAudio(expected.sourceAudio, `${url}&audio=fr`, new HttpRequestBudget())
  ).rejects.toThrow("Source evidence mismatch");
  const foreign = page();
  foreign.widgets[0].mediaCollection.embedded.streams[0].media[0].audios[0].languageCode = "fra";
  mock(foreign);
  await expect(
    verifySourceAudio(expected.sourceAudio, url, new HttpRequestBudget())
  ).rejects.toThrow("Source evidence mismatch");
});

it.each(["audio-description", "speech-optimized"])(
  "retains provider-declared edition kind %s",
  async (kind) => {
    const value = page();
    value.widgets[0].mediaCollection.embedded.streams[0].media[0].audios[0].kind = kind;
    mock(value);
    expect(ardEdition(await getArdMedia(id, new HttpRequestBudget()), url)).toMatchObject({
      audioDescription: kind === "audio-description",
      clearSpeech: kind === "speech-optimized",
    });
  }
);

it("rejects malformed/oversized source responses with a bounded, non-secret error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ private: "synthetic-secret" })))
  );
  await expect(getArdMedia(id, new HttpRequestBudget())).rejects.toThrow(
    /^Source evidence unavailable$/
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("x".repeat(1024 * 1024 + 1)))
  );
  await expect(getArdMedia(id, new HttpRequestBudget())).rejects.toThrow(
    /^Source evidence unavailable$/
  );
});
