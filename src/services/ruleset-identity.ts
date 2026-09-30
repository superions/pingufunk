import type { ApiResultItem, TvdbData } from "@/types";

function normalize(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim();
}

/** Generic ARTE topics describe a catalogue, not the series of a video. */
export function isSharedSeriesTopic(topic: string): boolean {
  return /^(?:fernsehfilme und serien\s*[-–]\s*serien|serien|arte\s*[-–]?\s*serien)$/.test(
    normalize(topic)
  );
}

/** Require an authoritative name/alias at the title boundary for shared topics. */
export function hasSharedTopicSeriesEvidence(item: ApiResultItem, show: TvdbData): boolean {
  if (!isSharedSeriesTopic(item.topic)) return true;
  const title = normalize(item.title);
  return [show.name, show.germanName, ...show.aliases.map((alias) => alias.name)].some((name) => {
    if (!name) return false;
    const normalized = normalize(name);
    if (normalized.length < 3 || !title.startsWith(normalized)) return false;
    const suffix = title.slice(normalized.length);
    return (
      suffix === "" ||
      /^(?:\s*[:(\-–]|\s+(?:staffel|folge|episode)\b|\s+s\d+(?:e\d+|\/e\d+|\b))/.test(suffix)
    );
  });
}
