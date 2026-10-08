/** SAB's limit=0 (and the shipped omitted limit) means all matching jobs.
 * Only an explicitly requested page is capped; never silently hide old imports.
 */
export interface DownloadRead {
  start: number;
  limit: number;
  categories: string[];
  ids: string[];
  search: string;
  statuses: string[];
}

export class DownloadReadError extends Error {
  constructor() {
    super("Invalid download read parameters");
  }
}

const statuses = {
  queue: { Queued: "queued", Downloading: "downloading", Extracting: "converting" },
  history: { Completed: "completed", Failed: "failed" },
} as const;

export function parseDownloadRead(
  params: URLSearchParams,
  kind: "queue" | "history"
): DownloadRead {
  const value = (key: string) => {
    const all = params.getAll(key);
    if (all.length > 1) throw new DownloadReadError();
    return all[0];
  };
  const integer = (key: string, maximum: number) => {
    const text = value(key);
    if (text === undefined) return 0;
    if (!/^(0|[1-9]\d{0,6})$/.test(text) || Number(text) > maximum) throw new DownloadReadError();
    return Number(text);
  };
  const list = (text: string | undefined, maximum: number, pattern: RegExp) => {
    if (text === undefined) return [];
    const items = text.split(",");
    if (items.length > maximum || items.some((item) => !pattern.test(item)))
      throw new DownloadReadError();
    return [...new Set(items)];
  };
  const cat = value("cat"),
    category = value("category");
  if (cat !== undefined && category !== undefined && cat !== category)
    throw new DownloadReadError();
  const search = value("search") ?? "";
  if (search.length > 200 || /[\u0000-\u001f\u007f]/.test(search)) throw new DownloadReadError();
  const selected = list(value("status"), 3, /^[A-Za-z]{1,32}$/);
  const allowed: Record<string, string> = statuses[kind];
  if (selected.some((item) => !allowed[item])) throw new DownloadReadError();
  const failed = value("failed_only");
  if (failed !== undefined && (kind !== "history" || !["0", "1"].includes(failed)))
    throw new DownloadReadError();
  if (failed === "1" && selected.length && selected.some((item) => item !== "Failed"))
    throw new DownloadReadError();
  return {
    start: integer("start", 1_000_000),
    limit: integer("limit", 10_000),
    categories: list(cat ?? category, 16, /^(?:\*|[A-Za-z0-9_-]{1,96})$/).map((item) =>
      item === "*" ? "default" : item
    ),
    ids: list(value("nzo_ids"), 100, /^[A-Za-z0-9_-]{1,128}$/),
    search,
    statuses: failed === "1" ? ["failed"] : selected.map((item) => allowed[item]),
  };
}

export const allDownloads: DownloadRead = Object.freeze({
  start: 0,
  limit: 0,
  categories: [],
  ids: [],
  search: "",
  statuses: [],
});

/** Hidden tabs stop polling; idle pages poll less often, errors back off.
 * Explicit user refresh and page/filter changes are independent of this timer.
 */
export function downloadPollDelay(
  visible: boolean,
  active: number,
  failed: boolean
): number | null {
  return !visible ? null : failed ? 30_000 : active > 0 ? 5_000 : 30_000;
}
