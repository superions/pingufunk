import { expect, it } from "vitest";
import { allDownloads, downloadPollDelay, parseDownloadRead } from "./download-read";
import { parseDownloadPage, parseHistoryPage, parseQueuePage } from "./download-page";

it("preserves the native all-queue and omitted history contracts", () => {
  expect(parseDownloadRead(new URLSearchParams(), "queue")).toEqual(allDownloads);
  expect(
    parseDownloadRead(new URLSearchParams("start=0&limit=0&category=sonarr"), "queue")
  ).toMatchObject({ limit: 0, categories: ["sonarr"] });
  expect(
    parseDownloadRead(
      new URLSearchParams(
        "start=50&limit=50&cat=radarr&search=Episode&nzo_ids=old-id,new-id&failed_only=1"
      ),
      "history"
    )
  ).toEqual({
    start: 50,
    limit: 50,
    categories: ["radarr"],
    search: "Episode",
    ids: ["old-id", "new-id"],
    statuses: ["failed"],
  });
  expect(parseDownloadRead(new URLSearchParams("category=*"), "history").categories).toEqual([
    "default",
  ]);
});

it.each([
  "limit=-1",
  "limit=NaN",
  "limit=10001",
  "limit=1e3",
  "limit=50&limit=40",
  "start=1000001",
  "start=1.5",
  "start=",
  "cat=../sonarr",
  "cat=sonarr&category=radarr",
  "nzo_ids=one,,two",
  "nzo_ids=../job",
  "status=Cancelled",
  "status=Completed&failed_only=1",
  "failed_only=true",
  `search=${"x".repeat(201)}`,
  `nzo_ids=${Array.from({ length: 101 }, (_, i) => `id-${i}`).join(",")}`,
])("rejects invalid read parameters before querying: %s", (query) => {
  expect(() => parseDownloadRead(new URLSearchParams(query), "history")).toThrow(
    "Invalid download read parameters"
  );
});

it("polls only visible pages, backs off errors and distinguishes active jobs", () => {
  expect(downloadPollDelay(false, 10, false)).toBeNull();
  expect(downloadPollDelay(true, 10, false)).toBe(5000);
  expect(downloadPollDelay(true, 0, false)).toBe(30000);
  expect(downloadPollDelay(true, 10, true)).toBe(30000);
});

it("rejects late, malformed or truncated page acknowledgements", () => {
  const valid = {
    slots: [{ nzo_id: "old-id" }],
    start: 50,
    limit: 50,
    noofslots: 1050,
    noofslots_total: 1100,
  };
  expect(parseDownloadPage(valid, 50, 50).meta).toEqual({
    start: 50,
    limit: 50,
    noofslots: 1050,
    noofslots_total: 1100,
  });
  for (const change of [
    { start: 0 },
    { limit: 0 },
    { noofslots: -1 },
    { noofslots: NaN },
    { noofslots_total: 0 },
    { noofslots: 50 },
    { slots: Array.from({ length: 51 }, () => ({})) },
  ])
    expect(() => parseDownloadPage({ ...valid, ...change }, 50, 50)).toThrow(
      "Invalid download page"
    );
  expect(() => parseQueuePage(valid, 50, 50)).toThrow("Invalid download page");
  expect(() => parseHistoryPage({ ...valid, slots: [null] }, 50, 50)).toThrow(
    "Invalid download page"
  );
});
