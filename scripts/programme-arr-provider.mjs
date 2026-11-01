import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Called only after the common fixture validates its disposable DB and network owner. */
export function programmeFixture(
  root,
  scope = process.env.PINGUFUNK_ARR_QA_PROGRAMME_SCOPE ?? "single"
) {
  if (!["single", "pair", "pair-tba"].includes(scope))
    throw Error("Owned programme scope required");
  const paired = scope !== "single";
  return (url, init) => {
    const path = join(root, "programme-mode.json");
    const mode = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : { binding: false, source: "valid" };
    const website = "https://example.invalid/programmes/" + (paired ? "whole" : "solstice");
    const source = {
      channel: "ZDF",
      topic: "Synthetic Series",
      title: paired ? "Whole Programme (S10/E13)" : "Source Solstice (S2019/E01)",
      description: "Owned synthetic explicitly bound programme",
      filmlisteTimestamp: 1700000000,
      duration: 120,
      size: 0,
      url_website: website,
      url_video: "https://rodlzdf-a.akamaihd.net/synthetic/programme-solstice.mp4",
      url_video_hd: "",
      url_video_low: "",
    };
    if (mode.source === "foreign") source.url_website += "-foreign";
    if (mode.source === "changed") source.title = "Canonical Solstice (S08/E01)";
    if (mode.source === "short") source.duration = 60;
    if (mode.source === "ad") source.title += " (Audiodeskription)";
    if (mode.source === "language")
      source.url_video = "https://rodlzdf-a.akamaihd.net/synthetic/programme-french.mp4";
    if (url.href === "https://raw.githubusercontent.com/superions/pingufunk/main/data/shows.json")
      return Response.json([
        {
          tvdbId: 2147483002,
          name: "Synthetic Series",
          germanName: "Synthetic Series",
          aliases: [],
          episodes: [],
          mediathekProgrammes: mode.binding
            ? paired
              ? [2, 3].map((episode) => ({
                  website,
                  source: { channel: "ZDF", title: "Whole Programme", season: 10, episode: 13 },
                  target: {
                    season: 0,
                    episode: mode.unverifiedTarget && episode === 3 ? 99 : episode,
                  },
                }))
              : [
                  {
                    website,
                    source: { channel: "ZDF", title: "Source Solstice", season: 2019, episode: 1 },
                    target: { season: 8, episode: mode.unverifiedTarget ? 99 : 1 },
                  },
                ]
            : [],
        },
      ]);
    if (url.hostname === "mediathekviewweb.de" && url.pathname === "/api/query") {
      const query = JSON.parse(init?.body ?? "{}");
      const normalize = (value) => value.normalize("NFC").toLowerCase();
      const matches = (query.queries ?? []).every((term) =>
        term.fields.some((field) =>
          normalize(String(source[field] ?? "")).includes(normalize(term.query))
        )
      );
      return Response.json({
        result: { results: matches && Number(query.offset ?? 0) === 0 ? [source] : [] },
        err: null,
      });
    }
    if (
      url.hostname === "rodlzdf-a.akamaihd.net" &&
      /^\/synthetic\/programme-(?:solstice|legacy|french)\.mp4$/.test(url.pathname)
    ) {
      const kind = /french/.test(url.pathname)
        ? "french"
        : /legacy/.test(url.pathname)
          ? "legacy"
          : "solstice";
      const bytes = readFileSync(
        join(root, kind === "french" ? "programme-french.mp4" : "programme.mp4")
      );
      const range = new Headers(init?.headers).get("Range");
      const match = range ? /^bytes=(\d+)-(\d+)$/.exec(range) : null;
      if (range && !match) throw Error("Owned exact programme range required");
      const start = match ? Number(match[1]) : 0;
      const end = match ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
      if (start > end) return new Response(null, { status: 416 });
      appendFileSync(
        join(root, "programme-requests.jsonl"),
        JSON.stringify({ kind, ranged: !!range, start, end }) + "\n"
      );
      return new Response(bytes.subarray(start, end + 1), {
        status: range ? 206 : 200,
        headers: {
          "Content-Type": "video/mp4",
          "Content-Length": String(end - start + 1),
          ETag: `"${createHash("sha256").update(bytes).digest("hex")}"`,
          ...(range ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } : {}),
        },
      });
    }
    return undefined;
  };
}
