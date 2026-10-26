import { getSetting } from "@/lib/settings";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { readYoutubeCatalogueIndex } from "@/services/youtube-catalogue";
import { boundYoutubeItems } from "@/services/youtube-bindings";
import type { ContentSearchAdapter, ContentSearchWindow } from "@/types/provider";
import { sourceMediaFacts } from "@/services/source-media-facts";
let failureEpoch = 0;
export async function youtubeSearchContext(): Promise<unknown> {
  if ((await getSetting("provider.youtube.enabled")) !== "true") return null;
  try {
    const index = await readYoutubeCatalogueIndex();
    return [index.revision, index.current, index.at, sourceMediaFacts.contextKey, failureEpoch];
  } catch {
    return ["unavailable", failureEpoch];
  }
}

/** Search only the explicitly prepared complete index. No scan, extractor or media request here. */
export const youtubeSearchAdapter: ContentSearchAdapter = {
  providerIds: ["youtube"],
  cacheSettingKeys: ["provider.youtube.enabled"],
  rssWindowAttempts: 0,
  providerForItem: () => "youtube",
  async searchWindow(queries, size, options, _hls, providerId) {
    if (providerId && providerId !== "youtube") throw Error("Wrong source");
    const enabled = (await getSetting("provider.youtube.enabled")) === "true";
    if (!enabled)
      return {
        items: [],
        coverage: {
          complete: true,
          candidateWindowLimited: false,
          sources: providerId
            ? [{ providerId: "youtube", state: "disabled", candidateCount: 0 }]
            : [],
        },
      };
    try {
      const index = await readYoutubeCatalogueIndex();
      if (!index.enabled || !index.indexed || !index.current)
        throw Error("YouTube index unavailable");
      const budget =
        options.requestBudget ??
        new HttpRequestBudget(
          32,
          Math.max(1, Math.min(15000, (options.deadlineAt ?? Date.now() + 15000) - Date.now()))
        );
      const mappings = index.registry.programMappings.filter(
        (mapping) =>
          mapping.enabled &&
          (!options.mediaType ||
            options.mediaType === "all" ||
            options.mediaType === mapping.kind) &&
          index.registry.channels.some(
            (channel) => channel.enabled && channel.id === mapping.channelId
          ) &&
          (options.arteSeries
            ? mapping.kind === "series" && mapping.targetId === options.arteSeries.id
            : queries.every((query) =>
                query.fields.some(
                  (field) =>
                    ["topic", "title"].includes(field) &&
                    mapping.name
                      .toLocaleLowerCase("de-DE")
                      .includes(query.query.toLocaleLowerCase("de-DE"))
                )
              ))
      );
      if (mappings.length > 32) throw Error("YouTube programme window too large");
      const items = [];
      let limited = false;
      for (const mapping of mappings) {
        budget.assertAvailable();
        items.push(...(await boundYoutubeItems(index, mapping, budget, options.arteSeries)));
        if (items.length >= 1000) {
          limited = true;
          break;
        }
      }
      const offset = options.offset ?? 0;
      const { enrichSourceAudio } = await import("@/services/source-audio");
      const proven = await enrichSourceAudio(items.slice(0, 1000), budget, 4, true);
      const ready = [...proven.values()].flat();
      return {
        items: ready.slice(offset, offset + size),
        coverage: {
          complete: true,
          candidateWindowLimited: limited || items.length > offset + size,
          sources: [
            {
              providerId: "youtube",
              state: "complete",
              candidateCount: Math.min(items.length, 1000),
            },
          ],
        },
      };
    } catch {
      failureEpoch++;
      return {
        items: [],
        coverage: {
          complete: false,
          candidateWindowLimited: false,
          sources: [{ providerId: "youtube", state: "failed", candidateCount: 0 }],
        },
      } satisfies ContentSearchWindow;
    }
  },
};
