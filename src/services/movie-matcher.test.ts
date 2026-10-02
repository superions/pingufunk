import { describe, expect, it, vi } from "vitest";
import type { ApiResultItem, TmdbMovieData } from "@/types";

vi.mock("@/lib/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}));

import { matchMovieItems } from "./movie-matcher";

const movie: TmdbMovieData = {
  tmdbId: 28,
  imdbId: "tt0000028",
  title: "Documentary",
  germanTitle: "Documentary",
  runtime: 45,
  releaseDate: "2026-07-12",
};

function makeItem(duration: number, id: string): ApiResultItem {
  return {
    channel: "ARD",
    topic: "Documentary",
    title: "Documentary",
    description: "",
    filmlisteTimestamp: 1_700_000_000,
    duration,
    size: 1_000_000,
    url_website: `https://example.com/${id}`,
    url_video: `https://example.com/${id}.mp4`,
    url_video_low: "",
    url_video_hd: "",
  };
}

describe("matchMovieItems – minimum duration", () => {
  it("compares durations in seconds at the configured boundary", async () => {
    const matches = await matchMovieItems(
      [makeItem(2699, "short"), makeItem(2700, "boundary")],
      movie,
      2700
    );

    expect(matches.map((match) => match.item.url_video)).toEqual([
      "https://example.com/boundary.mp4",
    ]);
  });

  it("does not filter by duration when the setting is zero", async () => {
    const matches = await matchMovieItems([makeItem(120, "short")], movie, 0);

    expect(matches).toHaveLength(1);
  });
});

describe("matchMovieItems – HLS eligibility", () => {
  it("rejects HLS-only items when disabled and accepts them when explicitly enabled", async () => {
    const hlsOnly = {
      ...makeItem(2700, "hls-only"),
      url_video: "https://example.com/hls-only.m3u8",
    };

    expect(await matchMovieItems([hlsOnly], movie, 0, false)).toHaveLength(0);
    expect(await matchMovieItems([hlsOnly], movie, 0, true)).toHaveLength(1);
  });
});

describe("source candidates are not canonical movie proof", () => {
  it("keeps an exact title as an unverified candidate, including a different source year", async () => {
    const source = { ...makeItem(2700, "remake"), title: "Documentary (1998)" };
    const [match] = await matchMovieItems([source], movie, 2700);
    expect(match.item).toEqual(source);
    expect(match.identityVerified).toBe(false);
  });
  it("permits a qualified short film only with full title, source year and minute/second agreement", async () => {
    const shortMovie = { ...movie, runtime: 10, productionYear: 2026 };
    const source = { ...makeItem(600, "short"), title: "Documentary (2026)" };
    expect(await matchMovieItems([source], shortMovie, 2700)).toHaveLength(1);
    expect(
      await matchMovieItems([{ ...source, title: "Documentary" }], shortMovie, 2700)
    ).toHaveLength(0);
    expect(await matchMovieItems([{ ...source, duration: 10 }], shortMovie, 2700)).toHaveLength(0);
    expect(await matchMovieItems([source], { ...shortMovie, runtime: null }, 2700)).toHaveLength(0);
    expect(
      await matchMovieItems([{ ...source, title: "Documentary Trailer (2026)" }], shortMovie, 2700)
    ).toHaveLength(0);
  });
  it.each([0, -1, NaN, Infinity])(
    "does not treat invalid source duration %s as verified",
    async (duration) => {
      expect(await matchMovieItems([makeItem(duration, "invalid")], movie, 0)).toHaveLength(0);
    }
  );
});
