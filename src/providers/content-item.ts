import type { ApiResultItem } from "@/types";
import type { ProviderContentItem } from "@/types/provider";
import { catalogueMetadata } from "@/lib/catalogue-metadata";
import { parseYoutubeSource } from "@/lib/youtube-source";

/** Internal adapter only: the raw catalogue boundary never accepts these proof fields. */
export function providerItemToApiResult(item: ProviderContentItem): ApiResultItem {
  return {
    id: item.id,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    filmlisteTimestamp: item.timestamp,
    ...catalogueMetadata({ ...item, url_subtitle: item.subtitleUrl }),
    ...(item.sourceAvailability ? { sourceAvailability: item.sourceAvailability } : {}),
    duration: item.duration,
    size: item.size,
    url_website: item.websiteUrl,
    url_video: item.videoUrls.standard,
    url_video_hd: item.videoUrls.high || "",
    url_video_low: item.videoUrls.low || "",
    ...(item.providerId === "mediathekview" ||
    item.providerId === "orf" ||
    item.providerId === "srf" ||
    item.providerId === "youtube"
      ? { sourceProviderId: item.providerId }
      : {}),
    ...(item.sourceAudioEvidence ? { sourceAudioEvidence: item.sourceAudioEvidence } : {}),
    ...(item.sourceVideoDimensions ? { sourceVideoDimensions: item.sourceVideoDimensions } : {}),
    ...(item.sourceRef ? { sourceRef: parseYoutubeSource(item.sourceRef) } : {}),
  };
}

/** Keep the shipped provider ID convention and never synthesize an absent HD URL. */
export function apiResultToProviderItem(
  item: ApiResultItem,
  providerId: string
): ProviderContentItem {
  const { url_subtitle, ...metadata } = catalogueMetadata(item);
  return {
    id: `${item.channel}-${item.topic}-${item.title}-${item.filmlisteTimestamp}`,
    providerId,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    timestamp: item.filmlisteTimestamp,
    ...metadata,
    ...(url_subtitle ? { subtitleUrl: url_subtitle } : {}),
    ...(item.sourceAvailability ? { sourceAvailability: item.sourceAvailability } : {}),
    duration: item.duration,
    size: item.size,
    websiteUrl: item.url_website,
    videoUrls: {
      standard: item.url_video,
      high: item.url_video_hd || undefined,
      low: item.url_video_low || undefined,
    },
    ...(item.sourceAudioEvidence ? { sourceAudioEvidence: item.sourceAudioEvidence } : {}),
    ...(item.sourceVideoDimensions ? { sourceVideoDimensions: item.sourceVideoDimensions } : {}),
    ...(item.sourceRef ? { sourceRef: parseYoutubeSource(item.sourceRef) } : {}),
  };
}
