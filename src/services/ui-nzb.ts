import type { ApiResultItem, UiNzbDownloads } from "@/types";
import { isRenditionAllowed } from "@/lib/stream-url";
import { generateFakeNzb } from "./nzb-release";
import { releaseMediaExpectations } from "./release-media-expectations";

/** Opaque server-authored releases; the browser never invents an expectation or XML. */
export function createUiNzbDownloads(item: ApiResultItem, hlsEnabled: boolean): UiNzbDownloads {
  // Preserve the shipped UI filename convention, including replacement of XML/path punctuation.
  const title = `${item.topic} - ${item.title}`.replace(/[<>:"/\\|?*]/g, "_");
  const downloads: UiNzbDownloads = {};
  for (const [key, url] of [
    ["hd", item.url_video_hd],
    ["sd", item.url_video],
    ["low", item.url_video_low],
  ] as const) {
    if (!isRenditionAllowed(url, hlsEnabled)) continue;
    downloads[key] = generateFakeNzb({
      title,
      url,
      mediaExpectations: releaseMediaExpectations(item, null, url),
    });
  }
  return downloads;
}
