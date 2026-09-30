import { z } from "zod";
import { fetchWithRetry, HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import { hasSharedTopicSeriesEvidence, isSharedSeriesTopic } from "./ruleset-identity";
import { stableUrlIdentity } from "./language-editions";
import type { ApiResultItem, TvdbData } from "@/types";
import { queryMediathekView, MEDIATHEK_VIEW_MAX_PAGE_SIZE } from "@/lib/mediathek-client";

const videoIdPattern = /^\d{6}-\d{3}-[AF]$/;

/** A website locale is a lookup locale only, never audio evidence. */
export function arteVideoId(website: string): string | null {
  try {
    const url = new URL(website);
    if (
      url.protocol !== "https:" ||
      !["arte.tv", "www.arte.tv"].includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password
    )
      return null;
    const id = url.pathname.match(/^\/(?:de|fr|en|es|it|pl)\/videos\/([^/]+)(?:\/|$)/)?.[1];
    return id && videoIdPattern.test(id) ? id : null;
  } catch {
    return null;
  }
}

const playerSchema = z.object({
  data: z.object({
    attributes: z.object({
      live: z.boolean().optional(),
      restriction: z
        .object({
          geoblocking: z
            .object({
              restrictedArea: z.boolean().optional(),
            })
            .optional(),
        })
        .optional(),
      rights: z.object({ begin: z.string().optional(), end: z.string().optional() }),
      metadata: z.object({
        providerId: z.string(),
        title: z.string(),
        subtitle: z.string().optional(),
        link: z.object({ url: z.string() }),
        duration: z.object({ seconds: z.number().positive().finite() }),
      }),
      streams: z
        .array(
          z.object({
            protocol: z.string(),
            url: z.string(),
            versions: z
              .array(z.object({ eStat: z.object({ ml5: z.string() }) }))
              .min(1)
              .max(8),
          })
        )
        .max(200),
    }),
  }),
});

/** Fully anchored codes: an unknown suffix must not manufacture a German track. */
export function parseArteVersion(code: string) {
  const match =
    /^V(O?)(A|F|E\[(?:ANG|ESP|ITA|POL)\]|EU)?(AUD)?(?:-ST(M?)(A|F|E\[(?:ANG|ESP|ITA|POL)\]|EU))?$/.exec(
      code
    );
  if (!match) return null;
  const language = (value: string | undefined) => {
    const languages: Record<string, string> = {
      A: "de",
      F: "fr",
      "E[ANG]": "en",
      "E[ESP]": "es",
      "E[ITA]": "it",
      "E[POL]": "pl",
      EU: "mul",
    };
    return value ? (languages[value] ?? null) : null;
  };
  return {
    audioLanguage: language(match[2]),
    originalVersion: match[1] === "O",
    audioDescription: match[3] === "AUD",
    subtitleLanguage: language(match[5]),
  };
}

function progressiveUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    // Only existing ARTE/CDN progressive contracts; no new arbitrary fetch owner
    // or HLS publication is introduced before the media-validation gate.
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      (url.hostname.endsWith(".arte.tv") || url.hostname.endsWith(".akamaized.net")) &&
      /\.mp4$/i.test(url.pathname)
    );
  } catch {
    return false;
  }
}

function coordinates(title: string): string | null {
  const numbered =
    /\bS(\d{1,3})\s*E(\d{1,4})\b/i.exec(title) ??
    /\bStaffel\s+(\d{1,3})\s*[,/:–-]?\s*(?:Folge|Episode)\s+(\d{1,4})\b/i.exec(title);
  if (numbered) return `season:${Number(numbered[1])}:episode:${Number(numbered[2])}`;
  const part = /\((\d{1,4})\s*\/\s*(\d{1,4})\)/.exec(title);
  if (part && Number(part[1]) > 0 && Number(part[1]) <= Number(part[2]))
    return `part:${Number(part[1])}:total:${Number(part[2])}`;
  return null;
}

/**
 * Resolve only already series-owned shared-topic candidates. Same provider ID
 * binds editions; the caller still owns exact episode/duration/final RSS checks.
 * No persistent cache retains signed URLs, and any transport/schema failure
 * aborts this complete fallback instead of publishing partial editions.
 */
export async function resolveArteSeriesEditions(
  items: ApiResultItem[],
  show: TvdbData,
  budget: HttpRequestBudget
): Promise<ApiResultItem[] | null> {
  if (!Number.isSafeInteger(show.id) || show.id <= 0) return null;
  const groups = new Map<string, ApiResultItem[]>();
  const output: ApiResultItem[] = [];
  for (const item of items) {
    const id = arteVideoId(item.url_website);
    if (!id || !isSharedSeriesTopic(item.topic)) {
      output.push(item);
      continue;
    }
    if (!hasSharedTopicSeriesEvidence(item, show)) continue;
    groups.set(id, [...(groups.get(id) ?? []), item]);
  }
  try {
    // Sorting makes budget use and winners independent of provider row order.
    for (const [id, candidates] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
      const response = await fetchWithRetry(
        `https://api.arte.tv/api/player/v2/config/de/${id}`,
        { headers: { Accept: "application/json" } },
        { requestBudget: budget }
      );
      if (response.status === 404 || response.status === 410) {
        void response.body?.cancel().catch(() => {});
        continue;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        return null;
      }
      const {
        data: { attributes },
      } = playerSchema.parse(
        await readBoundedProviderJson(response, budget.deadlineAt, 1024 * 1024)
      );
      const { metadata, rights } = attributes;
      if (metadata.providerId !== id || arteVideoId(metadata.link.url) !== id) return null;
      if (attributes.live || attributes.restriction?.geoblocking?.restrictedArea) continue;
      if (!Object.keys(rights).length) continue;
      const now = Date.now();
      if (
        [rights.begin, rights.end].some(
          (value) => value !== undefined && !Number.isFinite(Date.parse(value))
        )
      )
        return null;
      if (
        (rights.begin && Date.parse(rights.begin) > now) ||
        (rights.end && Date.parse(rights.end) < now)
      )
        continue;
      const metadataItem = {
        ...candidates[0],
        title: [metadata.title, metadata.subtitle].filter(Boolean).join(": "),
      };
      if (!hasSharedTopicSeriesEvidence(metadataItem, show)) continue;
      // Preserve the indexed episode coordinates, but reject disagreement among
      // rows of one source identity instead of selecting the first provider row.
      const sourceCoordinates = coordinates(candidates[0].title);
      if (!sourceCoordinates || coordinates(metadataItem.title) !== sourceCoordinates) continue;
      if (candidates.some((item) => coordinates(item.title) !== sourceCoordinates)) continue;
      const knownUrls = () =>
        new Set(
          candidates.flatMap((item) =>
            [item.url_video, item.url_video_low, item.url_video_hd]
              .filter(Boolean)
              .map(stableUrlIdentity)
          )
        );
      // The player proves audio, not MediathekView rendition quality. Website
      // URLs are not indexed for search: discover by verified German title and
      // recheck the exact video ID locally, never assign an arbitrary stream 720p.
      if (
        attributes.streams.some(
          (stream) =>
            stream.protocol === "HTTPS" &&
            parseArteVersion(stream.versions[0].eStat.ml5)?.audioLanguage === "de" &&
            progressiveUrl(stream.url) &&
            !knownUrls().has(stableUrlIdentity(stream.url))
        )
      ) {
        for (let offset = 0; offset < 5000; offset += MEDIATHEK_VIEW_MAX_PAGE_SIZE) {
          const page = await queryMediathekView(
            [{ fields: ["title"], query: metadata.title }],
            MEDIATHEK_VIEW_MAX_PAGE_SIZE,
            { offset, requestBudget: budget }
          );
          if (page === null) return null;
          candidates.push(
            ...page.filter(
              (item) =>
                arteVideoId(item.url_website) === id &&
                isSharedSeriesTopic(item.topic) &&
                hasSharedTopicSeriesEvidence(item, show) &&
                coordinates(item.title) === sourceCoordinates
            )
          );
          if (page.length < MEDIATHEK_VIEW_MAX_PAGE_SIZE) break;
        }
      }
      const source = [...candidates].sort((a, b) =>
        stableUrlIdentity(a.url_video).localeCompare(stableUrlIdentity(b.url_video))
      )[0];
      const emitted = new Set<string>();
      const interpretations = new Map<string, Set<string>>();
      for (const stream of attributes.streams) {
        const key = stableUrlIdentity(stream.url);
        const meanings = interpretations.get(key) ?? new Set<string>();
        for (const version of stream.versions)
          meanings.add(JSON.stringify(parseArteVersion(version.eStat.ml5)));
        interpretations.set(key, meanings);
      }
      for (const stream of [...attributes.streams].sort((a, b) => a.url.localeCompare(b.url))) {
        if (stream.protocol !== "HTTPS" || !progressiveUrl(stream.url)) continue;
        const editions = stream.versions.map((version) => parseArteVersion(version.eStat.ml5));
        const edition = editions[0];
        if (!edition || editions.some((value) => JSON.stringify(value) !== JSON.stringify(edition)))
          continue;
        if (!edition.audioLanguage) continue;
        const key = stableUrlIdentity(stream.url);
        if (interpretations.get(key)?.size !== 1) continue;
        const fields = ["url_video", "url_video_low", "url_video_hd"] as const;
        const slots = fields.filter((field) =>
          candidates.some((item) => item[field] && stableUrlIdentity(item[field]) === key)
        );
        if (slots.length !== 1) continue;
        if (emitted.has(key)) continue;
        emitted.add(key);
        output.push({
          ...source,
          ...edition,
          arteVerifiedVideoId: id,
          signLanguage: false,
          clearSpeech: false,
          title: metadataItem.title,
          duration: metadata.duration.seconds,
          size: 0,
          url_website: metadata.link.url,
          url_video: "",
          url_video_low: "",
          url_video_hd: "",
          [slots[0]]: stream.url,
        });
      }
    }
    return Date.now() >= budget.deadlineAt ? null : output;
  } catch {
    return null;
  }
}
