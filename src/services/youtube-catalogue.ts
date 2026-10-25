import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import seedData from "../../data/youtube-sources.json";
import { prisma } from "@/lib/db";
import { clearSettingsCache } from "@/lib/settings";
import { assertWritesEnabled, writesEnabled } from "@/lib/write-gate";
import { readYoutubeMetadata, YoutubeMetadataError } from "@/server/ytdlp";
import {
  YOUTUBE_ENABLED_KEY,
  YOUTUBE_INDEX_KEY,
  YOUTUBE_REGISTRY_KEY,
  YOUTUBE_REGISTRY_BYTES,
  YOUTUBE_INDEX_BYTES,
  YOUTUBE_REFRESH_MS,
  mergeYoutubeRegistry,
  youtubeRegistrySchema,
  youtubeInput,
  youtubeMappingKey,
  youtubeSaveSchema,
  normalizeYoutubeInspection,
  normalizeYoutubePage,
  YoutubeCatalogueDataError,
  youtubeScanSchema,
  youtubeIndexRowSchema,
  type YoutubeRegistry,
  type YoutubeSave,
  type YoutubeSnapshot,
  type YoutubeScanState,
  type YoutubeInput,
  type YoutubeIndexRow,
} from "@/lib/youtube-catalogue";

const seed = youtubeRegistrySchema.parse(seedData);
const localSchema = z
  .object({ version: z.literal(1), generation: z.uuid(), registry: youtubeRegistrySchema })
  .strict();
const pagePrefix = `${YOUTUBE_INDEX_KEY}.page.`;
const pageBytes = 1024 * 1024;
type IndexRow = YoutubeIndexRow;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const manifestSchema = z
  .object({
    version: z.literal(1),
    revision: digest,
    token: z.uuid(),
    attemptedAt: z.number().int().positive(),
    completeAt: z.number().int().positive().nullable(),
    indexRevision: digest.nullable(),
    pages: z
      .array(z.string().regex(/^internal\.youtube\.catalogue\.v1\.page\.[a-f0-9-]{36}\.\d{1,3}$/))
      .max(800),
    count: z.number().int().min(0).max(80000),
    scan: youtubeScanSchema,
  })
  .strict();
type Manifest = z.infer<typeof manifestSchema>;
type Loaded = { registry: YoutubeRegistry; revision: string; raw: string | null; enabled: boolean };
const idle = (): YoutubeScanState => ({
  state: "idle",
  completedMappings: 0,
  batches: 0,
  entries: 0,
  message: "Noch kein Metadatenscan.",
});

export class YoutubeCatalogueError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
const conflict = () =>
  new YoutubeCatalogueError(
    409,
    "Der Stand wurde geändert. Neu laden und Änderungen erneut prüfen."
  );
const invalid = () =>
  new YoutubeCatalogueError(
    503,
    "Gespeicherter YouTube-Katalog ist ungültig. Andere Quellen bleiben unabhängig."
  );

const globalState = globalThis as typeof globalThis & {
  youtubeCatalogueRuntime?: {
    controller?: AbortController;
    work?: Promise<void>;
    probe: boolean;
    probeWork?: Promise<unknown>;
    revision?: string;
    token?: string;
    scan: YoutubeScanState;
    timer?: ReturnType<typeof setInterval>;
    stopped: boolean;
  };
};
const runtime = (globalState.youtubeCatalogueRuntime ??= {
  probe: false,
  scan: idle(),
  stopped: false,
});

async function loadRegistry(): Promise<Loaded> {
  const rows = await prisma.config.findMany({
    where: { key: { in: [YOUTUBE_REGISTRY_KEY, YOUTUBE_ENABLED_KEY] } },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  const raw = values.get(YOUTUBE_REGISTRY_KEY) ?? null;
  const enable = values.get(YOUTUBE_ENABLED_KEY) ?? "false";
  try {
    if (
      !["true", "false"].includes(enable) ||
      (raw && Buffer.byteLength(raw) > YOUTUBE_REGISTRY_BYTES)
    )
      throw invalid();
    const local = raw === null ? null : localSchema.parse(JSON.parse(raw));
    return {
      raw,
      enabled: enable === "true",
      registry: mergeYoutubeRegistry(seed, local?.registry ?? null),
      revision: createHash("sha256")
        .update(JSON.stringify([seed, raw, enable]))
        .digest("hex"),
    };
  } catch {
    throw invalid();
  }
}

async function loadManifest(): Promise<{ value: Manifest | null; raw: string | null }> {
  const row = await prisma.config.findUnique({
    where: { key: YOUTUBE_INDEX_KEY },
    select: { value: true },
  });
  if (!row) return { value: null, raw: null };
  try {
    if (Buffer.byteLength(row.value) > 64 * 1024) throw invalid();
    const value = manifestSchema.parse(JSON.parse(row.value));
    if (value.pages.length !== Math.ceil(value.count / 100)) throw invalid();
    return { value, raw: row.value };
  } catch {
    throw invalid();
  }
}

export async function youtubeCatalogueSnapshot(): Promise<YoutubeSnapshot> {
  const [loaded, manifest] = await Promise.all([loadRegistry(), loadManifest()]);
  // Capture one local attempt synchronously: completion may have happened while
  // the database read was pending. Refresh its stale running manifest so status
  // and completed-index metadata describe the same committed attempt.
  const local = {
    revision: runtime.revision,
    token: runtime.token,
    scan: runtime.scan,
    active: !!(runtime.work || runtime.probe),
  };
  let persisted = manifest.value;
  if (
    local.revision === loaded.revision &&
    local.token === persisted?.token &&
    persisted?.scan.state === "running" &&
    local.scan.state !== "running"
  )
    persisted = (await loadManifest()).value;
  const sameAttempt = local.revision === loaded.revision && local.token === persisted?.token;
  const scan =
    sameAttempt && (local.active || persisted?.scan.state === "running")
      ? local.scan
      : (persisted?.scan ?? idle());
  return {
    revision: loaded.revision,
    enabled: loaded.enabled,
    registry: loaded.registry,
    presetChannelIds: seed.channels.map((channel) => channel.id),
    presetMappingKeys: seed.programMappings.map(youtubeMappingKey),
    scan:
      scan.state === "running" && !(sameAttempt && local.active)
        ? {
            ...scan,
            state: "interrupted",
            message:
              "Voriger Scan unbestätigt unterbrochen; letzter vollständiger Index bleibt erhalten.",
          }
        : scan,
    lastCompleteAt: persisted?.completeAt ?? null,
    nextRefreshAt: persisted ? persisted.attemptedAt + YOUTUBE_REFRESH_MS : null,
    indexCurrent: persisted?.indexRevision === loaded.revision,
  };
}

export async function saveYoutubeCatalogue(input: YoutubeSave): Promise<YoutubeSnapshot> {
  assertWritesEnabled();
  const submitted = youtubeSaveSchema.parse(input);
  if (Buffer.byteLength(JSON.stringify(submitted)) > YOUTUBE_REGISTRY_BYTES)
    throw new YoutubeCatalogueError(413, "Kanalregister überschreitet 1 MiB.");
  const loaded = await loadRegistry();
  if (loaded.revision !== submitted.revision) throw conflict();
  // Seed identities stay visible; users disable them instead of silently deleting a preset.
  const merged = mergeYoutubeRegistry(seed, submitted.registry);
  if (JSON.stringify(merged) !== JSON.stringify(submitted.registry))
    throw new YoutubeCatalogueError(
      400,
      "Vorgaben im Register erhalten und bei Bedarf deaktivieren."
    );
  const raw = JSON.stringify({
    version: 1,
    generation: randomUUID(),
    registry: submitted.registry,
  });
  await prisma.$prepareMutation();
  try {
    await prisma.$transaction(async (tx) => {
      if (loaded.raw === null)
        await tx.config.create({ data: { key: YOUTUBE_REGISTRY_KEY, value: raw } });
      else if (
        (
          await tx.config.updateMany({
            where: { key: YOUTUBE_REGISTRY_KEY, value: loaded.raw },
            data: { value: raw },
          })
        ).count !== 1
      )
        throw conflict();
      await tx.config.upsert({
        where: { key: YOUTUBE_ENABLED_KEY },
        create: { key: YOUTUBE_ENABLED_KEY, value: String(submitted.enabled) },
        update: { value: String(submitted.enabled) },
      });
    });
  } catch (error) {
    if (
      error instanceof YoutubeCatalogueError ||
      (error && typeof error === "object" && "code" in error && error.code === "P2002")
    )
      throw conflict();
    runtime.controller?.abort();
    clearSettingsCache();
    throw new YoutubeCatalogueError(
      500,
      "Speichern unbestätigt. Gespeicherten Stand vor erneutem Speichern neu laden."
    );
  }
  runtime.controller?.abort();
  clearSettingsCache();
  // Independent database readback; a lost acknowledgement is never retried automatically.
  const confirmed = await youtubeCatalogueSnapshot();
  if (
    confirmed.enabled !== submitted.enabled ||
    JSON.stringify(confirmed.registry) !== JSON.stringify(submitted.registry)
  )
    throw conflict();
  return confirmed;
}

export async function inspectYoutubeSource(value: string) {
  let input: YoutubeInput;
  try {
    input = youtubeInput(value);
  } catch {
    throw new YoutubeCatalogueError(
      400,
      "Eine gültige YouTube-Kanal-, Playlist- oder Video-Adresse eingeben."
    );
  }
  if (runtime.work || runtime.probe || runtime.stopped)
    throw new YoutubeCatalogueError(409, "Ein Metadatenabruf läuft bereits.");
  runtime.probe = true;
  const controller = new AbortController();
  runtime.controller = controller;
  try {
    runtime.probeWork = readYoutubeMetadata(input, 0, controller.signal);
    return normalizeYoutubeInspection(await runtime.probeWork, input);
  } finally {
    runtime.probe = false;
    runtime.probeWork = undefined;
    if (runtime.controller === controller) runtime.controller = undefined;
  }
}

async function scan(
  loaded: Loaded,
  reservation: Manifest,
  reservedRaw: string,
  controller: AbortController
): Promise<void> {
  const rows: IndexRow[] = [];
  // Reserve the bounded manifest overhead; every page stays small for GUI reads.
  let bytes = 64 * 1024;
  const firstSeen = new Map<string, number>();
  try {
    for (const key of reservation.pages) {
      const page = await readIndexPage(key);
      for (const row of page)
        if (row.videoId && row.content)
          firstSeen.set(
            row.videoId,
            Math.min(firstSeen.get(row.videoId) ?? Infinity, row.content.filmlisteTimestamp)
          );
    }
    const mappings = loaded.registry.programMappings.filter(
      (mapping) =>
        mapping.enabled &&
        loaded.registry.channels.some(
          (channel) => channel.id === mapping.channelId && channel.enabled
        )
    );
    for (const mapping of mappings) {
      const seen = new Set<string>();
      for (let batch = 0; batch < 10; batch++) {
        controller.signal.throwIfAborted();
        if (!writesEnabled() || (await loadRegistry()).revision !== loaded.revision)
          throw conflict();
        const input: YoutubeInput = youtubeInput(mapping.sourceId);
        const page = normalizeYoutubePage(
          await readYoutubeMetadata(input, batch * 100, controller.signal),
          mapping,
          loaded.registry.channels.find((channel) => channel.id === mapping.channelId)!,
          Math.floor(Date.now() / 1000)
        );
        for (const row of page) {
          if (row.videoId && row.content) {
            row.content.filmlisteTimestamp =
              firstSeen.get(row.videoId) ?? row.content.filmlisteTimestamp;
            // A video's first observation also spans overlapping playlists in this scan.
            firstSeen.set(row.videoId, row.content.filmlisteTimestamp);
          }
          if (row.videoId && seen.has(row.videoId))
            throw new YoutubeCatalogueDataError("duplicate_id");
          if (row.videoId) seen.add(row.videoId);
          bytes += Buffer.byteLength(JSON.stringify(row)) + 1;
          if (bytes > YOUTUBE_INDEX_BYTES)
            throw new YoutubeCatalogueError(413, "Metadatenindex überschreitet 8 MiB.");
          rows.push(row);
        }
        runtime.scan = { ...runtime.scan, batches: runtime.scan.batches + 1, entries: rows.length };
        if (mapping.kind === "movie" || page.length < 100) break;
        if (batch === 9)
          throw new YoutubeCatalogueError(
            413,
            "Playlistfenster von 1.000 Videos erreicht; Abdeckung unvollständig."
          );
      }
      runtime.scan = { ...runtime.scan, completedMappings: runtime.scan.completedMappings + 1 };
    }
    controller.signal.throwIfAborted();
    const finished: YoutubeScanState = {
      ...runtime.scan,
      state: "complete",
      message: "Metadatenscan vollständig. Inhalte und Zuordnungen sind noch keine Medienfreigabe.",
    };
    const pageValues = Array.from({ length: Math.ceil(rows.length / 100) }, (_, i) =>
      JSON.stringify(rows.slice(i * 100, i * 100 + 100))
    );
    // UTF-8 bytes can exceed the reader's per-page budget before the total index is full.
    if (pageValues.some((value) => Buffer.byteLength(value) > pageBytes))
      throw new YoutubeCatalogueError(413, "Inventarseite überschreitet 1 MiB.");
    const pages = pageValues.map((_, i) => `${pagePrefix}${reservation.token}.${i}`);
    const completed: Manifest = {
      ...reservation,
      pages,
      count: rows.length,
      completeAt: Date.now(),
      indexRevision: loaded.revision,
      scan: finished,
    };
    await prisma.$prepareMutation();
    await prisma.$transaction(
      async (tx) => {
        controller.signal.throwIfAborted();
        // Lock the exact registry generation before publishing index pages and manifest together.
        if (
          (
            await tx.config.updateMany({
              where: { key: YOUTUBE_REGISTRY_KEY, value: loaded.raw! },
              data: { value: loaded.raw! },
            })
          ).count !== 1
        )
          throw conflict();
        if (
          (
            await tx.config.updateMany({
              where: { key: YOUTUBE_INDEX_KEY, value: reservedRaw },
              data: { value: JSON.stringify(completed) },
            })
          ).count !== 1
        )
          throw conflict();
        await tx.config.deleteMany({ where: { key: { startsWith: pagePrefix } } });
        for (let i = 0; i < pages.length; i++)
          await tx.config.create({
            data: { key: pages[i], value: pageValues[i] },
          });
      },
      { timeout: 15000 }
    );
    runtime.scan = finished;
  } catch (error) {
    runtime.scan = {
      ...runtime.scan,
      state: controller.signal.aborted
        ? "cancelled"
        : error instanceof YoutubeCatalogueError && error.status === 413
          ? "limited"
          : "failed",
      message: controller.signal.aborted
        ? "Scan beendet; kein neuer Index veröffentlicht."
        : error instanceof YoutubeCatalogueError
          ? error.message
          : error instanceof YoutubeMetadataError || error instanceof YoutubeCatalogueDataError
            ? error.message
            : "Metadatenscan fehlgeschlagen; letzter vollständiger Index bleibt erhalten.",
    };
    try {
      if (writesEnabled() && (await loadRegistry()).revision === loaded.revision)
        await prisma.config.updateMany({
          where: { key: YOUTUBE_INDEX_KEY, value: reservedRaw },
          data: { value: JSON.stringify({ ...reservation, scan: runtime.scan }) },
        });
    } catch {
      /* Uncertain status persistence never retries or publishes partial pages. */
    }
  }
}

export async function refreshYoutubeCatalogue(revision: string): Promise<void> {
  assertWritesEnabled();
  if (runtime.work || runtime.probe || runtime.stopped)
    throw new YoutubeCatalogueError(409, "Ein Metadatenabruf läuft bereits oder wird beendet.");
  const loaded = await loadRegistry();
  if (loaded.revision !== revision) throw conflict();
  if (
    !loaded.enabled ||
    !loaded.registry.programMappings.some(
      (mapping) =>
        mapping.enabled &&
        loaded.registry.channels.some(
          (channel) => channel.id === mapping.channelId && channel.enabled
        )
    )
  )
    throw new YoutubeCatalogueError(
      409,
      "Zuerst einen Kanal und eine Programmzuordnung aktivieren und speichern."
    );
  const old = await loadManifest();
  if (old.value && Date.now() - old.value.attemptedAt < YOUTUBE_REFRESH_MS)
    throw new YoutubeCatalogueError(
      409,
      "Nächster Scan frühestens sechs Stunden nach dem letzten Versuch."
    );
  // Claim synchronously before the first async database write, including competing requests.
  if (runtime.work || runtime.probe)
    throw new YoutubeCatalogueError(409, "Ein Metadatenabruf läuft bereits.");
  runtime.probe = true;
  const controller = new AbortController();
  runtime.controller = controller;
  runtime.revision = revision;
  runtime.scan = { ...idle(), state: "running", message: "Metadaten werden seriell geprüft." };
  const reservation: Manifest = {
    version: 1,
    revision,
    token: randomUUID(),
    attemptedAt: Date.now(),
    completeAt: old.value?.completeAt ?? null,
    indexRevision: old.value?.indexRevision ?? null,
    pages: old.value?.pages ?? [],
    count: old.value?.count ?? 0,
    scan: runtime.scan,
  };
  const raw = JSON.stringify(reservation);
  runtime.token = reservation.token;
  try {
    await prisma.$prepareMutation();
    await prisma.$transaction(async (tx) => {
      if (
        (
          await tx.config.updateMany({
            where: { key: YOUTUBE_REGISTRY_KEY, value: loaded.raw! },
            data: { value: loaded.raw! },
          })
        ).count !== 1
      )
        throw conflict();
      if (old.raw === null)
        await tx.config.create({ data: { key: YOUTUBE_INDEX_KEY, value: raw } });
      else if (
        (
          await tx.config.updateMany({
            where: { key: YOUTUBE_INDEX_KEY, value: old.raw },
            data: { value: raw },
          })
        ).count !== 1
      )
        throw conflict();
    });
    runtime.work = scan(loaded, reservation, raw, controller).finally(() => {
      runtime.work = undefined;
      runtime.controller = undefined;
    });
  } finally {
    runtime.probe = false;
  }
}

export async function cancelYoutubeCatalogue(): Promise<void> {
  runtime.controller?.abort();
  await Promise.allSettled([runtime.work, runtime.probeWork]);
}

async function readIndexPage(key: string): Promise<IndexRow[]> {
  const row = await prisma.config.findUnique({ where: { key }, select: { value: true } });
  if (!row || Buffer.byteLength(row.value) > pageBytes) throw invalid();
  try {
    return z.array(youtubeIndexRowSchema).max(100).parse(JSON.parse(row.value));
  } catch {
    throw invalid();
  }
}

export async function youtubeCataloguePage(page: number) {
  if (!Number.isSafeInteger(page) || page < 0 || page >= 800)
    throw new YoutubeCatalogueError(400, "Ungültige Inventarseite.");
  const loaded = await loadRegistry();
  const { value } = await loadManifest();
  if (!value || page >= value.pages.length)
    return { items: [], count: value?.count ?? 0, current: false };
  const items = await readIndexPage(value.pages[page]);
  if (items.length !== Math.min(100, value.count - page * 100)) throw invalid();
  return { items, count: value.count, current: value.indexRevision === loaded.revision };
}

/** Six-hour serial refresh; startup and health reads never trigger a scan. */
export function startYoutubeCatalogueRefresh(): void {
  if (runtime.timer) return;
  runtime.stopped = false;
  runtime.timer = setInterval(() => {
    if (!writesEnabled() || runtime.work || runtime.probe || runtime.stopped) return;
    void loadRegistry()
      .then(async (loaded) => {
        if (!loaded.enabled) return;
        const { value } = await loadManifest();
        if (!value || Date.now() - value.attemptedAt >= YOUTUBE_REFRESH_MS)
          await refreshYoutubeCatalogue(loaded.revision);
      })
      .catch(() => {});
  }, YOUTUBE_REFRESH_MS);
  runtime.timer.unref();
}
export async function stopYoutubeCatalogueRefresh(): Promise<void> {
  runtime.stopped = true;
  clearInterval(runtime.timer);
  runtime.timer = undefined;
  await cancelYoutubeCatalogue();
}
