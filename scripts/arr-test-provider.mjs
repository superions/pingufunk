const nativeFetch = globalThis.fetch;
await import("/qa/media-provider.mjs");
const sourceFetch = globalThis.fetch;
// The base provider validates the exact disposable DB and owner first.
// Only owned application aliases can receive integration API calls.
const ports = { sonarr: "8989", radarr: "7878", prowlarr: "9696", pingufunk: "6767" };
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (
    url.protocol === "http:" &&
    ports[url.hostname] === url.port &&
    url.pathname.startsWith("/api/")
  )
    return nativeFetch(input, { ...init, redirect: "error" });
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
      if (matches(row)) rows.push(row);
      const episode = {
        ...row,
        topic: "Synthetic Series",
        title: "Synthetic Series S01E01 - Synthetic Episode",
      };
      if (matches(episode)) rows.push(episode);
    }
    data.result.results = rows;
    return Response.json(data);
  }
  return sourceFetch(input, init);
};
