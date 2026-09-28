import {
  queryMediathekView,
  type MediathekQueryField,
  type MediathekQueryOptions,
} from "@/lib/mediathek-client";
import { getSetting } from "@/lib/settings";
import { LANGUAGE_POLICY_SETTING_KEY, readLanguagePolicy } from "@/lib/language-policy";
import { srfProvider } from "@/providers/srf";
import { selectLanguageVariants } from "@/services/language-editions";
import type { ApiResultItem } from "@/types";

export async function getConfiguredLanguagePolicy() {
  return readLanguagePolicy(await getSetting(LANGUAGE_POLICY_SETTING_KEY));
}

/** Shared source for UI, Newznab and ruleset discovery, before episode/movie matching. */
export async function queryContent(
  queries: MediathekQueryField[],
  size: number,
  options: MediathekQueryOptions = {}
): Promise<ApiResultItem[] | null> {
  const [mvSetting, orfSetting, hlsSetting] = await Promise.all([
    getSetting("provider.mediathekview.enabled"),
    getSetting("provider.orf.enabled"),
    getSetting("download.enableHLS"),
  ]);
  const languagePolicy = await getConfiguredLanguagePolicy();
  const mvEnabled = mvSetting !== "false";
  const orfEnabled = orfSetting === "true" && hlsSetting === "true";
  const srfEnabled = await srfProvider.isEnabled();

  try {
    // Fetch a bounded candidate window so a preferred language edition is not
    // lost merely because its duplicate appeared just beyond the requested page.
    const candidateLimit = size > 0 ? Math.max(size, Math.min(size * 2, 5000)) : 0;
    const [indexed, swiss] = await Promise.all([
      mvEnabled || orfEnabled
        ? queryMediathekView(
            !mvEnabled && orfEnabled
              ? [...queries, { fields: ["channel"], query: "ORF" }]
              : queries,
            candidateLimit,
            options
          )
        : Promise.resolve([]),
      srfEnabled
        ? srfProvider.search({
            query: queries.find((q) => q.fields.includes("topic"))?.query || "",
            limit: Math.min(size, 100),
          })
        : Promise.resolve([]),
    ]);
    // Do not cache incomplete results when an enabled source fails.
    if (indexed === null) return null;
    const items = indexed.filter((item) => (/^ORF\b/i.test(item.channel) ? orfEnabled : mvEnabled));
    for (const item of swiss) {
      const converted: ApiResultItem = {
        channel: item.channel,
        topic: item.topic,
        title: item.title,
        description: item.description,
        filmlisteTimestamp: item.timestamp,
        duration: item.duration,
        size: item.size,
        url_website: item.websiteUrl,
        url_video: item.videoUrls.standard,
        url_video_hd: item.videoUrls.high || "",
        url_video_low: item.videoUrls.low || "",
      };
      if (
        queries.every(({ fields, query }) =>
          fields.some((field) =>
            String(converted[field as keyof ApiResultItem] ?? "")
              .toLowerCase()
              .includes(query.toLowerCase())
          )
        )
      )
        items.push(converted);
    }
    return selectLanguageVariants(items, languagePolicy).slice(0, size);
  } catch (error) {
    console.error("[ContentSearch] Provider failed:", error);
    return null;
  }
}
