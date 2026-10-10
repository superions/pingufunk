// Reuse the exact disposable owner/database guard; never contact real providers.
await import("/qa/media-provider.mjs");
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const nativeFixtureFetch = globalThis.fetch;
const source = "https://rodlzdf-a.akamaihd.net/synthetic/runtime-review.mp4";
const series = {
  id: 7,
  tvdbId: 2147000001,
  title: "Synthetic Review Series",
  monitored: true,
  alternateTitles: [],
};
const file = readFileSync("/app/public/pingufunk-media-qa/review.mp4");
const etag = `"${createHash("sha256").update(file).digest("hex")}"`;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.href === source) {
    const range = new Headers(init?.headers).get("Range");
    const match = range && /^bytes=(\d+)-(\d+)$/.exec(range);
    const start = match ? Number(match[1]) : 0;
    const end = match ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
    if (start >= file.length) return new Response(null, { status: 416 });
    return new Response(file.subarray(start, end + 1), {
      status: match ? 206 : 200,
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(end - start + 1),
        ETag: etag,
        ...(match ? { "Content-Range": `bytes ${start}-${end}/${file.length}` } : {}),
      },
    });
  }
  if (url.hostname === "sonarr" && url.port === "8989") {
    if (url.pathname === "/api/v3/system/status") return Response.json({ version: "4.0.20.3014" });
    if (url.pathname === "/api/v3/series") return Response.json([series]);
    if (url.pathname === "/api/v3/episode")
      return Response.json([
        {
          id: 11,
          seriesId: 7,
          seasonNumber: 6,
          episodeNumber: 1,
          title: "TBA",
          airDateUtc: "2099-01-01T00:00:00Z",
          runtime: 1,
        },
      ]);
  }
  if (url.hostname === "raw.githubusercontent.com" && url.pathname.endsWith("/data/shows.json"))
    return Response.json([]);
  if (url.hostname === "mediathekviewweb.de" && url.pathname === "/api/query") {
    const query = JSON.parse(init?.body ?? "{}");
    const rows =
      Number(query.offset ?? 0) > 0
        ? []
        : [
            {
              channel: "ZDF",
              topic: series.title,
              title: "Concrete title (S06/E01)",
              description: "Synthetic runtime exception only",
              filmlisteTimestamp: 1700000000,
              duration: 72,
              size: file.length,
              url_website: "https://example.invalid/synthetic-review",
              url_video: "",
              url_video_hd: source,
              url_video_low: "",
            },
          ];
    return Response.json({
      result: { results: rows, queryInfo: { totalResults: rows.length } },
      err: null,
    });
  }
  return nativeFixtureFetch(input, init);
};
