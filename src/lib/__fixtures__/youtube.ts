import { createHash } from "node:crypto";
import { youtubeRenditionIdentity, type YoutubeSourceReference } from "../youtube-source";
/** Synthetic stable selectors, never an actual YouTube response or media address. */
export const syntheticYoutubeSource = (): YoutubeSourceReference => ({
  version: 1,
  family: "youtube",
  videoId: "abcdefghijk",
  channelId: "UCaaaaaaaaaaaaaaaaaaaaaa",
  playlistId: "PLsynthetic123456",
  mappingRevision: "a".repeat(64),
  programme: { kind: "series", targetId: 42, season: 1, episode: 1 },
  originalTitle: "Synthetic series, Staffel 2, Folge 1: Concrete episode",
  selection: {
    videoFormat: "137",
    audioFormat: "140-1",
    audioTrack: "140-1",
    language: "de",
    width: 1280,
    height: 720,
    duration: 120,
  },
});
export function syntheticYoutubeExpectations() {
  const source = syntheticYoutubeSource();
  return {
    version: 5 as const,
    mediaKind: "series" as const,
    durations: {
      source: {
        seconds: 120,
        provenance: "source_catalogue" as const,
        tolerancePercent: 10 as const,
      },
      metadata: { seconds: 120, provenance: "episode_metadata" as const, tolerancePercent: 10 },
    },
    audio: null,
    sourceAudio: {
      provider: "youtube" as const,
      videoId: source.videoId,
      channelId: source.channelId,
      language: "de" as const,
      mediaIdentity: createHash("sha256").update(youtubeRenditionIdentity(source)).digest("hex"),
      selection: source.selection,
    },
    resolution: { width: 1280, height: 720, provenance: "provider_dimensions" as const },
    sourceRef: source,
  };
}
