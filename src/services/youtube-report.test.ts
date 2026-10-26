import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  normalizeYoutubePage,
  youtubeMappingKey,
  youtubeRegistrySchema,
  type YoutubeIndexRow,
} from "@/lib/youtube-catalogue";
import type { TvdbData } from "@/types";
const state = vi.hoisted(() => ({
  read: vi.fn(),
  revision: vi.fn(),
  show: vi.fn(),
  movie: vi.fn(),
  radarr: vi.fn(),
  Error: class extends Error {
    constructor(
      readonly status: number,
      message: string
    ) {
      super(message);
    }
  },
}));
vi.mock("./youtube-catalogue", () => ({
  readYoutubeCatalogueIndex: state.read,
  assertYoutubeCatalogueRevision: state.revision,
  YoutubeCatalogueError: state.Error,
}));
vi.mock("./shows", () => ({ getShowInfoByTvdbId: state.show }));
vi.mock("./tmdb", () => ({ getMovieInfoByTmdbId: state.movie }));
vi.mock("./radarr-provider", () => ({ getRadarrMovie: state.radarr }));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => null) }));
import { youtubeMappingReport } from "./youtube-report";
import { GET } from "@/app/api/youtube/catalogue/route";
const registry = youtubeRegistrySchema.parse({
  version: 1,
  channels: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", name: "Synthetic channel", enabled: true }],
  programMappings: [
    {
      kind: "series",
      channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
      sourceId: "PLsynthetic123456",
      targetId: 42,
      name: "Synthetic series",
      enabled: true,
      sourceNumbering: "publisher",
      targetOrder: "aired",
    },
  ],
});
const mapping = registry.programMappings[0];
const key = youtubeMappingKey(mapping);
const revision = "a".repeat(64);
const show: TvdbData = {
  id: 42,
  name: "Synthetic series",
  germanName: "Synthetic series",
  aliases: [],
  episodes: [
    { name: "Concrete: title", seasonNumber: 1, episodeNumber: 1, aired: null, runtime: null },
    { name: "Another title", seasonNumber: 1, episodeNumber: 2, aired: null, runtime: null },
  ],
};
const rows = (): YoutubeIndexRow[] =>
  normalizeYoutubePage(
    {
      id: mapping.sourceId,
      channel_id: mapping.channelId,
      entries: [
        {
          id: "abcdefghijk",
          channel_id: mapping.channelId,
          title: "Synthetic series, Staffel 9, Folge 2: Concrete: title",
          duration: 120,
        },
        { id: "zyxwvutsrqp", availability: "private" },
      ],
    },
    mapping,
    registry.channels[0],
    1700000000
  );
const index = () => ({
  revision,
  registry: structuredClone(registry),
  enabled: true,
  rows: rows(),
  indexed: true,
  current: true,
  at: 1700000000000,
});
beforeEach(() => {
  vi.resetAllMocks();
  state.read.mockResolvedValue(index());
  state.show.mockResolvedValue(structuredClone(show));
  state.revision.mockResolvedValue(undefined);
  state.radarr.mockResolvedValue(null);
  state.movie.mockResolvedValue({
    tmdbId: 55,
    imdbId: null,
    title: "Synthetic movie",
    germanTitle: "Synthetic movie",
    productionYear: 1999,
    runtime: null,
    releaseDate: null,
  });
});
it("serves canonical rows, preserved source coordinates and unbound private entries without claiming media readiness", async () => {
  const response = await GET(
    new NextRequest(`http://localhost/api/youtube/catalogue?mapping=${encodeURIComponent(key)}`)
  );
  expect(response.status).toBe(200);
  const report = await response.json();
  expect(report).toMatchObject({
    state: "ready",
    targetId: 42,
    order: "aired",
    mediaReady: false,
    rowCount: 2,
    extraCount: 1,
    totals: { mapped: 1, missing: 1, ambiguous: 0, unavailable: 0 },
  });
  expect(report.rows[0].sources[0]).toMatchObject({
    originalTitle: "Synthetic series, Staffel 9, Folge 2: Concrete: title",
    sourceCoordinates: { season: 9, episode: 2 },
  });
  expect(report.rows[0].sources[0].mappingRevision).toMatch(/^[a-f0-9]{64}$/);
  expect(state.revision).toHaveBeenCalledWith(revision);
});
it.each(["missing", "outdated"])(
  "does not bind stale source rows to a %s register generation",
  async (mode) => {
    state.read.mockResolvedValue({ ...index(), indexed: mode !== "missing", current: false });
    const report = await youtubeMappingReport(key, 0);
    expect(report.state).toBe(mode === "missing" ? "index_missing" : "index_outdated");
    expect(report.rows.every((row) => row.sources.length === 0)).toBe(true);
    expect(report.totals).toMatchObject({ mapped: 0, missing: 2 });
  }
);
it("does not invent episodes when metadata is missing, changed or contradictory", async () => {
  state.show.mockResolvedValue(null);
  expect(await youtubeMappingReport(key, 0)).toMatchObject({
    state: "metadata_unavailable",
    rows: [],
    rowCount: 0,
  });
  state.show.mockResolvedValue({ ...show, id: 99 });
  expect(await youtubeMappingReport(key, 0)).toMatchObject({
    state: "metadata_conflict",
    rows: [],
  });
  state.show.mockResolvedValue({ ...show, episodes: [show.episodes[0], show.episodes[0]] });
  expect(await youtubeMappingReport(key, 0)).toMatchObject({
    state: "metadata_conflict",
    rows: [],
  });
});
it("marks a previously identified unavailable video without assigning a never-known private row by position", async () => {
  const loaded = index();
  const available = loaded.rows[0];
  loaded.rows[0] = {
    ...available,
    channelId: null,
    content: null,
    availability: "unavailable",
    lastKnown: { channelId: mapping.channelId, title: available.content!.title },
  };
  state.read.mockResolvedValue(loaded);
  const report = await youtubeMappingReport(key, 0);
  expect(report.totals).toMatchObject({ mapped: 0, unavailable: 1, missing: 1 });
  expect(report.extras).toHaveLength(1);
});
it("rejects duplicate or foreign source identities and conflicting programme assignments", async () => {
  const loaded = index();
  loaded.rows.push(loaded.rows[0]);
  state.read.mockResolvedValue(loaded);
  expect(await youtubeMappingReport(key, 0)).toMatchObject({ state: "source_conflict", rows: [] });
  loaded.rows = [{ ...rows()[0], channelId: "UCbbbbbbbbbbbbbbbbbbbbbb" }];
  expect(await youtubeMappingReport(key, 0)).toMatchObject({ state: "source_conflict", rows: [] });
  const cross = index();
  const other = { ...mapping, sourceId: "PLdifferent123456", targetId: 43 };
  cross.registry.programMappings.push(other);
  cross.rows.push({ ...cross.rows[0], mappingKey: youtubeMappingKey(other) });
  state.read.mockResolvedValue(cross);
  const report = await youtubeMappingReport(key, 0);
  expect(report.totals.mapped).toBe(0);
  expect(report.rows[0].state).toBe("ambiguous");
});
it("paginates the complete canonical set rather than replacing it with the video count", async () => {
  state.show.mockResolvedValue({
    ...show,
    episodes: Array.from({ length: 101 }, (_, i) => ({
      ...show.episodes[0],
      episodeNumber: i + 1,
      name: "Canonical title " + i,
    })),
  });
  const report = await youtubeMappingReport(key, 1);
  expect(report.rowCount).toBe(101);
  expect(report.rows).toHaveLength(1);
  expect(report.rows[0].episode).toBe(101);
  expect(report.totals.missing).toBe(101);
});
it("keeps movie identity/year separate from upload metadata and recovers an independent metadata provider", async () => {
  const film = {
    kind: "movie" as const,
    channelId: mapping.channelId,
    sourceId: "abcdefghijk",
    targetId: 55,
    name: "Synthetic movie",
    enabled: true,
  };
  const loaded = {
    ...index(),
    registry: { ...registry, programMappings: [film] },
    rows: normalizeYoutubePage(
      {
        id: film.sourceId,
        channel_id: film.channelId,
        title: "Synthetic movie (1999)",
        upload_date: "20260101",
      },
      film,
      registry.channels[0],
      1700000000
    ),
  };
  state.read.mockResolvedValue(loaded);
  state.radarr.mockRejectedValue(Error("Synthetic optional outage"));
  expect(await youtubeMappingReport(youtubeMappingKey(film), 0)).toMatchObject({
    state: "ready",
    mediaReady: false,
    rowCount: 1,
    totals: { mapped: 1 },
  });
  loaded.rows[0].content!.title = "Synthetic movie (2001)";
  expect((await youtubeMappingReport(youtubeMappingKey(film), 0)).rows[0].state).toBe("ambiguous");
});
it("fails closed when the register changes before report confirmation and rejects unknown mappings", async () => {
  state.revision.mockRejectedValue(new state.Error(409, "Synthetic changed register"));
  const response = await GET(
    new NextRequest(`http://localhost/api/youtube/catalogue?mapping=${encodeURIComponent(key)}`)
  );
  expect(response.status).toBe(409);
  await expect(youtubeMappingReport("unknown", 0)).rejects.toMatchObject({ status: 404 });
  expect(
    (await GET(new NextRequest("http://localhost/api/youtube/catalogue?mapping=&page=0"))).status
  ).toBe(400);
  expect(
    (await GET(new NextRequest("http://localhost/api/youtube/catalogue?mapping=unknown&page=1000")))
      .status
  ).toBe(400);
});
