import type { ApiResultItem } from "@/types";
import type { ProviderContentItem } from "@/types/provider";

/** Internal adapter only: the raw catalogue boundary never accepts these proof fields. */
export function providerItemToApiResult(item: ProviderContentItem): ApiResultItem {
  return {
    id: item.id,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    filmlisteTimestamp: item.timestamp,
    ...(item.contentDates ? { contentDates: item.contentDates } : {}),
    ...(item.sourceAvailability ? { sourceAvailability: item.sourceAvailability } : {}),
    duration: item.duration,
    size: item.size,
    url_website: item.websiteUrl,
    url_video: item.videoUrls.standard,
    url_video_hd: item.videoUrls.high || "",
    url_video_low: item.videoUrls.low || "",
    ...(item.providerId === "mediathekview" ||
    item.providerId === "orf" ||
    item.providerId === "srf"
      ? { sourceProviderId: item.providerId }
      : {}),
    ...(item.audioLanguage !== undefined ? { audioLanguage: item.audioLanguage } : {}),
    ...(item.sourceAudioEvidence ? { sourceAudioEvidence: item.sourceAudioEvidence } : {}),
    ...(item.sourceVideoDimensions ? { sourceVideoDimensions: item.sourceVideoDimensions } : {}),
  };
}

/** Keep the shipped provider ID convention and never synthesize an absent HD URL. */
export function apiResultToProviderItem(
  item: ApiResultItem,
  providerId: string
): ProviderContentItem {
  return {
    id: `${item.channel}-${item.topic}-${item.title}-${item.filmlisteTimestamp}`,
    providerId,
    channel: item.channel,
    topic: item.topic,
    title: item.title,
    description: item.description,
    timestamp: item.filmlisteTimestamp,
    ...(item.contentDates ? { contentDates: item.contentDates } : {}),
    ...(item.sourceAvailability ? { sourceAvailability: item.sourceAvailability } : {}),
    duration: item.duration,
    size: item.size,
    websiteUrl: item.url_website,
    videoUrls: {
      standard: item.url_video,
      high: item.url_video_hd || undefined,
      low: item.url_video_low || undefined,
    },
    ...(item.audioLanguage !== undefined ? { audioLanguage: item.audioLanguage } : {}),
    ...(item.sourceAudioEvidence ? { sourceAudioEvidence: item.sourceAudioEvidence } : {}),
    ...(item.sourceVideoDimensions ? { sourceVideoDimensions: item.sourceVideoDimensions } : {}),
  };
}
