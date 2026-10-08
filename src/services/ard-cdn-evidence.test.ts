import { afterEach, expect, it, vi } from "vitest";
import type { ApiResultItem } from "@/types";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { isArdProgressiveMp4 } from "./ard-source-audio";
import { enrichSourceAudio, mediaSourceIdentity, verifySourceAudio } from "./source-audio";

const id = Buffer.from("crid://example.invalid/synthetic/cdn-film").toString("base64url");
const urls = ["1080", "720", "360"].map(
  (height) => `https://rbb-progressive.ard-mcdn.de/synthetic/film-${height}.mp4?edition=standard`
);
const item: ApiResultItem = {
  channel: "RBB",
  topic: "Synthetic Film",
  title: "Synthetic Film",
  description: "",
  duration: 600,
  size: 123456,
  filmlisteTimestamp: 1700000000,
  url_website: `https://www.ardmediathek.de/video/${id}`,
  url_video_hd: urls[0],
  url_video: urls[1],
  url_video_low: urls[2],
};
const dimensions = [
  [1920, 1080],
  [1280, 720],
  [640, 360],
];
function page() {
  return {
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
                media: urls.map((url, index) => ({
                  url,
                  mimeType: "video/mp4",
                  audios: [{ kind: "standard", languageCode: "deu" }],
                  maxHResolutionPx: dimensions[index][0],
                  maxVResolutionPx: dimensions[index][1],
                })),
              },
            ],
          },
        },
      },
    ],
  };
}
function mock(value = page()) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

it("revalidates a stored RBB expectation independently of the current producer", async () => {
  const fetch = mock();
  const evidence = {
    provider: "ard_media" as const,
    videoId: id,
    language: "de",
    mediaIdentity: mediaSourceIdentity(urls[0]),
  };
  await expect(verifySourceAudio(evidence, urls[0], new HttpRequestBudget())).resolves.toEqual(
    evidence
  );
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    `https://api.ardmediathek.de/page-gateway/pages/ard/item/${id}?embedded=true`,
    expect.objectContaining({ redirect: "error" })
  );
});

it.each([
  "http://rbb-progressive.ard-mcdn.de/film.mp4",
  "https://rbb-progressive.ard-mcdn.de.evil.invalid/film.mp4",
  "https://other.ard-mcdn.de/film.mp4",
  "https://rbb-progressive.ard-mcdn.de:8443/film.mp4",
  "https://private:secret@rbb-progressive.ard-mcdn.de/film.mp4",
  "https://rbb-progressive.ard-mcdn.de/film.m3u8",
  `${urls[0]}#other`,
  "not-a-url",
])("rejects untrusted ARD asset %s without a provider request", async (url) => {
  const fetch = mock();
  expect(isArdProgressiveMp4(url)).toBe(false);
  const candidate = { ...item, url_video: url, url_video_hd: "", url_video_low: "" };
  expect((await enrichSourceAudio([candidate], new HttpRequestBudget())).get(candidate)).toEqual([
    candidate,
  ]);
  await expect(
    verifySourceAudio(
      {
        provider: "ard_media",
        videoId: id,
        language: "de",
        mediaIdentity: mediaSourceIdentity(url),
      },
      url,
      new HttpRequestBudget()
    )
  ).rejects.toThrow("Source evidence mismatch");
  expect(fetch).not.toHaveBeenCalled();
});

it.each([
  "selector",
  "foreign-id",
  "french",
  "mixed",
  "unknown",
  "auxiliary",
  "expired",
  "blocked",
])("rejects changed RBB worker evidence: %s", async (kind) => {
  const value = page();
  const player = value.widgets[0],
    stream = player.mediaCollection.embedded.streams[0];
  if (kind === "selector") stream.media[0].url += "&audio=other";
  if (kind === "foreign-id")
    player.id = Buffer.from("crid://example.invalid/other").toString("base64url");
  if (kind === "french") stream.media[0].audios[0].languageCode = "fra";
  if (kind === "mixed") stream.media[0].audios.push({ kind: "standard", languageCode: "fra" });
  if (kind === "unknown") stream.media[0].audios[0].languageCode = "und";
  if (kind === "auxiliary") stream.kind = "sign-language";
  if (kind === "expired") player.availableTo = "2000-01-01T00:00:00Z";
  if (kind === "blocked") player.blockedByLoginOnly = true;
  const fetch = mock(value);
  await expect(
    verifySourceAudio(
      {
        provider: "ard_media",
        videoId: id,
        language: "de",
        mediaIdentity: mediaSourceIdentity(urls[0]),
      },
      urls[0],
      new HttpRequestBudget()
    )
  ).rejects.toThrow("Source evidence mismatch");
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("cannot transfer RBB evidence across selectors or invent it from an RBB sender label", async () => {
  const fetch = mock();
  const candidate = { ...item, url_website: "https://example.invalid/film" };
  expect((await enrichSourceAudio([candidate], new HttpRequestBudget())).get(candidate)).toEqual([
    candidate,
  ]);
  await expect(
    verifySourceAudio(
      {
        provider: "ard_media",
        videoId: id,
        language: "de",
        mediaIdentity: mediaSourceIdentity(urls[0]),
      },
      `${urls[0]}&audio=other`,
      new HttpRequestBudget()
    )
  ).rejects.toThrow("Source evidence mismatch");
  expect(fetch).not.toHaveBeenCalled();
});
