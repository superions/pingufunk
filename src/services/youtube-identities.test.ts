import { beforeEach, expect, it, vi } from "vitest";
import type { TvdbData, TmdbMovieData } from "@/types";
const state = vi.hoisted(() => ({
  catalogue: vi.fn(),
  show: vi.fn(),
  tmdb: vi.fn(),
  movie: vi.fn(),
  sonarr: vi.fn(),
  inventory: vi.fn(),
  episodes: vi.fn(),
  movies: vi.fn(),
  radarr: vi.fn(),
  Conflict: class extends Error {},
}));
vi.mock("../../data/youtube-sources.json", () => ({
  default: {
    version: 1,
    channels: [{ id: "UCaaaaaaaaaaaaaaaaaaaaaa", name: "Synthetic channel", enabled: false }],
    programMappings: [
      {
        kind: "series",
        channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
        sourceId: "PLsyntheticseed123",
        name: "Synthetic series",
        targetId: 42,
        enabled: false,
      },
      {
        kind: "movie",
        channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
        sourceId: "abcdefghijk",
        name: "Synthetic movie",
        targetId: 55,
        enabled: false,
      },
    ],
  },
}));
vi.mock("./shows", () => ({
  getCatalogueShowIdentities: state.catalogue,
  getShowInfoByTvdbId: state.show,
}));
vi.mock("./tmdb", () => ({
  findProgrammeIdentity: state.tmdb,
  getMovieInfoByTmdbId: state.movie,
  ProgrammeIdentityConflictError: state.Conflict,
}));
vi.mock("./sonarr-provider", () => ({ openSonarrSession: state.sonarr }));
vi.mock("./radarr-provider", () => ({
  getRadarrMonitoredMovies: state.movies,
  getRadarrMovie: state.radarr,
}));
vi.mock("@/lib/settings", () => ({ getSetting: vi.fn(async () => null) }));
import { suggestYoutubeIdentity } from "./youtube-identities";
import { youtubeRegistrySchema } from "@/lib/youtube-catalogue";

const series: TvdbData = {
  id: 42,
  name: "Synthetic series",
  germanName: "Synthetic series",
  aliases: [{ name: "Localized programme", language: "deu" }],
  episodes: [
    {
      name: "Concrete episode",
      seasonNumber: 1,
      episodeNumber: 1,
      aired: new Date("2001-01-01"),
      runtime: 30,
    },
  ],
};
const movie: TmdbMovieData = {
  tmdbId: 55,
  imdbId: "tt1234567",
  title: "Synthetic movie",
  germanTitle: "Synthetic movie",
  productionYear: 1999,
  runtime: 80,
  releaseDate: null,
};
const source = {
  kind: "series" as const,
  sourceId: "PLunmapped123456",
  channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  channelName: "Synthetic channel",
  name: "Synthetic series",
};
beforeEach(() => {
  vi.clearAllMocks();
  state.catalogue.mockResolvedValue([]);
  state.show.mockResolvedValue(series);
  state.tmdb.mockResolvedValue({ available: false, ambiguous: false, targetId: null });
  state.movie.mockResolvedValue(movie);
  state.sonarr.mockResolvedValue(null);
  state.inventory.mockResolvedValue([]);
  state.episodes.mockResolvedValue({ episodes: series.episodes });
  state.movies.mockResolvedValue([]);
  state.radarr.mockResolvedValue(null);
});
it("uses explicit local IDs before series/movie seeds without any metadata request or activation", async () => {
  const seed = await suggestYoutubeIdentity({ ...source, sourceId: "PLsyntheticseed123" }, null);
  expect(seed).toMatchObject({ state: "bound", origin: "preset", targetId: 42 });
  expect(
    await suggestYoutubeIdentity({ ...source, kind: "movie", sourceId: "abcdefghijk" }, null)
  ).toMatchObject({ state: "bound", origin: "preset", targetId: 55 });
  const local = youtubeRegistrySchema.parse({
    version: 1,
    channels: [{ id: source.channelId, name: source.channelName, enabled: false }],
    programMappings: [
      {
        kind: "series",
        channelId: source.channelId,
        name: "Corrected",
        targetId: 88,
        enabled: false,
        sourceId: "PLsyntheticseed123",
      },
    ],
  });
  expect(
    await suggestYoutubeIdentity({ ...source, sourceId: "PLsyntheticseed123" }, local)
  ).toMatchObject({ state: "bound", origin: "local", targetId: 88 });
  expect(state.tmdb).not.toHaveBeenCalled();
  expect(state.sonarr).not.toHaveBeenCalled();
  expect(state.catalogue).not.toHaveBeenCalled();
});
it("finds a unique curated identity with Sonarr disabled and verifies a concrete episode inventory", async () => {
  state.catalogue.mockResolvedValue([{ targetId: 42, names: ["Synthetic series"], year: 2001 }]);
  expect(
    await suggestYoutubeIdentity({ ...source, name: "Synthetic series (2001)" }, null)
  ).toMatchObject({ state: "bound", origin: "metadata", targetId: 42 });
  state.show.mockResolvedValue({ ...series, episodes: [] });
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "metadata_unavailable",
    targetId: null,
  });
});
it("consumes existing series-wide aliases and explicit years without treating an upload year as identity", async () => {
  state.sonarr.mockResolvedValue({ inventory: state.inventory, show: state.episodes });
  state.inventory.mockResolvedValue([
    { tvdbId: 42, title: "Synthetic series", aliases: ["Localized programme"] },
  ]);
  expect(
    await suggestYoutubeIdentity({ ...source, name: "Localized programme (2001)" }, null)
  ).toMatchObject({ state: "bound", targetId: 42 });
  expect(
    await suggestYoutubeIdentity({ ...source, name: "Localized programme (2002)" }, null)
  ).toMatchObject({ state: "not_found", targetId: null });
});
it("never chooses the first homonym and retains year/cross-ID conflicts", async () => {
  state.catalogue.mockResolvedValue([
    { targetId: 42, names: [source.name], year: 2001 },
    { targetId: 43, names: [source.name], year: 2001 },
  ]);
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "ambiguous",
    targetId: null,
  });
  state.catalogue.mockResolvedValue([{ targetId: 42, names: [source.name], year: 2001 }]);
  state.sonarr.mockResolvedValue({ inventory: state.inventory, show: state.episodes });
  state.inventory.mockResolvedValue([{ tvdbId: 42, title: source.name, aliases: [] }]);
  state.episodes.mockResolvedValue({ episodes: [{ aired: new Date("2002-01-01") }] });
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "ambiguous",
    targetId: null,
  });
  state.sonarr.mockResolvedValue(null);
  state.tmdb.mockRejectedValue(new state.Conflict("Synthetic cross-ID mismatch"));
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "ambiguous",
    targetId: null,
  });
});
it("uses a verified movie namespace, rejects unavailable metadata, and never leaks internal cross IDs", async () => {
  state.tmdb.mockResolvedValue({ available: true, ambiguous: false, targetId: 55 });
  const input = {
    ...source,
    kind: "movie" as const,
    sourceId: "zyxwvutsrqp",
    name: "Synthetic movie (1999)",
  };
  const result = await suggestYoutubeIdentity(input, null);
  expect(result).toMatchObject({ state: "bound", targetId: 55 });
  expect(result.candidates[0]).not.toHaveProperty("crossId");
  expect(state.tmdb.mock.calls.at(-1)?.[1]).toBe("movie");
  state.movie.mockResolvedValue(null);
  expect(await suggestYoutubeIdentity(input, null)).toMatchObject({
    state: "metadata_unavailable",
    targetId: null,
  });
});
it("reports lookup outages and truncated windows as uncertainty rather than empty or automatic success", async () => {
  state.tmdb.mockRejectedValue(Error("Synthetic unavailable"));
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "metadata_unavailable",
    targetId: null,
  });
  state.tmdb.mockResolvedValue({ available: true, ambiguous: true, targetId: null });
  expect(await suggestYoutubeIdentity(source, null)).toMatchObject({
    state: "ambiguous",
    targetId: null,
  });
  expect(await suggestYoutubeIdentity(source, null, Date.now() - 1)).toMatchObject({
    state: "metadata_unavailable",
    targetId: null,
  });
});
it("retains same-ID contradictions independently of lookup completion order and explicit year filtering", async () => {
  state.catalogue.mockResolvedValue([{ targetId: 42, names: [source.name], year: 2002 }]);
  state.sonarr.mockResolvedValue({ inventory: state.inventory, show: state.episodes });
  state.inventory.mockResolvedValue([{ tvdbId: 42, title: source.name, aliases: [] }]);
  state.episodes.mockResolvedValue({ episodes: series.episodes });
  expect(
    await suggestYoutubeIdentity({ ...source, name: source.name + " (2001)" }, null)
  ).toMatchObject({ state: "ambiguous", targetId: null });
  state.catalogue.mockResolvedValue([{ targetId: 42, names: [source.name], year: 2001 }]);
  state.episodes.mockResolvedValue({ episodes: [{ aired: new Date("2002-01-01") }] });
  expect(
    await suggestYoutubeIdentity({ ...source, name: source.name + " (2001)" }, null)
  ).toMatchObject({ state: "ambiguous", targetId: null });
});
it("does not look up an empty normalized programme title", async () => {
  expect(await suggestYoutubeIdentity({ ...source, name: "---" }, null)).toMatchObject({
    state: "not_found",
    targetId: null,
  });
  expect(state.tmdb).not.toHaveBeenCalled();
  expect(state.catalogue).not.toHaveBeenCalled();
});
