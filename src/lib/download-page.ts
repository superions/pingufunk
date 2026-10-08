import type { QueueItem, HistoryItem } from "@/services/download";

export interface DownloadPageMeta {
  noofslots: number;
  noofslots_total: number;
  start: number;
  limit: number;
}

/** A page acknowledgement must belong to the requested window, not a late GET. */
export function parseDownloadPage<T>(
  value: unknown,
  start: number,
  limit: number,
  validateSlot: (slot: unknown) => boolean = (slot) => fields(slot, ["nzo_id"])
): { slots: T[]; meta: DownloadPageMeta } {
  if (!value || typeof value !== "object") throw new Error("Invalid download page");
  const page = value as Record<string, unknown>;
  if (
    !Array.isArray(page.slots) ||
    page.slots.length > limit ||
    !page.slots.every(validateSlot) ||
    page.start !== start ||
    page.limit !== limit ||
    !Number.isSafeInteger(page.noofslots) ||
    !Number.isSafeInteger(page.noofslots_total) ||
    (page.noofslots as number) < 0 ||
    (page.noofslots_total as number) < (page.noofslots as number) ||
    page.slots.length > Math.max(0, (page.noofslots as number) - start)
  )
    throw new Error("Invalid download page");
  return {
    slots: page.slots as T[],
    meta: {
      start,
      limit,
      noofslots: page.noofslots as number,
      noofslots_total: page.noofslots_total as number,
    },
  };
}

function fields(value: unknown, strings: string[], numbers: string[] = []): boolean {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    strings.every((key) => typeof row[key] === "string") &&
    numbers.every(
      (key) =>
        typeof row[key] === "number" && Number.isFinite(row[key]) && (row[key] as number) >= 0
    )
  );
}

export function parseQueuePage(value: unknown, start: number, limit: number) {
  return parseDownloadPage<QueueItem>(value, start, limit, (row) =>
    fields(row, [
      "nzo_id",
      "filename",
      "status",
      "percentage",
      "timeleft",
      "cat",
      "mb",
      "mbleft",
      "speed",
    ])
  );
}

export function parseHistoryPage(value: unknown, start: number, limit: number) {
  return parseDownloadPage<HistoryItem>(value, start, limit, (row) =>
    fields(
      row,
      ["nzo_id", "name", "status", "category", "storage", "fail_message"],
      ["completed", "bytes"]
    )
  );
}
