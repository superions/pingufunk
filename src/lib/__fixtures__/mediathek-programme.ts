import type { ApiResultItem, TvdbData } from "@/types";
import type { MediathekProgrammeBinding } from "../mediathek-programme";
import { unknownJobMediaExpectations } from "../media-expectations";
import { mediaSourceIdentity } from "@/services/source-audio";

export const programmeBinding: MediathekProgrammeBinding = {
  website: "https://example.invalid/programmes/solstice",
  source: { channel: "ZDF", title: "Synthetic Solstice", season: 2019, episode: 1 },
  target: { season: 8, episode: 1 },
};
export const programmeItem: ApiResultItem = {
  channel: "ZDF",
  topic: "Synthetic Series",
  title: "Synthetic Solstice (S2019/E01)",
  description: "Synthetic programme binding; no real media or library state.",
  filmlisteTimestamp: 1_700_000_000,
  duration: 120,
  size: 100_000,
  url_website: programmeBinding.website,
  url_video: "https://example.invalid/solstice.mp4",
  url_video_hd: "",
  url_video_low: "",
};
export const programmeShow: TvdbData = {
  id: 123,
  name: "Synthetic Series",
  germanName: null,
  aliases: [],
  mediathekProgrammes: [programmeBinding],
  sonarrVerifiedCoordinates: ["8:1"],
  episodes: [
    {
      name: "Midsummer",
      seasonNumber: 8,
      episodeNumber: 1,
      aired: new Date("2019-03-01T20:15:00Z"),
      runtime: 2,
      metadataSource: "sonarr",
    },
  ],
};
export const programmeExpectations = {
  ...unknownJobMediaExpectations(),
  version: 6 as const,
  mediaKind: "series" as const,
  durations: {
    source: {
      seconds: 120,
      provenance: "source_catalogue" as const,
      tolerancePercent: 10 as const,
    },
    metadata: { seconds: 120, provenance: "episode_metadata" as const, tolerancePercent: 10 },
  },
  audio: { language: "de", provenance: "provider_audio" as const },
  sourceAudio: null,
  resolution: { width: 1280, height: 720, provenance: "provider_dimensions" as const },
  sourceProgramme: {
    ...programmeBinding,
    tvdbId: 123,
    topic: "Synthetic Series",
    renditionIdentity: mediaSourceIdentity(programmeItem.url_video),
  },
};

export const pairedProgrammeBindings: MediathekProgrammeBinding[] = [2, 3].map((episode) => ({
  website: "https://example.invalid/programmes/whole",
  source: { channel: "ZDF", title: "Whole Programme", season: 10, episode: 13 },
  target: { season: 0, episode },
}));
export const pairedProgrammeItem: ApiResultItem = {
  ...programmeItem,
  title: "Whole Programme (S10/E13)",
  url_website: pairedProgrammeBindings[0].website,
  url_video: "https://example.invalid/whole.mp4",
};
export const pairedProgrammeShow: TvdbData = {
  ...programmeShow,
  mediathekProgrammes: pairedProgrammeBindings,
  sonarrVerifiedCoordinates: ["0:2", "0:3"],
  episodes: [2, 3].map((episodeNumber) => ({
    ...programmeShow.episodes[0],
    name: "TBA",
    seasonNumber: 0,
    episodeNumber,
    runtime: 1,
  })),
};
export const pairedProgrammeExpectations = {
  ...programmeExpectations,
  version: 7 as const,
  sourceProgramme: {
    website: pairedProgrammeBindings[0].website,
    source: pairedProgrammeBindings[0].source,
    tvdbId: 123,
    topic: "Synthetic Series",
    targets: [
      { season: 0, episode: 2 },
      { season: 0, episode: 3 },
    ] as [{ season: number; episode: number }, { season: number; episode: number }],
    renditionIdentity: mediaSourceIdentity(pairedProgrammeItem.url_video),
  },
  episodeDurations: [
    { seconds: 60, provenance: "episode_metadata" as const },
    { seconds: 60, provenance: "episode_metadata" as const },
  ] as [
    { seconds: number; provenance: "episode_metadata" },
    { seconds: number; provenance: "episode_metadata" },
  ],
};
