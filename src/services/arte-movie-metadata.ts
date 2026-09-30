import { z } from "zod";
import { arteVideoId } from "./arte-editions";
import { fetchWithRetry, HttpRequestBudget } from "@/lib/fetch-retry";
import { ProviderResponseError, readBoundedProviderText } from "@/lib/bounded-provider-json";

const MAX_PAGE_BYTES = 2 * 1024 * 1024;
const programSchema = z.object({
  id: z.string(),
  programId: z.string(),
  type: z.literal("program"),
  title: z.string().trim().min(1).max(500),
  subtitle: z.string().nullable(),
  url: z.string(),
  kind: z.object({ code: z.literal("SHOW"), isCollection: z.literal(false) }),
  standaloneContent: z.literal(true),
  episodeInfo: z.null(),
  clip: z.null(),
  genre: z.object({ id: z.literal(2), itemLabel: z.literal("Film") }),
  player: z.object({ id: z.string() }),
  credits: z.array(z.object({ code: z.string(), values: z.array(z.string()).max(50) })).max(100),
  duration: z.number().positive().finite(),
});

export interface ArteMovieMetadata {
  source: "arte";
  videoId: string;
  title: string;
  productionYear: number;
  durationSeconds: number;
}

/** Only official German program pages, never a free-form URL fetch service. */
function moviePageUrl(raw: string): string | null {
  if (!arteVideoId(raw)) return null;
  const url = new URL(raw);
  if (!url.pathname.startsWith("/de/videos/")) return null;
  url.hostname = "www.arte.tv";
  url.search = "";
  url.hash = "";
  return url.href;
}

/**
 * Read a bounded subset of the observed Flight framing, not JavaScript or React
 * components. Length-tagged text is skipped by UTF-8 bytes; its prose must never
 * be parsed as a model or mined for years. Unknown binary framing fails closed.
 */
function flightModels(html: string, deadlineAt: number): unknown[] {
  if (Buffer.byteLength(html) > MAX_PAGE_BYTES) throw new ProviderResponseError();
  const chunks: string[] = [];
  for (const match of html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g)) {
    if (chunks.length >= 512 || Date.now() >= deadlineAt) throw new ProviderResponseError();
    const value: unknown = JSON.parse(match[1]);
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      value[0] === 1 &&
      typeof value[1] === "string"
    )
      chunks.push(value[1]);
  }
  if (!chunks.length) throw new ProviderResponseError();
  const bytes = Buffer.from(chunks.join(""));
  const models: unknown[] = [];
  let position = 0;
  let rows = 0;
  while (position < bytes.length) {
    if (++rows > 4096 || Date.now() >= deadlineAt) throw new ProviderResponseError();
    if (bytes[position] === 10) {
      position++;
      continue;
    }
    const header = /^[a-f0-9]*:/.exec(bytes.subarray(position, position + 32).toString());
    if (!header) throw new ProviderResponseError();
    position += header[0].length;
    const text = /^T([a-f0-9]{1,6}),/.exec(bytes.subarray(position, position + 32).toString());
    if (text) {
      position += text[0].length + parseInt(text[1], 16);
      if (position > bytes.length) throw new ProviderResponseError();
      continue;
    }
    const newline = bytes.indexOf(10, position);
    if (newline < 0) throw new ProviderResponseError();
    const row = bytes.subarray(position, newline).toString();
    position = newline + 1;
    if (/^[\[{"nft\d-]/.test(row)) models.push(JSON.parse(row));
    // Imports/hints/errors are not metadata. Other binary tags have a length
    // prefix and cannot be safely skipped as newline records.
    else if (!/^(?:I|H|E|D|W)/.test(row)) throw new ProviderResponseError();
  }
  return models;
}

/** A recommendation, magazine topic or broadcast timestamp is not film evidence. */
export function parseArteMoviePage(
  html: string,
  website: string,
  deadlineAt = Date.now() + 1000
): ArteMovieMetadata | null {
  const page = moviePageUrl(website);
  if (!page) return null;
  const id = arteVideoId(page)!;
  try {
    const candidates: unknown[] = [];
    for (const model of flightModels(html, deadlineAt)) {
      if (!Array.isArray(model) || model.length !== 4) continue;
      const data = model[3]?.data;
      if (
        !data ||
        data.language !== "de" ||
        data.type !== "program" ||
        data.code !== id ||
        !Array.isArray(data.zones)
      )
        continue;
      // Select only the primary program zone, never recurse into suggestions.
      for (const zone of data.zones) {
        if (zone?.code !== `program_content_${id}`) continue;
        if (!Array.isArray(zone.content?.data) || zone.content.data.length !== 1)
          throw new ProviderResponseError();
        candidates.push(zone.content.data[0]);
      }
    }
    if (candidates.length !== 1) throw new ProviderResponseError();
    const parsed = programSchema.safeParse(candidates[0]);
    if (!parsed.success) return null;
    const program = parsed.data;
    const programWebsite =
      program.url.startsWith("/") && !program.url.startsWith("//")
        ? new URL(program.url, "https://www.arte.tv").href
        : program.url;
    if (
      program.programId !== id ||
      program.id !== `${id}_de` ||
      program.player.id !== id ||
      arteVideoId(programWebsite) !== id ||
      program.subtitle?.trim()
    )
      return null;
    const years = program.credits.filter((credit) => credit.code === "PRODUCTION_YEAR");
    if (years.length !== 1 || years[0].values.length !== 1 || !/^\d{4}$/.test(years[0].values[0]))
      return null;
    const productionYear = Number(years[0].values[0]);
    if (productionYear < 1800 || productionYear > new Date().getUTCFullYear() + 2) return null;
    if (Date.now() >= deadlineAt) throw new ProviderResponseError();
    return {
      source: "arte",
      videoId: id,
      title: program.title,
      productionYear,
      durationSeconds: program.duration,
    };
  } catch {
    // Never expose page data, signed links, configuration or parser diagnostics.
    throw new ProviderResponseError();
  }
}

/** No successful empty cache on transport/framing failure; caller owns the budget. */
export async function fetchArteMovieMetadata(
  website: string,
  budget: HttpRequestBudget
): Promise<ArteMovieMetadata | null> {
  const page = moviePageUrl(website);
  if (!page) return null;
  const response = await fetchWithRetry(
    page,
    { headers: { Accept: "text/html" } },
    { requestBudget: budget }
  );
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok || !response.headers.get("content-type")?.startsWith("text/html")) {
    void response.body?.cancel().catch(() => {});
    throw new ProviderResponseError();
  }
  return parseArteMoviePage(
    await readBoundedProviderText(response, budget.deadlineAt, MAX_PAGE_BYTES),
    page,
    budget.deadlineAt
  );
}
