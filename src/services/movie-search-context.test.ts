import { describe, expect, it } from "vitest";
import {
  assertMovieSearchGoal,
  MovieSearchContextError,
  parseMovieSearchContext,
} from "./movie-search-context";
import type { TmdbMovieData } from "@/types";

const movie: TmdbMovieData = {
  tmdbId: 42,
  imdbId: "tt0000042",
  title: "Original Film",
  germanTitle: "Beispielfilm",
  aliases: ["Another Title"],
  productionYear: 1998,
  releaseDate: null,
  runtime: 90,
};

describe("one movie search context", () => {
  it("does not compound the year tolerance across the query, explicit parameter and metadata", () => {
    const context = parseMovieSearchContext(new URLSearchParams("q=Beispielfilm+2000&year=1999"));
    expect(() => assertMovieSearchGoal(context, movie)).toThrow(MovieSearchContextError);
  });
  it.each([1997, 1998, 1999])("accepts the one-year metadata tolerance: %s", (year) => {
    const context = parseMovieSearchContext(
      new URLSearchParams(`q=Beispielfilm+1998&year=${year}`)
    );
    expect(() => assertMovieSearchGoal(context, movie)).not.toThrow();
  });
  it("normalizes numeric IMDb IDs and Radarr's title/year fallback", () => {
    const context = parseMovieSearchContext(
      new URLSearchParams("q=Beispielfilm+1998&year=1998&tmdbid=42&imdbid=0000042")
    );
    expect(context).toEqual({
      query: "Beispielfilm",
      year: 1998,
      tmdbId: 42,
      imdbId: "tt0000042",
    });
    expect(() => assertMovieSearchGoal(context, movie)).not.toThrow();
  });

  it.each([
    "q=A&q=A",
    "year=1998&year=1998",
    "tmdbid=42&tmdbid=42",
    "imdbid=0000042&imdbid=0000042",
    "tmdbid=12x",
    "tmdbid=0",
    "tmdbid=2147483648",
    "imdbid=42",
    "q=Film+1998&year=2000",
    "year=98",
    "year=1700",
  ])("rejects ambiguous or malformed input before retrieval: %s", (query) => {
    expect(() => parseMovieSearchContext(new URLSearchParams(query))).toThrow(
      MovieSearchContextError
    );
  });

  it("does not interpret a numeric film title as a year", () => {
    expect(parseMovieSearchContext(new URLSearchParams("q=2001"))).toMatchObject({
      query: "2001",
      year: null,
    });
  });

  it.each(["tmdbid=43", "imdbid=0000043", "q=Foreign+Film", "year=2000"])(
    "rejects conflicting metadata, not merely the first matching ID: %s",
    (query) => {
      expect(() =>
        assertMovieSearchGoal(parseMovieSearchContext(new URLSearchParams(query)), movie)
      ).toThrow(MovieSearchContextError);
    }
  );

  it("accepts a documented alias but never derives a year from the current date", () => {
    expect(() =>
      assertMovieSearchGoal(parseMovieSearchContext(new URLSearchParams("q=Another+Title")), movie)
    ).not.toThrow();
    expect(() =>
      assertMovieSearchGoal(parseMovieSearchContext(new URLSearchParams("year=1998")), {
        ...movie,
        productionYear: undefined,
        releaseDate: null,
      })
    ).toThrow(MovieSearchContextError);
  });
});
