import { createHash } from "node:crypto";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { assertWritesEnabled } from "@/lib/write-gate";
import { HttpRequestBudget } from "@/lib/fetch-retry";
import { getSetting, getMinDurationSeconds } from "@/lib/settings";
import { cacheContextEpoch } from "@/lib/cache";
import {
  parseMediaExpectations,
  hasMediaRuntimeConflict,
  type NewMediaExpectations,
  type MediaExpectations,
} from "@/lib/media-expectations";
import { openSonarrSession, mergeSonarrShow } from "./sonarr-provider";
import { getBaseShowInfoByTvdbId } from "./shows";
import { queryTvSourceCandidates } from "./mediathek";
import { matchSonarrEpisodes } from "./sonarr-matcher";
import { getConfiguredLanguagePolicy } from "./content-search";
import { enrichSourceAudio } from "./source-audio";
import { tvReviewMediaExpectations } from "./release-media-expectations";
import { verifiedRuleTopics } from "./tv-search-terms";
import { stableUrlIdentity, classifyLanguageEdition } from "./language-editions";
import { generateTitle, formatTitle } from "./newznab";
import { validateReleaseTitle } from "@/lib/download-paths";
import { triggerDownloadProcessing } from "./download";
import { EpisodeType, type ApiResultItem, type MatchedEpisodeInfo } from "@/types";
import { selectRenditions } from "./rendition-quality";
import { sourceMediaFacts } from "./source-media-facts";

const hex = z.string().regex(/^[a-f0-9]{64}$/);
export const tvReviewSelectorSchema = z
  .object({
    tvdbId: z.number().int().positive().max(2_147_483_647),
    season: z.number().int().nonnegative().max(10_000),
    episode: z.number().int().positive().max(100_000),
    sourceId: hex,
    rendition: z.enum(["hd", "sd", "low"]),
  })
  .strict();
export type TvReviewSelector = z.infer<typeof tvReviewSelectorSchema>;
export interface TvReviewSummary {
  selector: TvReviewSelector;
  title: string;
  sourceSeconds: number;
  metadataSeconds: number;
  tolerancePercent: number;
  runtimeConflict: boolean;
  availableRenditions: TvReviewSelector["rendition"][];
}
export interface TvReviewPreview extends TvReviewSummary {
  fingerprint: string;
  width: number;
  height: number;
  language: string;
}
interface PreparedSource {
  preview: TvReviewPreview;
  url: string;
  expectations: NewMediaExpectations;
  epoch: number;
  info: MatchedEpisodeInfo;
}
export class TvSourceReviewError extends Error {
  constructor() {
    super("Quelle nicht mehr eindeutig verifiziert. Erneut suchen und prüfen.");
  }
}
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const normalized = (value: string) =>
  value
    .normalize("NFC")
    .toLocaleLowerCase("de-DE")
    .replace(/[.\s]+/g, " ")
    .trim();
const fields = { hd: "url_video_hd", sd: "url_video", low: "url_video_low" } as const;

/** Ignore only known transient URL selectors, not edition, quality or programme. */
function sourceId(item: ApiResultItem): string {
  return hash([
    item.channel,
    item.topic,
    item.title,
    item.url_website,
    ...Object.values(fields).map((field) => (item[field] ? stableUrlIdentity(item[field]) : "")),
  ]);
}

async function matches(tvdbId: number, budget: HttpRequestBudget, selector?: TvReviewSelector) {
  const session = await openSonarrSession();
  if (!session) throw new TvSourceReviewError();
  const fresh = await session.show(tvdbId, budget, true);
  if (!fresh) throw new TvSourceReviewError();
  const base = await getBaseShowInfoByTvdbId(tvdbId, budget);
  const show = mergeSonarrShow(base, fresh)!;
  const candidates = await queryTvSourceCandidates(
    show,
    {
      query: null,
      tvdbId,
      season: selector ? String(selector.season) : null,
      episode: selector ? String(selector.episode) : null,
    },
    budget
  );
  if (candidates === null) throw new TvSourceReviewError();
  const tolerance = Number((await getSetting("matching.sonarr.tolerancePercent")) ?? "10");
  if (!Number.isInteger(tolerance) || tolerance < 0 || tolerance > 25)
    throw new TvSourceReviewError();
  const found = matchSonarrEpisodes(
    show,
    candidates,
    await getMinDurationSeconds(),
    tolerance,
    await getConfiguredLanguagePolicy(),
    false,
    false,
    verifiedRuleTopics(show),
    true
  );
  return { found, tolerance };
}

function summary(
  info: MatchedEpisodeInfo,
  tolerance: number,
  rendition: TvReviewSelector["rendition"]
): TvReviewSummary {
  return {
    selector: {
      tvdbId: info.tvdbId,
      season: info.episode.seasonNumber,
      episode: info.episode.episodeNumber,
      sourceId: sourceId(info.item),
      rendition,
    },
    title: `${info.showName} S${String(info.episode.seasonNumber).padStart(2, "0")}E${String(info.episode.episodeNumber).padStart(2, "0")} — ${info.item.title}`,
    sourceSeconds: info.item.duration,
    metadataSeconds: info.episode.runtime! * 60,
    tolerancePercent: tolerance,
    runtimeConflict: !!info.runtimeConflict,
    availableRenditions: (Object.keys(fields) as TvReviewSelector["rendition"][]).filter(
      (key) => !!info.item[fields[key]]
    ),
  };
}

/** Exact instance names use verified TV review; unbound browsing stays unbound. */
export async function searchTvSourceReviews(
  query: string
): Promise<Array<{ info: MatchedEpisodeInfo; review: TvReviewSummary }> | null> {
  const budget = new HttpRequestBudget(32);
  const session = await openSonarrSession();
  if (!session) return null;
  const owners = (await session.inventory(budget, true)).filter((series) =>
    [series.title, ...(series.aliases ?? [])].some((name) => normalized(name) === normalized(query))
  );
  if (owners.length === 0) return null;
  if (owners.length !== 1) throw new TvSourceReviewError();
  const { found, tolerance } = await matches(owners[0].tvdbId, budget);
  sourceMediaFacts.enqueue(
    Object.values(fields).flatMap((field) => found.map((info) => info.item[field]))
  );
  return found
    .filter(
      (info) => info.episode.runtime !== null && info.episode.runtime > 0 && info.item.duration > 0
    )
    .map((info) => ({
      info,
      review: summary(
        info,
        tolerance,
        info.item.url_video_hd ? "hd" : info.item.url_video ? "sd" : "low"
      ),
    }));
}

/** Re-query exactly one source on every preview/confirmation and before transfer. */
async function prepare(selector: TvReviewSelector): Promise<PreparedSource> {
  const epoch = cacheContextEpoch();
  const budget = new HttpRequestBudget(32);
  const { found, tolerance } = await matches(selector.tvdbId, budget, selector);
  const exact = found.filter(
    (info) =>
      info.episode.seasonNumber === selector.season &&
      info.episode.episodeNumber === selector.episode &&
      sourceId(info.item) === selector.sourceId
  );
  const unique = [...new Map(exact.map((info) => [JSON.stringify(info.item), info])).values()];
  if (unique.length !== 1) throw new TvSourceReviewError();
  const info = unique[0];
  const url = info.item[fields[selector.rendition]];
  if (!url) throw new TvSourceReviewError();
  // Probe only the selected rendition. Another slot cannot donate its proof.
  const selected = {
    ...info.item,
    url_video: "",
    url_video_hd: "",
    url_video_low: "",
    [fields[selector.rendition]]: url,
  };
  const enriched = (await enrichSourceAudio([selected], budget))
    .get(selected)
    ?.filter((item) => item[fields[selector.rendition]] === url);
  if (enriched?.length !== 1) throw new TvSourceReviewError();
  const expectations = tvReviewMediaExpectations(
    enriched[0],
    info.episode.runtime!,
    url,
    tolerance
  );
  const language = expectations.audio?.language ?? expectations.sourceAudio?.language;
  if (
    !expectations.resolution ||
    !language ||
    epoch !== cacheContextEpoch() ||
    Date.now() >= budget.deadlineAt
  )
    throw new TvSourceReviewError();
  const preview = {
    ...summary(info, tolerance, selector.rendition),
    width: expectations.resolution.width,
    height: expectations.resolution.height,
    language,
    fingerprint: hash([
      selector,
      url,
      expectations,
      info.showName,
      info.episode.name,
      info.episode.aired,
      classifyLanguageEdition(enriched[0]),
      enriched[0].sourceAssetFingerprint ?? null,
    ]),
  };
  return { preview, url, expectations, epoch, info: { ...info, item: enriched[0] } };
}

export async function previewTvSource(selector: TvReviewSelector): Promise<TvReviewPreview> {
  return (await prepare(tvReviewSelectorSchema.parse(selector))).preview;
}

const receiptSchema = z
  .object({ id: z.uuid(), fingerprint: hex, expectations: z.string() })
  .strict();
const receiptKey = (fingerprint: string) => `internal.manual-review.${fingerprint}`;

/** Existing Config/Download rows form one transaction; no DDL or global setting change.
 * Receipt survives history removal. Same source/decision never silently re-grabs.
 */
export async function confirmTvSource(
  selector: TvReviewSelector,
  fingerprint: string,
  intentId: string
) {
  assertWritesEnabled();
  selector = tvReviewSelectorSchema.parse(selector);
  hex.parse(fingerprint);
  z.uuid().parse(intentId);
  const existing = await prisma.config.findUnique({ where: { key: receiptKey(fingerprint) } });
  if (existing) return readReceipt(existing.value, fingerprint, selector);
  const prepared = await prepare(selector);
  if (
    prepared.preview.fingerprint !== fingerprint ||
    !hasMediaRuntimeConflict(prepared.expectations)
  )
    throw new TvSourceReviewError();
  const expectations = parseMediaExpectations({
    ...prepared.expectations,
    version: 4,
    approval: {
      kind: "episode_runtime_once",
      jobId: intentId,
      fingerprint,
      confirmedAt: new Date().toISOString(),
      ...selector,
    },
  });
  const serialized = JSON.stringify(expectations);
  const rendition = selectRenditions(prepared.info.item, "all", false).find(
    (candidate) => candidate.url === prepared.url
  );
  if (!rendition) throw new TvSourceReviewError();
  const title = formatTitle(generateTitle(prepared.info, rendition.quality, EpisodeType.Standard));
  validateReleaseTitle(title);
  try {
    if (prepared.epoch !== cacheContextEpoch()) throw new TvSourceReviewError();
    await prisma.$transaction(
      async (tx) => {
        await tx.config.create({
          data: {
            key: receiptKey(fingerprint),
            value: JSON.stringify({ id: intentId, fingerprint, expectations: serialized }),
          },
        });
        await tx.download.create({
          data: {
            id: intentId,
            title,
            url: prepared.url,
            category: "sonarr",
            status: "queued",
            progress: 0,
            mediaExpectations: serialized,
          },
        });
      },
      { maxWait: 3000, timeout: 5000 }
    );
  } catch {
    // A competing confirm or lost commit acknowledgement is reconciled, never retried.
    const receipt = await prisma.config.findUnique({ where: { key: receiptKey(fingerprint) } });
    if (!receipt) throw new TvSourceReviewError();
    return readReceipt(receipt.value, fingerprint, selector, false);
  }
  const result = await readReceipt(
    JSON.stringify({ id: intentId, fingerprint, expectations: serialized }),
    fingerprint,
    selector,
    false
  );
  return result;
}

async function readReceipt(
  value: string,
  fingerprint: string,
  selector: TvReviewSelector,
  allowRemoved = true
) {
  const receipt = receiptSchema.parse(JSON.parse(value));
  const expected = parseMediaExpectations(receipt.expectations);
  if (
    receipt.fingerprint !== fingerprint ||
    expected.version !== 4 ||
    expected.approval.jobId !== receipt.id ||
    expected.approval.fingerprint !== fingerprint
  )
    throw new TvSourceReviewError();
  const { tvdbId, season, episode, sourceId, rendition } = expected.approval;
  if (JSON.stringify({ tvdbId, season, episode, sourceId, rendition }) !== JSON.stringify(selector))
    throw new TvSourceReviewError();
  const job = await prisma.download.findUnique({ where: { id: receipt.id } });
  if ((!job && !allowRemoved) || (job && job.mediaExpectations !== receipt.expectations))
    throw new TvSourceReviewError();
  if (job?.status === "queued") triggerDownloadProcessing();
  return { id: receipt.id, status: job?.status ?? "history_removed" };
}

export async function revalidateApprovedTvJob(
  job: { id: string; url: string },
  expectations: MediaExpectations
) {
  if (expectations.version !== 4 || expectations.approval.jobId !== job.id)
    throw new TvSourceReviewError();
  const prepared = await prepare(
    tvReviewSelectorSchema.parse({
      tvdbId: expectations.approval.tvdbId,
      season: expectations.approval.season,
      episode: expectations.approval.episode,
      sourceId: expectations.approval.sourceId,
      rendition: expectations.approval.rendition,
    })
  );
  const receipt = await prisma.config.findUnique({
    where: { key: receiptKey(expectations.approval.fingerprint) },
  });
  if (
    !receipt ||
    job.url !== prepared.url ||
    prepared.preview.fingerprint !== expectations.approval.fingerprint
  )
    throw new TvSourceReviewError();
  const stored = receiptSchema.parse(JSON.parse(receipt.value));
  if (stored.id !== job.id || stored.expectations !== JSON.stringify(expectations))
    throw new TvSourceReviewError();
}
