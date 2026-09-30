import { describe, expect, it } from "vitest";
import {
  parseSonarrEpisodes,
  parseSonarrSeries,
  parseSonarrVersion,
  SonarrMetadataError,
} from "./sonarr-metadata";

// Independently authored synthetic API resources; not a library response.
const series = { id: 12, tvdbId: 345, title: "Example", monitored: true, runtime: 90 };
const episode = {
  id: 34,
  seriesId: 12,
  tvdbId: 987,
  seasonNumber: 2,
  episodeNumber: 3,
  title: "A short episode",
  airDateUtc: "2026-09-29T12:00:00Z",
  runtime: 2,
};

describe("Sonarr metadata boundary (not yet connected to lookup/RSS)", () => {
  it.each(["3.0.10.1567", "4.0.17.2952"])("accepts supported application version %s", (version) => {
    expect(parseSonarrVersion({ version })).toBe(version);
  });
  it.each(["5.0.0.1", "2.0.0", "v4.0.0", "4.0.0-unknown", undefined])(
    "rejects unverified version %s",
    (version) => {
      expect(() => parseSonarrVersion({ version })).toThrow(SonarrMetadataError);
    }
  );
  it("keeps series identity distinct from local and episode IDs, without retaining private fields", () => {
    expect(parseSonarrSeries([{ ...series, path: "/synthetic/not-retained" }])).toEqual([
      { sonarrId: 12, tvdbId: 345, title: "Example", monitored: true },
    ]);
    expect(parseSonarrEpisodes([episode], 12)).toEqual([
      {
        sonarrId: 34,
        seriesId: 12,
        seasonNumber: 2,
        episodeNumber: 3,
        title: "A short episode",
        aired: new Date("2026-09-29T12:00:00Z"),
        expectedRuntimeSeconds: 120,
      },
    ]);
  });
  it.each([false, undefined, null])("does not invent monitoring for %s", (monitored) => {
    expect(parseSonarrSeries([{ ...series, monitored }])[0].monitored).toBe(false);
  });
  it("rejects multiple series sharing either identifier", () => {
    expect(() => parseSonarrSeries([series, { ...series, id: 13 }])).toThrow(SonarrMetadataError);
    expect(() => parseSonarrSeries([series, { ...series, tvdbId: 346 }])).toThrow(
      SonarrMetadataError
    );
  });
  it("rejects a foreign series or duplicate episode instead of returning partial data", () => {
    expect(() => parseSonarrEpisodes([episode, { ...episode, id: 35, seriesId: 13 }], 12)).toThrow(
      SonarrMetadataError
    );
    expect(() => parseSonarrEpisodes([episode, { ...episode, id: 35 }], 12)).toThrow(
      SonarrMetadataError
    );
    expect(() => parseSonarrEpisodes([episode, { ...episode, episodeNumber: 4 }], 12)).toThrow(
      SonarrMetadataError
    );
  });
  it.each([0, null, undefined])(
    "leaves missing episode runtime %s unknown, even with series runtime",
    (runtime) => {
      expect(
        parseSonarrEpisodes([{ ...episode, runtime, series }], 12)[0].expectedRuntimeSeconds
      ).toBeNull();
    }
  );
  it.each([
    "2026-09-29",
    "2026-02-31T12:00:00Z",
    "2026-09-29T24:00:00Z",
    "2026-09-29T12:00:00",
    "bad",
    null,
  ])("does not invent an RSS instant for %s", (airDateUtc) => {
    expect(
      parseSonarrEpisodes([{ ...episode, airDateUtc, airDate: "2026-09-29" }], 12)[0].aired
    ).toBeNull();
  });
  it("retains offset timestamps as the same UTC instant", () => {
    expect(
      parseSonarrEpisodes([{ ...episode, airDateUtc: "2026-09-29T14:00:00+02:00" }], 12)[0].aired
    ).toEqual(new Date("2026-09-29T12:00:00Z"));
  });
  it("accepts leap days and normalizes API fractional seconds to Date milliseconds", () => {
    expect(
      parseSonarrEpisodes([{ ...episode, airDateUtc: "2024-02-29T12:00:00.1234567Z" }], 12)[0].aired
    ).toEqual(new Date("2024-02-29T12:00:00.123Z"));
  });
  it.each([NaN, Infinity, -1, 1.5])("rejects malformed episode runtime %s", (runtime) => {
    expect(() => parseSonarrEpisodes([{ ...episode, runtime }], 12)).toThrow(SonarrMetadataError);
  });
  it("does not coerce missing IDs or string numbers into verified identity", () => {
    expect(() => parseSonarrSeries([{ ...series, tvdbId: "345" }])).toThrow(SonarrMetadataError);
    expect(() => parseSonarrEpisodes([{ ...episode, seriesId: undefined }], 12)).toThrow(
      SonarrMetadataError
    );
  });
});
