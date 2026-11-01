import { expect, it, vi } from "vitest";
import { programmeItem, programmeShow } from "@/lib/__fixtures__/mediathek-programme";
import { syntheticYoutubeSource } from "@/lib/__fixtures__/youtube";
import { youtubeWatchUrl } from "@/lib/youtube-source";
import { matchBoundSourceEpisode } from "./source-programme";
import { applyDesiredEpisodeFilter, getDesiredEpisodes } from "./tv-search-matcher";
import type { TvSearchContext } from "@/types";

vi.mock("@/lib/db", () => ({ prisma: {} }));

it.each([
  ["mediathek", true],
  ["mediathek", false],
  ["youtube", true],
  ["youtube", false],
] as const)(
  "%s binding filters canonical identity, ID=%s, retaining aired-year searches",
  (family, withId) => {
    const show = structuredClone(programmeShow);
    show.episodes.push({ ...show.episodes[0], seasonNumber: 2019 });
    const source = structuredClone(programmeItem);
    if (family === "youtube") {
      const reference = syntheticYoutubeSource();
      reference.programme = { kind: "series", targetId: show.id, season: 8, episode: 1 };
      reference.originalTitle = source.title;
      source.sourceRef = reference;
      source.sourceProviderId = "youtube";
      source.url_video = source.url_website = youtubeWatchUrl(reference);
    }
    const match = matchBoundSourceEpisode(source, show, 0, 10)!;
    expect(match.episode).toMatchObject({ seasonNumber: 8, episodeNumber: 1 });
    const tvdbId = withId ? show.id : null;
    const context: TvSearchContext = {
      tvdbId,
      query: show.name,
      season: "2019",
      episode: "1",
    };
    const desired = tvdbId === null ? null : getDesiredEpisodes(show, context);
    expect(applyDesiredEpisodeFilter([match], desired, context)).toEqual([]);
    const canonical = { ...context, season: "8" };
    expect(
      applyDesiredEpisodeFilter(
        [match],
        tvdbId === null ? null : getDesiredEpisodes(show, canonical),
        canonical
      )
    ).toEqual([match]);
    const airedYear = { ...context, episode: null };
    expect(
      applyDesiredEpisodeFilter(
        [match],
        tvdbId === null ? null : getDesiredEpisodes(show, airedYear),
        airedYear
      )
    ).toEqual([match]);
  }
);

it("preserves the legacy canonical rejection before any unbound publisher fallback", () => {
  const bound = matchBoundSourceEpisode(programmeItem, programmeShow, 0, 10)!;
  const ordinary = {
    ...bound,
    mediathekProgramme: undefined,
    item: { ...programmeItem, title: "Other (S07/E02)" },
  };
  const unrelated = { ...ordinary.episode, seasonNumber: 7, episodeNumber: 2 };
  expect(
    applyDesiredEpisodeFilter([ordinary], [unrelated], {
      tvdbId: 123,
      query: null,
      season: "8",
      episode: "1",
    })
  ).toEqual([]);
});
