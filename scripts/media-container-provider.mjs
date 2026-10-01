// Explicit harness-only source. No broadcaster or Arr traffic is permitted.
const owner = process.env.PINGUFUNK_MEDIA_QA_OWNER;
const db = new URL(process.env.DATABASE_URL ?? "invalid:");
if (
  !/^\d+-\d+$/.test(owner ?? "") ||
  !(
    (db.protocol === "file:" && db.pathname === "/qa/database.sqlite") ||
    (db.protocol === "postgresql:" &&
      db.hostname === `pingufunk-media-pg-${owner}` &&
      db.pathname === "/pingufunk_media_qa" &&
      db.username === "pingufunk_media_qa")
  )
)
  throw new Error("Exact disposable media source required");

const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.hostname === "mediathekviewweb.de" && url.pathname === "/api/query") {
    const body = JSON.parse(init?.body ?? "{}");
    const rows =
      Number(body.offset ?? 0) > 0
        ? []
        : [
            {
              channel: "SYNTHETIC",
              topic: "Synthetic Media",
              title: "Valid",
              description: "Disposable source; no real programme or metadata identity",
              filmlisteTimestamp: 1700000000,
              duration: 2,
              size: 1000,
              url_website: "https://example.invalid/synthetic-media",
              url_video: "http://127.0.0.1:6767/pingufunk-media-qa/valid.mp4",
              url_video_hd: "",
              url_video_low: "",
            },
          ];
    return Response.json({ result: { results: rows }, err: null });
  }
  if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "6767")
    return nativeFetch(input, init);
  throw new Error("External traffic blocked in disposable media source");
};
