import { z } from "zod";
import { readYoutubeMediaMetadata } from "@/server/ytdlp";
import { isGermanLanguageCode } from "@/lib/language-policy";
import { youtubeChannelId, youtubeVideoId } from "@/lib/youtube-catalogue";
import { youtubeSelectionSchema, type YoutubeSelection } from "@/lib/youtube-source";

export class YoutubeResolutionError extends Error {
  constructor() {
    super("YouTube media identity, rendition or audio is unconfirmed");
  }
}
const format = z.object({
  format_id: z.string().min(1).max(80),
  url: z.string().max(16384),
  protocol: z.string().max(40),
  vcodec: z.string().max(100),
  acodec: z.string().max(100),
  width: z.number().int().positive().max(65536).optional(),
  height: z.number().int().positive().max(65536).optional(),
  language: z.string().max(35).nullish(),
  language_preference: z.number().finite().optional(),
  format_note: z.string().max(200).optional(),
  audio_channels: z.number().int().positive().max(32).optional(),
  has_drm: z.boolean().optional(),
  filesize: z.number().int().positive().optional(),
  abr: z.number().finite().nonnegative().optional(),
  fps: z.number().finite().nonnegative().optional(),
});
const metadata = z.object({
  id: youtubeVideoId,
  channel_id: youtubeChannelId,
  duration: z.number().finite().positive().max(86400),
  is_live: z.boolean().optional(),
  live_status: z.string().max(40).optional(),
  age_limit: z.number().int().nonnegative().optional(),
  availability: z.string().max(40).optional(),
  formats: z.array(format).min(1).max(1000),
});
/** Only HTTPS media on YouTube's own CDN; redirects and arbitrary extractor URLs are not transfers. */
export function youtubeCdnUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "https:" ||
      url.port ||
      url.username ||
      url.password ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.googlevideo\.com$/.test(url.hostname) ||
      url.pathname !== "/videoplayback" ||
      url.hash
    )
      throw Error();
    const expires = url.searchParams.get("expire");
    if (!expires || !/^\d+$/.test(expires) || Number(expires) * 1000 <= Date.now() + 60000)
      throw Error();
    return url.href;
  } catch {
    throw new YoutubeResolutionError();
  }
}
function trackIdentity(value: z.infer<typeof format>): string {
  // yt-dlp's format ID includes the selected audio-track identity (e.g. 140-1).
  // Keep it verbatim; language labels or playlist position never choose a track.
  return value.format_id;
}
/** One resolver for background facts and accepted transfers. Selection never falls back after rotation. */
export async function resolveYoutubeMedia(
  identity: { videoId: string; channelId: string },
  signal: AbortSignal,
  expected?: YoutubeSelection
): Promise<{ selection: YoutubeSelection; videoUrl: string; audioUrl: string; size: number }> {
  try {
    signal.throwIfAborted();
    const raw = metadata.parse(
      await readYoutubeMediaMetadata(youtubeVideoId.parse(identity.videoId), signal)
    );
    if (
      raw.id !== identity.videoId ||
      raw.channel_id !== identity.channelId ||
      raw.is_live ||
      (raw.live_status && !["not_live", "was_live"].includes(raw.live_status)) ||
      (raw.age_limit ?? 0) > 0 ||
      (raw.availability && raw.availability !== "public")
    )
      throw Error();
    const unique = new Set<string>();
    for (const row of raw.formats) {
      if (unique.has(row.format_id)) throw Error();
      unique.add(row.format_id);
    }
    const safe = raw.formats.filter(
      (row) =>
        !row.has_drm &&
        row.protocol === "https" &&
        row.vcodec !== "unknown" &&
        row.acodec !== "unknown"
    );
    const audios = safe.filter(
      (row) =>
        row.vcodec === "none" &&
        row.acodec !== "none" &&
        row.language &&
        isGermanLanguageCode(row.language) &&
        row.audio_channels &&
        !/\b(?:audio description|descriptive|audiodeskription|drc)\b/i.test(row.format_note ?? "")
    );
    const videos = safe.filter(
      (row) =>
        row.vcodec !== "none" &&
        row.acodec === "none" &&
        row.width &&
        row.height &&
        [480, 576, 720, 1080, 2160].includes(row.height)
    );
    const audio = expected
      ? audios.find(
          (row) =>
            row.format_id === expected.audioFormat && trackIdentity(row) === expected.audioTrack
        )
      : audios.sort(
          (a, b) => (b.abr ?? 0) - (a.abr ?? 0) || a.format_id.localeCompare(b.format_id)
        )[0];
    const video = expected
      ? videos.find((row) => row.format_id === expected.videoFormat)
      : videos.sort(
          (a, b) =>
            b.height! - a.height! ||
            b.width! - a.width! ||
            (b.fps ?? 0) - (a.fps ?? 0) ||
            a.format_id.localeCompare(b.format_id)
        )[0];
    if (!audio || !video) throw Error();
    const selection = youtubeSelectionSchema.parse({
      videoFormat: video.format_id,
      audioFormat: audio.format_id,
      audioTrack: trackIdentity(audio),
      language: "de",
      width: video.width,
      height: video.height,
      duration: raw.duration,
    });
    if (
      expected &&
      (selection.videoFormat !== expected.videoFormat ||
        selection.audioFormat !== expected.audioFormat ||
        selection.audioTrack !== expected.audioTrack ||
        selection.language !== expected.language ||
        selection.width !== expected.width ||
        selection.height !== expected.height ||
        Math.abs(selection.duration - expected.duration) > 5)
    )
      throw Error();
    const videoUrl = youtubeCdnUrl(video.url),
      audioUrl = youtubeCdnUrl(audio.url);
    signal.throwIfAborted();
    return { selection, videoUrl, audioUrl, size: (video.filesize ?? 0) + (audio.filesize ?? 0) };
  } catch {
    throw new YoutubeResolutionError();
  }
}
