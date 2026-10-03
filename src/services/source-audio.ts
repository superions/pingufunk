import { createHash } from "node:crypto";
import { z } from "zod";
import type { ApiResultItem } from "@/types";
import type { SourceAudioEvidence } from "@/lib/media-expectations";
import { fetchWithRetry, type HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { isProbeableMp4, probeMp4AudioLanguage } from "@/lib/mp4-audio-language";
import { arteVideoId, parseArteVersion, progressiveUrl } from "./arte-editions";
import { classifyLanguageEdition, stableUrlIdentity } from "./language-editions";

const streamsSchema = z.object({
  videoStreams: z
    .array(
      z.object({
        programId: z.string().max(100),
        url: z.string().max(16_384),
        audioCode: z.string().max(100),
      })
    )
    .max(200),
});
type ArteStreams = z.infer<typeof streamsSchema>["videoStreams"];

export function mediaSourceIdentity(url: string): string {
  return createHash("sha256").update(stableUrlIdentity(url)).digest("hex");
}

async function getArteStreams(videoId: string, budget: HttpRequestBudget): Promise<ArteStreams> {
  if (!/^\d{6}-\d{3}-[AF]$/.test(videoId)) throw new Error("Invalid source identity");
  const response = await fetchWithRetry(
    `https://www.arte.tv/hbbtvv2/services/web/index.php/OPA/v3/streams/${videoId}/SHOW/de`,
    { headers: { Accept: "application/json" } },
    { requestBudget: budget, maxRetries: 0 }
  );
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    return [];
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Source evidence unavailable");
  }
  try {
    return streamsSchema.parse(
      await readBoundedProviderJson(response, budget.deadlineAt, 1024 * 1024)
    ).videoStreams;
  } catch {
    throw new Error("Source evidence unavailable");
  }
}

function arteEdition(streams: ArteStreams, videoId: string, url: string) {
  if (!progressiveUrl(url)) return null;
  // The crawler upgrades the API's HTTP spelling to HTTPS. Nothing else is
  // rewritten: same program, exact path and every selector/signature must match.
  const matches = streams.filter(
    (stream) => stream.programId === videoId && stream.url.replace(/^http:/, "https:") === url
  );
  const editions = matches.map((stream) => parseArteVersion(stream.audioCode));
  if (
    !editions.length ||
    editions.some(
      (edition) =>
        !edition?.audioLanguage || JSON.stringify(edition) !== JSON.stringify(editions[0])
    )
  )
    return null;
  return editions[0];
}

/** Worker revalidation binds the persisted promise to the URL actually downloaded. */
export async function verifyArteSourceAudio(
  expected: SourceAudioEvidence,
  url: string,
  budget: HttpRequestBudget
): Promise<SourceAudioEvidence> {
  if (!progressiveUrl(url) || mediaSourceIdentity(url) !== expected.mediaIdentity)
    throw new Error("Source evidence mismatch");
  const edition = arteEdition(
    await getArteStreams(expected.videoId, budget),
    expected.videoId,
    url
  );
  if (!edition || edition.audioLanguage !== expected.language)
    throw new Error("Source evidence mismatch");
  return expected;
}

/**
 * Enrich only indexed progressive renditions, never discover arbitrary media or
 * infer the requested language. Each split row owns exactly one concrete URL.
 * Four identities and the caller's remaining ten-attempt/15-second budget bound
 * this optional evidence window; unprobed renditions remain honestly unknown.
 */
export async function enrichSourceAudio(
  items: ApiResultItem[],
  budget: HttpRequestBudget
): Promise<Map<ApiResultItem, ApiResultItem[]>> {
  const arte = new Map<string, ArteStreams>();
  const mp4 = new Map<string, string | null>();
  const output = new Map<ApiResultItem, ApiResultItem[]>();
  let probes = 0;
  const ordered = [...items].sort(
    (a, b) => a.url_website.localeCompare(b.url_website) || a.url_video.localeCompare(b.url_video)
  );
  for (const item of ordered) {
    if (output.has(item)) continue;
    const renditions: ApiResultItem[] = [];
    output.set(item, renditions);
    const videoId = arteVideoId(item.url_website);
    const fields = ["url_video", "url_video_hd", "url_video_low"] as const;
    if (
      !fields.some(
        (field) =>
          item[field] && ((videoId && progressiveUrl(item[field])) || isProbeableMp4(item[field]))
      )
    ) {
      renditions.push(item);
      continue;
    }
    for (const field of fields) {
      const url = item[field];
      if (!url) continue;
      const split: ApiResultItem = {
        ...item,
        url_video: "",
        url_video_hd: "",
        url_video_low: "",
        [field]: url,
      };
      let edition: ReturnType<typeof parseArteVersion> = null;
      let language: string | null = null;
      if (videoId && progressiveUrl(url)) {
        if (!arte.has(videoId) && probes < 4 && budget.remainingAttempts > 0) {
          probes++;
          arte.set(videoId, await getArteStreams(videoId, budget));
        }
        edition = arteEdition(arte.get(videoId) ?? [], videoId, url);
        language = edition?.audioLanguage ?? null;
        if (language)
          split.sourceAudioEvidence = {
            provider: "arte_hbbtv",
            videoId,
            mediaIdentity: mediaSourceIdentity(url),
            language,
          };
      } else if (isProbeableMp4(url)) {
        if (!mp4.has(url) && probes < 4 && budget.remainingAttempts >= 2) {
          probes++;
          mp4.set(url, await probeMp4AudioLanguage(url, budget));
        }
        language = mp4.get(url) ?? null;
      }
      if (language) {
        split.releaseVariantKey =
          item.releaseVariantKey ?? classifyLanguageEdition(item).variantKey;
        split.audioLanguage = language;
        if (edition) Object.assign(split, edition);
      }
      renditions.push(split);
    }
  }
  if (Date.now() >= budget.deadlineAt) throw new Error("Source evidence unavailable");
  return output;
}
