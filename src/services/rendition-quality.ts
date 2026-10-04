import type { ApiResultItem } from "@/types";
import { isRenditionAllowed } from "@/lib/stream-url";

export type QualityPreference = "all" | "best" | "1080p" | "720p" | "480p";

/** Missing, invalid or conflicting evidence never turns a catalogue slot into pixels. */
export function renditionDimensions(item: ApiResultItem, url: string) {
  const matches = item.sourceVideoDimensions?.filter((entry) => entry.url === url) ?? [];
  if (
    !matches.length ||
    matches.some(
      (entry) =>
        !Number.isSafeInteger(entry.width) ||
        !Number.isSafeInteger(entry.height) ||
        entry.width <= 0 ||
        entry.height <= 0 ||
        entry.width > 65_536 ||
        entry.height > 65_536 ||
        entry.width !== matches[0].width ||
        entry.height !== matches[0].height
    )
  )
    return null;
  return { width: matches[0].width, height: matches[0].height };
}

/**
 * Slot identity preserves shipped GUIDs; the release label uses independent
 * dimension evidence. Corrected titles must not manufacture a new source GUID.
 */
export function selectRenditions(
  item: ApiResultItem,
  preference: QualityPreference,
  hlsEnabled: boolean
) {
  const slots = [
    { field: "url_video_hd", identity: "1080p", multiplier: 1.6 },
    { field: "url_video", identity: "720p", multiplier: 1 },
    { field: "url_video_low", identity: "480p", multiplier: 0.4 },
  ] as const;
  const renditions = slots.flatMap((slot) => {
    const url = item[slot.field];
    if (!isRenditionAllowed(url, hlsEnabled)) return [];
    const dimensions = renditionDimensions(item, url);
    const height = dimensions?.height;
    const quality =
      height && [480, 576, 720, 1080, 2160].includes(height) ? `${height}p` : "UNKNOWN";
    return [{ ...slot, url, dimensions, quality }];
  });
  if (preference === "best") {
    // Unknown sources have no measured ordering; retain deterministic slot order
    // only when no supported, measured resolution is available.
    return [...renditions]
      .sort(
        (a, b) =>
          (b.quality === "UNKNOWN" ? 0 : b.dimensions!.height) -
          (a.quality === "UNKNOWN" ? 0 : a.dimensions!.height)
      )
      .slice(0, 1);
  }
  const selected =
    preference === "all"
      ? renditions
      : renditions.filter(
          (rendition) =>
            rendition.quality === preference ||
            // Preserve the configured catalogue selection for unknown sources,
            // but never turn that selection hint into a resolution claim.
            (rendition.quality === "UNKNOWN" && rendition.identity === preference)
        );
  // Deduplicate after preference selection: an unknown URL in both HD and
  // standard slots must remain selectable with the old standard-slot setting.
  const seen = new Set<string>();
  return selected.filter((rendition) => {
    if (seen.has(rendition.url)) return false;
    seen.add(rendition.url);
    return true;
  });
}
