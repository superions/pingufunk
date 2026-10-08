import { z } from "zod";
import { fetchWithRetry, type HttpRequestBudget } from "@/lib/fetch-retry";
import { readBoundedProviderJson } from "@/lib/bounded-provider-json";
import {
  sourceInstant,
  sourceAvailabilityState,
  type SourceAvailability,
} from "@/lib/content-dates";

/** Exact indexed ARD video identity, not a series-page or arbitrary fetch target. */
export function ardVideoId(website: string): string | null {
  try {
    const url = new URL(website);
    if (
      url.protocol !== "https:" ||
      url.hostname !== "www.ardmediathek.de" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      return null;
    if (!url.pathname.startsWith("/video/")) return null;
    const id = url.pathname.split("/").filter(Boolean).at(-1)!;
    if (!/^[A-Za-z0-9_-]{16,2048}$/.test(id)) return null;
    const decoded = Buffer.from(id, "base64url").toString("utf8");
    return decoded.startsWith("crid://") && Buffer.from(decoded).toString("base64url") === id
      ? id
      : null;
  } catch {
    return null;
  }
}

const mediaSchema = z.object({
  url: z.string().max(16_384),
  mimeType: z.string(),
  audios: z.array(z.object({ languageCode: z.string().max(35), kind: z.string().max(64) })).max(16),
  maxHResolutionPx: z.unknown().optional(),
  maxVResolutionPx: z.unknown().optional(),
});
type ArdMedia = z.infer<typeof mediaSchema> & { originalLanguage: string | null };
const widgetSchema = z.object({
  id: z.string().max(2048),
  type: z.literal("player_ondemand"),
  blockedByLoginOnly: z.boolean(),
  blockedByFsk: z.boolean(),
  geoblocked: z.boolean(),
  availableTo: z.string().optional(),
  mediaCollection: z.object({
    embedded: z.object({
      meta: z.object({ ovLanguageCode: z.string().max(35).optional() }),
      streams: z
        .array(
          z.object({ kind: z.string().max(64).optional(), media: z.array(mediaSchema).max(200) })
        )
        .max(16),
    }),
  }),
});

export interface ArdSource {
  media: ArdMedia[];
  availability: SourceAvailability;
}

/** Keep explicit expiry with its exact asset declarations even when no release is eligible. */
export async function getArdSource(
  id: string,
  budget: HttpRequestBudget,
  signal?: AbortSignal
): Promise<ArdSource | null> {
  if (ardVideoId(`https://www.ardmediathek.de/video/${id}`) !== id)
    throw new Error("Invalid source identity");
  const response = await fetchWithRetry(
    `https://api.ardmediathek.de/page-gateway/pages/ard/item/${id}?embedded=true`,
    { headers: { Accept: "application/json" }, ...(signal ? { signal } : {}) },
    { requestBudget: budget, maxRetries: 0 }
  );
  if (response.status === 404 || response.status === 410) {
    void response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.ok) {
    void response.body?.cancel().catch(() => {});
    throw new Error("Source evidence unavailable");
  }
  try {
    const page = z
      .object({ widgets: z.array(z.unknown()).max(32) })
      .parse(await readBoundedProviderJson(response, budget.deadlineAt, 1024 * 1024, signal));
    const players = page.widgets.filter(
      (widget) =>
        widget && typeof widget === "object" && Reflect.get(widget, "type") === "player_ondemand"
    );
    if (players.length !== 1) return null;
    const player = widgetSchema.parse(players[0]);
    // Page IDs can differ; the player widget's identity must equal the requested video.
    if (player.id !== id || player.blockedByLoginOnly || player.blockedByFsk || player.geoblocked)
      return null;
    const until = sourceInstant(player.availableTo);
    if (player.availableTo !== undefined && until === null)
      throw new Error("Invalid source validity");
    const originalLanguage = language(player.mediaCollection.embedded.meta.ovLanguageCode);
    const media = player.mediaCollection.embedded.streams
      // Unrecognized auxiliary/sign-language streams need their own edition
      // contract; they must not silently become ordinary German releases.
      .filter((stream) => stream.kind === "main")
      .flatMap((stream) => stream.media)
      .map((media) => ({ ...media, originalLanguage }));
    return {
      media,
      availability:
        until === null || !media.length
          ? { state: "unknown" }
          : {
              state: "declared_rights",
              provenance: "ard_player",
              checkedAt: Date.now() / 1000,
              beginsAt: null,
              endsAt: until,
              urls: [...new Set(media.map((entry) => entry.url))],
            },
    };
  } catch {
    throw new Error("Source evidence unavailable");
  }
}

/** Fresh worker verification cannot use an explicitly expired declaration. */
export async function getArdMedia(
  id: string,
  budget: HttpRequestBudget,
  signal?: AbortSignal
): Promise<ArdMedia[]> {
  const source = await getArdSource(id, budget, signal);
  return (
    source?.media.filter((entry) =>
      ["unknown", "rights_current"].includes(
        sourceAvailabilityState(source.availability, entry.url)
      )
    ) ?? []
  );
}

function language(value: string | undefined): string | null {
  if (!value || !/^[a-z]{2,3}$/.test(value) || ["und", "mul", "zxx"].includes(value)) return null;
  try {
    return new Intl.Locale(value).language;
  } catch {
    return null;
  }
}

/** All declarations for this exact URL must agree; a playlist is not an MP4 audio proof. */
export function ardEdition(media: ArdMedia[], url: string) {
  const matches = media.filter((entry) => entry.url === url);
  if (
    !matches.length ||
    matches.some((entry) => entry.mimeType !== "video/mp4" || !entry.audios.length)
  )
    return null;
  const declarations = matches.flatMap((entry) =>
    entry.audios.map((audio) => ({
      language: language(audio.languageCode),
      kind: audio.kind,
      originalLanguage: entry.originalLanguage,
    }))
  );
  if (
    declarations.some(
      (entry) =>
        !entry.language ||
        !["standard", "audio-description", "speech-optimized"].includes(entry.kind) ||
        JSON.stringify(entry) !== JSON.stringify(declarations[0])
    )
  )
    return null;
  const first = declarations[0];
  return {
    audioLanguage: first.language!,
    originalVersion:
      first.originalLanguage === null ? undefined : first.originalLanguage === first.language,
    audioDescription: first.kind === "audio-description",
    clearSpeech: first.kind === "speech-optimized",
  };
}
