import { afterEach, expect, it, vi } from "vitest";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { readLanguagePolicy } from "@/lib/language-policy";
import { unknownJobMediaExpectations } from "@/lib/media-expectations";
import type { ApiResultItem } from "@/types";
import { enrichSourceAudio, mediaSourceIdentity, verifyArteSourceAudio } from "./source-audio";
import { selectLanguageVariants } from "./language-editions";
import { progressiveUrl } from "./arte-editions";
import { buildReleaseGuid, generateMovieRssItems } from "./newznab";
import { releaseMediaExpectations } from "./release-media-expectations";
import { decodeMediaExpectations, generateFakeNzb } from "./nzb-release";
import { parseNzbContent } from "./download";

const item: ApiResultItem = {
  channel: "ARTE.DE",
  topic: "Kino - Filme",
  title: "Synthetic Film",
  description: "",
  duration: 7200,
  size: 1_000_000,
  filmlisteTimestamp: 1700000000,
  url_website: "https://www.arte.tv/de/videos/123456-001-A/synthetic/",
  url_video: "https://fixture.akamaized.net/french.mp4",
  url_video_hd: "https://fixture.akamaized.net/german.mp4",
  url_video_low: "https://fixture.akamaized.net/unknown.mp4",
};
const streams = (code = "VA") => ({
  videoStreams: [
    { programId: "123456-001-A", url: item.url_video, audioCode: "VOF-STA" },
    {
      programId: "123456-001-A",
      url: item.url_video_hd.replace("https:", "http:"),
      audioCode: code,
    },
  ],
});
function mock(value: unknown = streams(), status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json(value, { status }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

it("accepts only the confirmed ARTE legacy CDN and binds its exact HbbTV URL in producer and worker", async () => {
  const url = "https://arteptweb-a.akamaihd.net/synthetic/episode.mp4";
  expect(progressiveUrl(url)).toBe(true);
  for (const host of ["arteptweb-a.akamaihd.net.evil.test", "other.akamaihd.net"])
    expect(progressiveUrl(url.replace("arteptweb-a.akamaihd.net", host))).toBe(false);
  const source = { ...item, url_video: url, url_video_hd: "", url_video_low: "" };
  const fetch = mock({
    videoStreams: [
      { programId: "123456-001-A", url: url.replace("https:", "http:"), audioCode: "VA" },
    ],
  });
  const [enriched] = (await enrichSourceAudio([source], new HttpRequestBudget())).get(source)!;
  expect(enriched.audioLanguage).toBe("de");
  const expected = releaseMediaExpectations(enriched);
  if (expected.version !== 3 || !expected.sourceAudio)
    throw new Error("Expected exact source proof");
  await expect(
    verifyArteSourceAudio(expected.sourceAudio, url, new HttpRequestBudget())
  ).resolves.toEqual(expected.sourceAudio);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it.each(["valid", "foreign-id", "selector", "conflict", "missing", "string"])(
  "binds dimension evidence independently of audio only to the exact programme/URL: %s",
  async (kind) => {
    const entry = { ...streams().videoStreams[1], width: 1280, height: 720 };
    if (kind === "foreign-id") entry.programId = "654321-001-A";
    if (kind === "selector") entry.url += "?other=1";
    const declarations: unknown[] = [entry];
    if (kind === "conflict") declarations.push({ ...entry, width: 1920, height: 1080 });
    if (kind === "missing") declarations.push(streams().videoStreams[1]);
    if (kind === "string") declarations[0] = { ...entry, width: "1280" };
    const fetch = mock({ videoStreams: [streams().videoStreams[0], ...declarations] });
    const output = (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!;
    const hd = output.find((i) => i.url_video_hd)!;
    const contract = releaseMediaExpectations(hd, null, hd.url_video_hd);
    expect(contract.resolution).toEqual(
      kind === "valid"
        ? {
            width: 1280,
            height: 720,
            provenance: "provider_dimensions",
          }
        : null
    );
    expect(releaseMediaExpectations(output.find((i) => i.url_video)!).resolution).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(item).not.toHaveProperty("sourceVideoDimensions");
    if (!["foreign-id", "selector"].includes(kind)) {
      expect(contract.version).toBe(3);
      expect(contract.version === 3 && contract.sourceAudio?.language).toBe("de");
    }
  }
);

it("binds each rendition before selection without inferring German from source locale", async () => {
  const fetch = mock();
  const map = await enrichSourceAudio([item], new HttpRequestBudget());
  const renditions = map.get(item)!;
  expect(renditions).toHaveLength(3);
  expect(renditions.find((i) => i.url_video)?.audioLanguage).toBe("fr");
  expect(renditions.find((i) => i.url_video_low)?.audioLanguage).toBeUndefined();
  const selected = selectLanguageVariants(renditions, readLanguagePolicy(null));
  expect(selected).toHaveLength(1);
  expect(selected[0]).toMatchObject({
    audioLanguage: "de",
    url_video: "",
    url_video_hd: item.url_video_hd,
  });
  expect(item).not.toHaveProperty("audioLanguage");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0][0]).toBe(
    "https://www.arte.tv/hbbtvv2/services/web/index.php/OPA/v3/streams/123456-001-A/SHOW/de"
  );
  expect(fetch.mock.calls[0][1]).toMatchObject({ redirect: "error" });
});

it("preserves source GUID while German RSS/NZB and v3 worker expectations use the selected URL", async () => {
  mock();
  const [proved] = selectLanguageVariants(
    (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!,
    readLanguagePolicy(null)
  );
  const before = buildReleaseGuid(item, "1080p", item.url_video_hd, "candidate:movie");
  const rss = generateMovieRssItems(
    { item: proved, score: 1, titleMatch: "exact", durationDiff: 0 },
    {
      tmdbId: 7,
      title: item.title,
      germanTitle: item.title,
      productionYear: 2020,
      runtime: 120,
      imdbId: null,
      releaseDate: null,
    },
    "all"
  );
  expect(rss).toHaveLength(1);
  expect(rss[0].guid.value).toBe(before);
  expect(rss[0].title).toContain(".2020.GERMAN.UNKNOWN.");
  const query = new URL(rss[0].enclosure.url, "http://localhost").searchParams;
  const contract = decodeMediaExpectations(query.get("encodedExpectations")!);
  expect(contract).toEqual({
    ...unknownJobMediaExpectations(),
    mediaKind: "movie",
    durations: {
      source: { seconds: 7200, provenance: "source_catalogue", tolerancePercent: 10 },
      metadata: null,
    },
    sourceAudio: {
      provider: "arte_hbbtv",
      videoId: "123456-001-A",
      language: "de",
      mediaIdentity: mediaSourceIdentity(item.url_video_hd),
    },
  });
  const parsed = parseNzbContent(
    generateFakeNzb({ title: rss[0].title, url: item.url_video_hd, mediaExpectations: contract })
  );
  expect(parsed).toEqual({
    title: rss[0].title,
    url: item.url_video_hd,
    mediaExpectations: contract,
  });
  expect(() => releaseMediaExpectations(proved, null, item.url_video)).toThrow(
    "Source evidence mismatch"
  );
});

it.each(["foreign-id", "different-selector", "unknown-code", "conflicting-code"])(
  "does not attach German evidence for %s",
  async (kind) => {
    const value = streams();
    if (kind === "foreign-id") value.videoStreams[1].programId = "654321-001-A";
    if (kind === "different-selector") value.videoStreams[1].url += "?audio=de";
    if (kind === "unknown-code") value.videoStreams[1].audioCode = "VA-UNCONFIRMED";
    if (kind === "conflicting-code")
      value.videoStreams.push({ ...value.videoStreams[1], audioCode: "VF" });
    mock(value);
    const output = (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!;
    const hd = output.find((i) => i.url_video_hd)!;
    expect(hd.audioLanguage).toBeUndefined();
    expect(releaseMediaExpectations(hd).audio).toBeNull();
    expect(releaseMediaExpectations(hd).version).toBe(3);
    expect(releaseMediaExpectations(hd).sourceAudio).toBeNull();
  }
);

it("keeps OV/subtitle and AD distinct, never equating French with German subtitles to German audio", async () => {
  mock(streams("VAAUD"));
  const output = (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!;
  expect(output.find((i) => i.url_video)).toMatchObject({
    audioLanguage: "fr",
    subtitleLanguage: "de",
    originalVersion: true,
  });
  expect(output.find((i) => i.url_video_hd)).toMatchObject({
    audioLanguage: "de",
    audioDescription: true,
  });
  expect(
    selectLanguageVariants(output, { ...readLanguagePolicy(null), includeAudioDescription: false })
  ).not.toContainEqual(expect.objectContaining({ audioDescription: true }));
});

it("distinguishes missing evidence from outages and invalid bodies, never publishing partial enrichment", async () => {
  mock(streams(), 404);
  const unknown = (await enrichSourceAudio([item], new HttpRequestBudget())).get(item)!;
  expect(unknown.every((i) => !i.sourceAudioEvidence && !i.audioLanguage)).toBe(true);
  mock(streams(), 503);
  await expect(enrichSourceAudio([item], new HttpRequestBudget())).rejects.toThrow(
    "Source evidence unavailable"
  );
  mock({ videoStreams: [{ ...streams().videoStreams[0], audioCode: "x".repeat(1024 * 1024) }] });
  await expect(enrichSourceAudio([item], new HttpRequestBudget())).rejects.toThrow(
    "Source evidence unavailable"
  );
});

it("uses bounded deterministic identities and does not reset an exhausted caller budget", async () => {
  const fetch = mock();
  const items = Array.from({ length: 6 }, (_, index) => ({
    ...item,
    url_website: `https://www.arte.tv/de/videos/123456-00${index}-A/synthetic/`,
  }));
  await enrichSourceAudio([...items].reverse(), new HttpRequestBudget());
  expect(fetch).toHaveBeenCalledTimes(4);
  fetch.mockClear();
  const budget = new HttpRequestBudget(1);
  budget.takeAttempt();
  expect(
    (await enrichSourceAudio([item], budget)).get(item)!.every((i) => !i.sourceAudioEvidence)
  ).toBe(true);
  expect(fetch).not.toHaveBeenCalled();
});

it("revalidates worker promises against the exact URL and current provider edition, not NZB assertions", async () => {
  const fetch = mock();
  const expected = {
    provider: "arte_hbbtv" as const,
    videoId: "123456-001-A",
    language: "de",
    mediaIdentity: mediaSourceIdentity(item.url_video_hd),
  };
  expect(
    await verifyArteSourceAudio(expected, item.url_video_hd, new HttpRequestBudget(1))
  ).toEqual(expected);
  fetch.mockClear();
  await expect(
    verifyArteSourceAudio(expected, item.url_video, new HttpRequestBudget(1))
  ).rejects.toThrow("Source evidence mismatch");
  expect(fetch).not.toHaveBeenCalled();
  mock(streams("VF"));
  await expect(
    verifyArteSourceAudio(expected, item.url_video_hd, new HttpRequestBudget(1))
  ).rejects.toThrow("Source evidence mismatch");
});
