import { afterEach, expect, it, vi } from "vitest";
import { fetchArteMovieMetadata, parseArteMoviePage } from "./arte-movie-metadata";
import { HttpRequestBudget } from "@/lib/fetch-retry";

const id = "900001-000-A";
const website = `https://www.arte.tv/de/videos/${id}/synthetic-film/`;
const program = () => ({
  id: `${id}_de`,
  programId: id,
  type: "program",
  title: "Synthetic film",
  subtitle: null,
  url: `/de/videos/${id}/synthetic-film/`,
  kind: { code: "SHOW", isCollection: false },
  standaloneContent: true,
  episodeInfo: null,
  clip: null,
  genre: { id: 2, itemLabel: "Film" },
  player: { id },
  credits: [{ code: "PRODUCTION_YEAR", values: ["2001"] }],
  duration: 120,
});
function page(value: unknown = program(), prefix = "", extraZones: unknown[] = [], code = id) {
  const model = [
    "$",
    "$L1",
    null,
    {
      data: {
        language: "de",
        type: "program",
        code,
        zones: [{ code: `program_content_${id}`, content: { data: [value] } }, ...extraZones],
      },
    },
  ];
  const text = `${prefix}a:${JSON.stringify(model)}\n`;
  // Split inside a multibyte text payload's string; JSON chunking is not framing.
  const middle = Math.floor(text.length / 2);
  return [text.slice(0, middle), text.slice(middle)]
    .map((chunk) => `<script>self.__next_f.push(${JSON.stringify([1, chunk])})</script>`)
    .join("");
}
afterEach(() => vi.restoreAllMocks());

it("reads a standalone short film's explicit production year and seconds, not broadcast years", () => {
  expect(
    parseArteMoviePage(page({ ...program(), firstBroadcastDate: "2026-01-01" }), website)
  ).toEqual({
    source: "arte",
    videoId: id,
    title: "Synthetic film",
    productionYear: 2001,
    durationSeconds: 120,
  });
});

it("does not execute scripts or mine prose, recommendations or trailer records", () => {
  const prose = 'Français ü 日本語: {"productionYear":2026}\n';
  const prefix = `c:null\nb:T${Buffer.byteLength(prose).toString(16)},${prose}`;
  const recommendation = { code: `program_recommendations_${id}`, content: { data: [program()] } };
  const html = `<script>throw new Error('must never execute')</script>${page(program(), prefix, [recommendation])}`;
  expect(parseArteMoviePage(html, website)?.productionYear).toBe(2001);
  expect(
    parseArteMoviePage(page({ ...program(), credits: [] }, "", [recommendation]), website)
  ).toBeNull();
  // A full program can separately offer a trailer; the trailer is not our metadata owner.
  expect(parseArteMoviePage(page({ ...program(), trailer: { id } }), website)?.videoId).toBe(id);
});

it.each([
  { programId: "900002-000-A" },
  { player: { id: "900002-000-A" } },
  { id: `${id}_fr` },
  { url: "https://foreign.invalid/de/videos/900001-000-A/" },
  { subtitle: "Synthetic magazine" },
  { episodeInfo: { episode: 1 } },
  { clip: { id } },
  { standaloneContent: false },
  { type: "collection" },
  { kind: { code: "MANUAL_CLIP", isCollection: false } },
  { genre: { id: 1, itemLabel: "Sendung" } },
  { duration: 0 },
  { duration: -1 },
  { credits: [{ code: "BROADCAST_YEAR", values: ["2001"] }] },
  { credits: [{ code: "PRODUCTION_YEAR", values: ["2001", "2026"] }] },
  { credits: [{ code: "PRODUCTION_YEAR", values: ["2001–2002"] }] },
  {
    credits: [
      { code: "PRODUCTION_YEAR", values: ["2001"] },
      { code: "PRODUCTION_YEAR", values: ["2001"] },
    ],
  },
])("rejects unsupported or ambiguous primary evidence %j", (patch) => {
  expect(parseArteMoviePage(page({ ...program(), ...patch }), website)).toBeNull();
});

it("fails on duplicate/missing primary records, unknown framing, truncation and expired budgets", () => {
  for (const html of [
    page(program(), "", [{ code: `program_content_${id}`, content: { data: [program()] } }]),
    page(program()).replaceAll(`program_content_${id}`, `program_content_900002-000-A`),
    page(program(), "b:A4,xxxx"),
    page(program(), "b:Tffffff,short"),
    page(program(), "", [], "900002-000-A"),
    '<script>self.__next_f.push([1,"a:{broken\\n"])</script>',
  ])
    expect(() => parseArteMoviePage(html, website)).toThrow(/^Invalid provider response$/);
  expect(() => parseArteMoviePage(page(), website, Date.now() - 1)).toThrow(
    "Invalid provider response"
  );
  expect(() => parseArteMoviePage("x".repeat(2 * 1024 * 1024 + 1), website)).toThrow(
    "Invalid provider response"
  );
});

it("fetches only the pinned official page with the caller's shared retry budget", async () => {
  const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(page(), {
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  );
  const budget = new HttpRequestBudget(2);
  expect(
    (await fetchArteMovieMetadata(`${website}?tracking=synthetic#ignored`, budget))?.productionYear
  ).toBe(2001);
  expect(fetch).toHaveBeenCalledWith(website, expect.objectContaining({ redirect: "error" }));
  expect(budget.remainingAttempts).toBe(1);
  fetch.mockClear();
  for (const url of [
    "http://www.arte.tv/de/videos/900001-000-A/",
    "https://www.arte.tv.foreign.invalid/de/videos/900001-000-A/",
    "https://www.arte.tv/fr/videos/900001-000-A/",
    "https://user:private@www.arte.tv/de/videos/900001-000-A/",
  ])
    expect(await fetchArteMovieMetadata(url, budget)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

it("does not disguise unavailable or malformed metadata as an empty success", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  fetch.mockResolvedValue(new Response("missing", { status: 404 }));
  expect(await fetchArteMovieMetadata(website, new HttpRequestBudget(1))).toBeNull();
  for (const response of [
    new Response("private", { status: 503 }),
    new Response("not HTML", { headers: { "content-type": "application/json" } }),
    new Response("broken", { headers: { "content-type": "text/html" } }),
  ]) {
    fetch.mockResolvedValue(response);
    await expect(fetchArteMovieMetadata(website, new HttpRequestBudget(1))).rejects.toThrow();
  }
});
