import { readYoutubeMetadata } from "@/server/ytdlp";
import {
  youtubeInput,
  youtubeVideoId,
  YoutubeCatalogueDataError,
  type YoutubeInput,
} from "@/lib/youtube-catalogue";

export interface YoutubeCatalogueChecks {
  count: number;
  known: Map<string, unknown>;
}
/** Flat extraction can omit all private-video fields. Confirm that exact ID with
 * a separate metadata-only lookup; malformed available rows are never skipped. */
export async function readYoutubeCataloguePage(
  input: YoutubeInput,
  offset: number,
  signal: AbortSignal,
  checks: YoutubeCatalogueChecks
): Promise<unknown> {
  const raw = await readYoutubeMetadata(input, offset, signal, input.kind === "movie");
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { entries?: unknown }).entries))
    return raw;
  const entries = (raw as { entries: unknown[] }).entries;
  if (entries.length > 100) return raw;
  const repaired: unknown[] = [];
  for (const value of entries) {
    signal.throwIfAborted();
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const row = value as Record<string, unknown>;
      if (
        youtubeVideoId.safeParse(row.id).success &&
        row._type === "url" &&
        row.ie_key === "Youtube" &&
        row.title === null &&
        row.channel_id == null &&
        row.duration === null &&
        row.availability === null
      ) {
        const id = row.id as string;
        if (!checks.known.has(id)) {
          if (checks.count >= 10) throw new YoutubeCatalogueDataError("detail_limit");
          checks.count++;
          const checked = await readYoutubeMetadata(youtubeInput(id), 0, signal, true);
          if (!checked || typeof checked !== "object" || (checked as { id?: unknown }).id !== id)
            throw new YoutubeCatalogueDataError("invalid_row");
          const facts = checked as Record<string, unknown>;
          const text = (key: string, limit: number) =>
            typeof facts[key] === "string" && (facts[key] as string).length <= limit
              ? facts[key]
              : undefined;
          // No volatile format URLs or unbounded descriptions survive the private probe.
          checks.known.set(id, {
            id,
            channel_id: text("channel_id", 24),
            title: text("title", 500),
            description: text("description", 8000),
            availability: text("availability", 35),
            duration: typeof facts.duration === "number" ? facts.duration : undefined,
            upload_date: text("upload_date", 8),
          });
        }
        repaired.push(checks.known.get(id));
        continue;
      }
    }
    repaired.push(value);
  }
  return { ...raw, entries: repaired };
}
