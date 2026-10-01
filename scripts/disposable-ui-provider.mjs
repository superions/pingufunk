// Explicit preload for a disposable desktop QA runtime only. Never a product provider.
import { existsSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const configured = new URL(process.env.DATABASE_URL ?? "invalid:");
const file = configured.protocol === "file:" ? fileURLToPath(configured) : "";
if (
  process.env.PINGUFUNK_DISPOSABLE_UI_QA !== "1" ||
  !isAbsolute(file) ||
  !dirname(file).includes("ui-qa.") ||
  !existsSync(join(dirname(file), "synthetic-only.marker"))
)
  throw new Error("Explicit disposable UI fixture required");
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "mediathekviewweb.de" && url.pathname === "/api/query") {
    const body = JSON.parse(init?.body ?? "{}");
    const query = (body.queries ?? [])
      .map((row) => row.query)
      .join(" ")
      .toLowerCase();
    if (query.includes("synthetic-error"))
      return new Response("Synthetic provider failure", { status: 401 });
    const item = {
      channel: "SYNTHETIC",
      topic: "Synthetic UI",
      title: "Example S02E03",
      description: "Disposable desktop contract fixture; no real media or provider.",
      filmlisteTimestamp: 1700000000,
      duration: 120,
      size: 1000,
      url_website: "https://example.invalid/page",
      url_video: "https://example.invalid/sd.mp4",
      url_video_hd: "https://example.invalid/hd.mp4",
      url_video_low: "https://example.invalid/low.mp4",
    };
    const rows = query.includes("synthetic-empty") || Number(body.offset ?? 0) > 0 ? [] : [item];
    return Response.json({ result: { results: rows }, err: null });
  }
  // Next's own loopback requests are allowed; all external/download traffic is blocked.
  if (
    ["localhost", "127.0.0.1"].includes(url.hostname) &&
    url.port === process.env.PINGUFUNK_UI_QA_PORT
  )
    return nativeFetch(input, init);
  throw new Error("External traffic blocked in disposable UI QA");
};
