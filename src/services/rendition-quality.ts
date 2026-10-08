import type { ApiResultItem } from "@/types";
import { isRenditionAllowed } from "@/lib/stream-url";
import { recordDecision } from "@/server/decision-diagnostics";
import { sourceAvailabilityState } from "@/lib/content-dates";

export type QualityPreference = "all" | "best" | "1080p" | "720p" | "480p";

function rightsPermit(item: ApiResultItem, url: string): boolean {
  if (!url) return false;
  const state = sourceAvailabilityState(item.sourceAvailability, url);
  recordDecision(
    "availability",
    state === "conflicting"
      ? "rights_conflict"
      : state === "expired"
        ? "rights_expired"
        : state === "not_yet"
          ? "rights_not_yet"
          : state === "rights_current"
            ? "rights_current"
            : "rights_unknown",
    state === "conflicting" ? "conflicting" : state === "unknown" ? "missing" : "proven"
  );
  return state === "unknown" || state === "rights_current";
}

/** Remove ineligible selectors before edition dedupe, not just before a button renders. */
export function eligibleRenditionItem(item: ApiResultItem, hlsEnabled: boolean): ApiResultItem {
  return {
    ...item,
    url_video:
      rightsPermit(item, item.url_video) && isRenditionAllowed(item.url_video, hlsEnabled)
        ? item.url_video
        : "",
    url_video_hd:
      rightsPermit(item, item.url_video_hd) && isRenditionAllowed(item.url_video_hd, hlsEnabled)
        ? item.url_video_hd
        : "",
    url_video_low:
      rightsPermit(item, item.url_video_low) && isRenditionAllowed(item.url_video_low, hlsEnabled)
        ? item.url_video_low
        : "",
  };
}

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
  ) {
    recordDecision("rendition", "rendition_unverified", matches.length ? "conflicting" : "missing");
    return null;
  }
  recordDecision("rendition", "rendition_verified", "proven");
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
    if (!rightsPermit(item, url) || !isRenditionAllowed(url, hlsEnabled)) return [];
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
