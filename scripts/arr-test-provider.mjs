const nativeFetch = globalThis.fetch;
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
await import("/qa/media-provider.mjs");
const sourceFetch = globalThis.fetch;
// The base provider validates the exact disposable DB and owner first.
// Only owned application aliases can receive integration API calls.
const ports = { sonarr: "8989", radarr: "7878", prowlarr: "9696", pingufunk: "6767" };
const sourceAudio = process.env.PINGUFUNK_ARR_QA_SOURCE_AUDIO === "1";
const renditionQuality = process.env.PINGUFUNK_ARR_QA_RENDITION_QUALITY;
const tvDelivery = process.env.PINGUFUNK_ARR_QA_TV_DELIVERY === "1";
const germanUrl = "https://fixture.akamaized.net/german.mp4";
const frenchUrl = "https://fixture.akamaized.net/french.mp4";
const ardId = Buffer.from("crid://example.invalid/synthetic/cdn-film").toString("base64url");
const ardUrl = "https://rbb-progressive.ard-mcdn.de/synthetic/film-1080.mp4?edition=standard";
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (
    tvDelivery &&
    /^https:\/\/rodlzdf-a\.akamaihd\.net\/synthetic\/delivery-\d{2}-\d{2}\.mp4$/.test(url.href)
  ) {
    const file = readFileSync("/qa/delivery.mp4");
    const range = new Headers(init?.headers).get("Range");
    const statsPath = "/qa/delivery-source-stats.json";
    const stats = existsSync(statsPath)
      ? JSON.parse(readFileSync(statsPath, "utf8"))
      : { ranges: 0, transfers: 0 };
    stats[range ? "ranges" : "transfers"]++;
    writeFileSync(statsPath, JSON.stringify(stats));
    const headers = {
      "Content-Type": "video/mp4",
      ETag: `"${createHash("sha256").update(file).digest("hex")}"`,
    };
    if (!range)
      return new Response(file, { headers: { ...headers, "Content-Length": String(file.length) } });
    await delay(800); // A cold foreground + single worker cannot finish all 40 before the response.
    const part = /^bytes=(\d+)-(\d+)$/.exec(range);
    if (!part) throw new Error("Owned exact bounded range required");
    const start = Number(part[1]),
      end = Math.min(Number(part[2]), file.length - 1);
    if (end - start >= 1_048_576) throw new Error("Owned range window exceeded");
    return new Response(file.subarray(start, end + 1), {
      status: 206,
      headers: {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${file.length}`,
        "Content-Length": String(end - start + 1),
      },
    });
  }
  if (
    url.protocol === "http:" &&
    ports[url.hostname] === url.port &&
    url.pathname.startsWith("/api/")
  )
    return nativeFetch(input, { ...init, redirect: "error" });
  if (
    sourceAudio &&
    renditionQuality === "ard-1080p" &&
    url.href === `https://api.ardmediathek.de/page-gateway/pages/ard/item/${ardId}?embedded=true`
  )
    return Response.json({
      widgets: [
        {
          id: ardId,
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
                      url: ardUrl,
                      mimeType: "video/mp4",
                      audios: [{ kind: "standard", languageCode: "deu" }],
                      maxHResolutionPx: 1920,
                      maxVResolutionPx: 1080,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    });
  if (
    sourceAudio &&
    url.href ===
      "https://www.arte.tv/hbbtvv2/services/web/index.php/OPA/v3/streams/123456-001-A/SHOW/de"
  )
    return Response.json({
      videoStreams: [
        {
          programId: "123456-001-A",
          url: germanUrl,
          audioCode: "VA",
          ...(["720p", "conflicting"].includes(renditionQuality)
            ? { width: 1280, height: 720 }
            : {}),
        },
        { programId: "123456-001-A", url: frenchUrl, audioCode: "VOF-STA" },
        ...(renditionQuality === "conflicting"
          ? [
              {
                programId: "123456-001-A",
                url: germanUrl,
                audioCode: "VA",
                width: 1920,
                height: 1080,
              },
            ]
          : []),
      ],
    });
  if (url.hostname === "mediathekviewweb.de" && url.pathname === "/api/query") {
    const response = await sourceFetch(input, init);
    const data = await response.json();
    // The correlation variant deliberately has no source year: native metadata
    // correlation, not an already parseable fixture, must satisfy Radarr.
    const body = JSON.parse(init?.body ?? "{}");
    const terms = (body.queries ?? []).map((entry) => String(entry.query ?? "").toLowerCase());
    const normalized = (value) => value.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
    const matches = (row) =>
      terms.every((term) =>
        normalized(`${row.channel} ${row.topic} ${row.title}`).includes(normalized(term))
      );
    const rows = [];
    for (const row of data.result.results) {
      row.topic = "Synthetic Media";
      row.title =
        process.env.PINGUFUNK_ARR_QA_MOVIE_CORRELATION === "1"
          ? "Synthetic Media"
          : "Synthetic Media (2024)";
      row.duration = 600;
      if (sourceAudio) {
        row.channel = "ARTE.DE";
        row.url_website = "https://www.arte.tv/de/videos/123456-001-A/synthetic/";
        row.url_video = frenchUrl;
        row.url_video_hd = germanUrl;
        row.url_video_low = "";
        if (renditionQuality === "ard-1080p") {
          row.channel = "RBB";
          row.url_website = `https://www.ardmediathek.de/video/${ardId}`;
          row.url_video = "";
          row.url_video_hd = ardUrl;
        }
      }
      if (matches(row)) rows.push(row);
      const episode = {
        ...row,
        topic: "Synthetic Series",
        title:
          process.env.PINGUFUNK_ARR_QA_LOCALIZED_EPISODE === "1"
            ? "Lokalisierter Quelltitel (S01E01)"
            : "Synthetic Series S01E01 - Synthetic Episode",
      };
      if (matches(episode)) rows.push(episode);
    }
    if (tvDelivery && terms.some((term) => normalized(term).includes("syntheticseries"))) {
      rows.length = 0;
      for (let season = 1; season <= 2; season++)
        for (let episode = 1; episode <= 40; episode++)
          rows.push({
            channel: "ZDF",
            topic: "Synthetic Series",
            title: `Synthetic Episode (S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")})`,
            description: "Owned cold-delivery fixture",
            filmlisteTimestamp: 1546387200,
            duration: 60,
            size: 0,
            url_website: `https://example.invalid/synthetic/delivery-${season}-${episode}`,
            url_video: "",
            url_video_low: "",
            url_video_hd: `https://rodlzdf-a.akamaihd.net/synthetic/delivery-${String(season).padStart(2, "0")}-${String(episode).padStart(2, "0")}.mp4`,
          });
      const offset = Number(body.offset ?? 0),
        size = Number(body.size ?? 1000);
      data.result.results = rows.slice(offset, offset + size);
      data.result.queryInfo = {
        totalResults: 80,
        resultCount: data.result.results.length,
        filmlisteTimestamp: 1546387200,
        searchEngineTime: 0,
      };
    } else if (tvDelivery && terms.length === 0) {
      // The primary feed really fills the complete bounded source window. An almost-empty fixture
      // would hide budget starvation between delivery, supplements and the catalogue.
      const offset = Number(body.offset ?? 0),
        size = Number(body.size ?? 1000);
      const statsPath = "/qa/delivery-source-stats.json";
      const stats = existsSync(statsPath)
        ? JSON.parse(readFileSync(statsPath, "utf8"))
        : { ranges: 0, transfers: 0 };
      stats.cataloguePages = (stats.cataloguePages ?? 0) + 1;
      writeFileSync(statsPath, JSON.stringify(stats));
      data.result.results = Array.from(
        { length: Math.max(0, Math.min(size, 5000 - offset)) },
        (_, i) => ({
          channel: "ZDF",
          topic: "Unrelated Programme",
          title: `Unrelated ${offset + i}`,
          description: "Owned primary RSS page",
          filmlisteTimestamp: 1546387200,
          duration: 60,
          size: 0,
          url_website: "https://example.invalid/unrelated",
          url_video: "https://example.invalid/unrelated.mp4",
          url_video_hd: "",
          url_video_low: "",
        })
      );
      data.result.queryInfo = {
        totalResults: 5000,
        resultCount: data.result.results.length,
        filmlisteTimestamp: 1546387200,
        searchEngineTime: 0,
      };
    } else data.result.results = rows;
    return Response.json(data);
  }
  return sourceFetch(input, init);
};
