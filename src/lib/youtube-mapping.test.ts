import { expect, it } from "vitest";
import catalogue from "../../data/shows.json";
import seedData from "../../data/youtube-sources.json";
import { mapYoutubeEpisodes } from "./youtube-mapping";
import {
  mergeYoutubeRegistry,
  normalizeYoutubePage,
  youtubeRegistrySchema,
  type YoutubeMapping,
} from "./youtube-catalogue";
import type { TvdbData } from "@/types";

const seed = youtubeRegistrySchema.parse(seedData);
const mapping = seed.programMappings[0] as Extract<YoutubeMapping, { kind: "series" }>;
const channel = seed.channels.find((row) => row.id === mapping.channelId)!;
const canonical = catalogue.find((row) => row.tvdbId === 133771)!;
const show: TvdbData = {
  id: canonical.tvdbId,
  name: canonical.name,
  germanName: canonical.germanName,
  aliases: [],
  episodes: canonical.episodes.map((row) => ({
    ...row,
    aired: row.aired ? new Date(row.aired) : null,
    runtime: null,
  })),
};
const revision = "a".repeat(64);
const inventory = (titles: string[]) =>
  normalizeYoutubePage(
    {
      id: mapping.sourceId,
      channel_id: channel.id,
      entries: titles.map((title, i) => ({
        id: String(i).padStart(11, "0"),
        title,
        channel_id: channel.id,
        duration: 120,
      })),
    },
    mapping,
    channel,
    1700000000
  );

it("checks all 97 curated aired coordinates with generated source videos, never playlist positions", () => {
  expect(show.episodes).toHaveLength(97);
  const first = inventory(
    show.episodes
      .slice(0, 97)
      .map(
        (ep, i) =>
          `Der Kommissar, Staffel ${20 + Math.floor(i / 10)}, Folge ${(i % 10) + 1}: ${ep.name}`
      )
  );
  const result = mapYoutubeEpisodes(mapping, show, first, revision);
  expect(result.rows).toHaveLength(97);
  expect(result.rows.every((row) => row.state === "mapped")).toBe(true);
  expect(result.extras).toEqual([]);
  expect(result.rows[0].sources[0]).toMatchObject({
    sourceCoordinates: { season: 20, episode: 1 },
    mappingRevision: revision,
  });
  expect(result.rows.at(-1)).toMatchObject({ season: 8, episode: 2 });
});
it("translates only the declared publisher prefix and preserves an episode's own colon", () => {
  const titles = [
    "Der Kommissar, Staffel 2, Folge 1: Auf dem Stundenplan: Mord",
    "Der Kommissar, Staffel 2, Folge 3: Der Papierblumenmörder",
    '"Der Kommissar, Staffel 6, Folge 5: Herr und Frau Brandes "',
    "Der Kommissar, Staffel 4, Folge 3: Noch zehn Minuten zu leben",
  ];
  const result = mapYoutubeEpisodes(mapping, show, inventory(titles), revision);
  expect(result.rows.filter((row) => row.state === "mapped")).toHaveLength(4);
  expect(
    result.rows.find((row) => row.season === 1 && row.episode === 13)?.sources[0]
  ).toMatchObject({ originalTitle: titles[0], sourceCoordinates: { season: 2, episode: 1 } });
  expect(
    result.rows.find((row) => row.season === 2 && row.episode === 1)?.sources[0].originalTitle
  ).toBe(titles[1]);
  const strict = mapYoutubeEpisodes(
    { ...mapping, sourceNumbering: "canonical" },
    show,
    inventory(titles.slice(0, 2)),
    revision
  );
  expect(strict.rows.some((row) => row.state === "mapped")).toBe(false);
  expect(strict.extras.every((row) => row.reason === "number_conflict")).toBe(true);
});
it("keeps source alternatives, missing episodes and an unbound unavailable item separate", () => {
  const rows = inventory([
    "Der Kommissar, Staffel 1, Folge 1: Toter Herr im Regen",
    "Der Kommissar, Staffel 9, Folge 9: Toter Herr im Regen",
  ]);
  rows.push({
    videoId: null,
    channelId: null,
    mappingKey: rows[0].mappingKey,
    availability: "unavailable",
    content: null,
  });
  const result = mapYoutubeEpisodes(mapping, show, rows, revision);
  expect(result.rows[0].sources).toHaveLength(2);
  expect(result.rows.filter((row) => row.state === "missing")).toHaveLength(96);
  expect(result.extras).toEqual([
    { videoId: null, title: null, state: "unavailable", reason: "unavailable" },
  ]);
  const historical = {
    ...rows[0],
    channelId: null,
    content: null,
    availability: "unavailable" as const,
    lastKnown: { title: rows[0].content!.title, channelId: channel.id },
  };
  expect(mapYoutubeEpisodes(mapping, show, [historical], revision).rows[0].state).toBe(
    "unavailable"
  );
});
it("rejects foreign, duplicate and changed canonical identities and does not guess ambiguous titles", () => {
  const rows = inventory(["Der Kommissar, Staffel 1, Folge 1: Toter Herr im Regen"]);
  expect(() => mapYoutubeEpisodes(mapping, { ...show, id: 42 }, rows, revision)).toThrow();
  expect(() => mapYoutubeEpisodes(mapping, show, [rows[0], rows[0]], revision)).toThrow();
  expect(() =>
    mapYoutubeEpisodes(
      mapping,
      show,
      [{ ...rows[0], channelId: "UCaaaaaaaaaaaaaaaaaaaaaa" }],
      revision
    )
  ).toThrow();
  const duplicateTitle = {
    ...show,
    episodes: [...show.episodes, { ...show.episodes[0], seasonNumber: 9, episodeNumber: 1 }],
  };
  const ambiguous = mapYoutubeEpisodes(mapping, duplicateTitle, rows, revision);
  expect(ambiguous.rows.filter((row) => row.state === "ambiguous")).toHaveLength(2);
  expect(ambiguous.rows.some((row) => row.state === "mapped")).toBe(false);
  const blocked = mapYoutubeEpisodes(
    mapping,
    { ...show, sonarrBlockedCoordinates: ["1:1"] },
    rows,
    revision
  );
  expect(blocked.extras[0].reason).toBe("metadata_conflict");
  const mixed = mapYoutubeEpisodes(
    mapping,
    show,
    inventory([
      "Another series, Staffel 1, Folge 1: Toter Herr im Regen",
      "Der Kommissar, Staffel 1, Folge 1: Folge 1",
      "Der Kommissar, Staffel 1, Folge 1: Trailer Toter Herr im Regen",
    ]),
    revision
  );
  expect(mixed.rows.some((row) => row.state === "mapped")).toBe(false);
  expect(mixed.extras).toHaveLength(3);
});
it("upgrades old matching preset rows without rebinding a corrected target or activating a channel", () => {
  const old = structuredClone(seed);
  const row = old.programMappings[0] as typeof mapping;
  delete row.sourceNumbering;
  delete row.targetOrder;
  delete row.episodeTitleAliases;
  const upgraded = mergeYoutubeRegistry(seed, old);
  expect(upgraded.programMappings[0]).toMatchObject({
    sourceNumbering: "publisher",
    enabled: false,
  });
  row.targetId = 42;
  const corrected = mergeYoutubeRegistry(seed, old);
  expect(corrected.programMappings[0]).not.toHaveProperty("sourceNumbering");
  expect(corrected.programMappings[0].targetId).toBe(42);
  expect(corrected.channels.every((row) => !row.enabled)).toBe(true);
});
