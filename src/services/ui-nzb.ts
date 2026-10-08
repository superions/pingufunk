import type { ApiResultItem, UiNzbDownloads } from "@/types";
import { selectRenditions } from "./rendition-quality";
import { mediaSourceIdentity } from "./source-audio";
import { generateFakeNzb } from "./nzb-release";
import { releaseMediaExpectations } from "./release-media-expectations";
import { createHash } from "node:crypto";
import { parseNzbContent } from "./download";
import { serializeMediaExpectations } from "@/lib/media-expectations";

/** Canonical enqueue payload, not NZB transport timestamps. A fresh search after
 * reload can acknowledge the same intent when the actual job payload is unchanged.
 * Hashing stays server-side so HTTP UI needs no SubtleCrypto or second parser.
 */
export function uiNzbFingerprints(downloads: UiNzbDownloads): UiNzbDownloads {
  return Object.fromEntries(
    Object.entries(downloads).map(([quality, body]) => {
      const release = parseNzbContent(body);
      if (!release) throw new Error("Invalid server-authored NZB");
      return [
        quality,
        createHash("sha256")
          .update(
            JSON.stringify([
              1,
              release.url,
              release.title,
              release.mediaExpectations === undefined
                ? null
                : serializeMediaExpectations(release.mediaExpectations),
            ])
          )
          .digest("hex"),
      ];
    })
  );
}

/** Opaque server-authored releases; the browser never invents an expectation or XML. */
export function createUiNzbDownloads(item: ApiResultItem, hlsEnabled: boolean): UiNzbDownloads {
  // Preserve the shipped UI filename convention, including replacement of XML/path punctuation.
  const title = `${item.topic} - ${item.title}`.replace(/[<>:"/\\|?*]/g, "_");
  const downloads: UiNzbDownloads = {};
  for (const rendition of selectRenditions(item, "all", hlsEnabled)) {
    const { url } = rendition;
    const key =
      rendition.field === "url_video_hd" ? "hd" : rendition.field === "url_video" ? "sd" : "low";
    downloads[key] = generateFakeNzb({
      title,
      url,
      mediaExpectations: releaseMediaExpectations(
        // A proof for one rendition must not become an expectation for another.
        item.sourceAudioEvidence &&
          item.sourceAudioEvidence.mediaIdentity !== mediaSourceIdentity(url)
          ? { ...item, sourceAudioEvidence: undefined, audioLanguage: undefined }
          : item,
        null,
        url
      ),
    });
  }
  return downloads;
}
