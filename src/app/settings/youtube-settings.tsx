"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SettingsResponseOrder } from "@/lib/settings-response-order";
import {
  confirmedYoutubeSave,
  youtubeSnapshotSchema,
  youtubeInspectionSchema,
  youtubePageSchema,
  youtubeRegistrySchema,
  youtubeMappingKey,
  type YoutubeSnapshot,
  type YoutubeRegistry,
  type YoutubeMapping,
  type YoutubeSave,
} from "@/lib/youtube-catalogue";

class CatalogueRequestError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
async function requestCatalogue(body?: unknown) {
  const response = await fetch(
    "/api/youtube/catalogue",
    body === undefined
      ? { cache: "no-store", signal: AbortSignal.timeout(10000) }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Pingufunk-Catalogue": "1" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(35000),
        }
  );
  const value = await response.json();
  if (!response.ok)
    throw new CatalogueRequestError(
      response.status,
      typeof value.error === "string" ? value.error : "Katalogantwort unbestätigt."
    );
  return value;
}

export function YoutubeSettings() {
  const order = useRef(new SettingsResponseOrder());
  const busyRef = useRef(false);
  const sourceInput = useRef<HTMLInputElement>(null);
  const lastIndex = useRef<number | null>(null);
  const [snapshot, setSnapshot] = useState<YoutubeSnapshot | null>(null);
  const [registry, setRegistry] = useState<YoutubeRegistry | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locked, setLocked] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; message: string } | null>(null);
  const [url, setUrl] = useState("");
  const [pending, setPending] = useState<YoutubeMapping | null>(null);
  const [page, setPage] = useState(0);
  const [inventory, setInventory] = useState<ReturnType<typeof youtubePageSchema.parse> | null>(
    null
  );
  const load = useCallback(async (reset: boolean) => {
    const token = order.current.beginRead();
    try {
      const value = youtubeSnapshotSchema.parse(await requestCatalogue());
      if (!order.current.isCurrent(token)) return;
      if (lastIndex.current !== value.lastCompleteAt) {
        setPage(0);
        lastIndex.current = value.lastCompleteAt;
      }
      setSnapshot(value);
      if (reset) {
        setRegistry(structuredClone(value.registry));
        setEnabled(value.enabled);
        setLocked(false);
        setPending(null);
        setFeedback(null);
      }
    } catch {
      if (order.current.isCurrent(token))
        setFeedback({
          error: true,
          message:
            "Katalog nicht bestätigt. Gespeicherten Stand neu laden; Eingaben bleiben erhalten.",
        });
    }
  }, []);
  useEffect(() => {
    void load(true);
  }, [load]);
  useEffect(() => {
    if (snapshot?.scan.state !== "running") return;
    const timer = setTimeout(() => void load(false), 1000);
    return () => clearTimeout(timer);
  }, [snapshot, load]);
  const completedAt = snapshot?.lastCompleteAt;
  useEffect(() => {
    if (!completedAt) {
      setInventory(null);
      return;
    }
    const controller = new AbortController();
    void fetch(`/api/youtube/catalogue?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error();
        return youtubePageSchema.parse(await response.json());
      })
      .then((value) => {
        if (!controller.signal.aborted) setInventory(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setInventory(null);
          setFeedback({ error: true, message: "Inventarseite unbestätigt. Erneut laden." });
        }
      });
    return () => controller.abort();
  }, [page, completedAt]);

  const dirty =
    !!snapshot &&
    !!registry &&
    (enabled !== snapshot.enabled ||
      JSON.stringify(registry) !== JSON.stringify(snapshot.registry));
  const valid = !!registry && youtubeRegistrySchema.safeParse(registry).success;
  const coolingDown = !!snapshot?.nextRefreshAt && snapshot.nextRefreshAt > Date.now();
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setFeedback(null);
    try {
      await operation();
    } catch (error) {
      setFeedback({
        error: true,
        message: error instanceof Error ? error.message : "Aktion unbestätigt. Neu laden.",
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const save = () =>
    run(async () => {
      if (!snapshot || !registry || locked || !valid) return;
      const submitted: YoutubeSave = {
        action: "save",
        revision: snapshot.revision,
        enabled,
        registry,
      };
      try {
        await order.current.enqueueWrite(async () => {
          const confirmed = confirmedYoutubeSave(await requestCatalogue(submitted), submitted);
          setSnapshot(confirmed);
          setRegistry(structuredClone(confirmed.registry));
          setEnabled(confirmed.enabled);
        });
        setFeedback({
          error: false,
          message: "YouTube-Register gespeichert und aus der Datenbank bestätigt.",
        });
      } catch (error) {
        if (!(error instanceof CatalogueRequestError) || ![400, 403].includes(error.status))
          setLocked(true);
        throw error;
      }
    });
  const inspect = () =>
    run(async () => {
      const source = youtubeInspectionSchema.parse(
        await requestCatalogue({ action: "inspect", url: url.trim() })
      );
      if (!registry) return;
      if (
        !registry.channels.some((channel) => channel.id === source.channelId) &&
        registry.channels.length >= 64
      )
        throw new Error("Das Register ist auf 64 Kanäle begrenzt.");
      if (source.kind === "channel") {
        if (registry.channels.some((channel) => channel.id === source.channelId))
          setFeedback({ error: false, message: "Dieser Kanal ist bereits im Register." });
        else
          setRegistry({
            ...registry,
            channels: [
              ...registry.channels,
              { id: source.channelId, name: source.channelName, enabled: false },
            ],
          });
        setUrl("");
        return;
      }
      if (!registry.channels.some((channel) => channel.id === source.channelId))
        setRegistry({
          ...registry,
          channels: [
            ...registry.channels,
            { id: source.channelId, name: source.channelName, enabled: false },
          ],
        });
      const existing = registry.programMappings.find(
        (mapping) =>
          mapping.sourceId === source.sourceId &&
          mapping.kind === source.kind &&
          mapping.channelId === source.channelId
      );
      setPending(
        existing ?? {
          kind: source.kind,
          sourceId: source.sourceId,
          channelId: source.channelId,
          name: source.name,
          targetId: 0,
          enabled: false,
        }
      );
    });
  const addMapping = () => {
    if (!registry || !pending) return;
    const programMappings = [
      ...registry.programMappings.filter(
        (mapping) => youtubeMappingKey(mapping) !== youtubeMappingKey(pending)
      ),
      pending,
    ];
    if (programMappings.length > 256) {
      setFeedback({
        error: true,
        message: "Das Register ist auf 256 Programmzuordnungen begrenzt.",
      });
      return;
    }
    const parsed = youtubeRegistrySchema.safeParse({
      ...registry,
      programMappings,
    });
    if (!parsed.success) {
      setFeedback({
        error: true,
        message: "Eine gültige positive TVDB-/TMDB-ID und einen Programmnamen eingeben.",
      });
      return;
    }
    setRegistry(parsed.data);
    setPending(null);
    setUrl("");
    sourceInput.current?.focus();
    setFeedback({ error: false, message: "Zuordnung übernommen. Änderungen jetzt speichern." });
  };
  const updateMapping = (index: number, change: Partial<YoutubeMapping>) => {
    if (registry)
      setRegistry({
        ...registry,
        programMappings: registry.programMappings.map((mapping, i) =>
          i === index ? ({ ...mapping, ...change } as YoutubeMapping) : mapping
        ),
      });
  };
  const refresh = () =>
    run(async () => {
      if (!snapshot || dirty || locked) return;
      const result = await requestCatalogue({ action: "refresh", revision: snapshot.revision });
      if (result.success !== true) throw new Error("Scanstart nicht bestätigt. Stand neu laden.");
      await load(false);
    });
  return (
    <div className="space-y-4 [&_button[aria-disabled=true]]:opacity-50 [&_button[aria-disabled=true]]:cursor-not-allowed">
      <Card>
        <CardHeader>
          <CardTitle>YouTube-Quellen</CardTitle>
          <CardDescription>
            Kanäle und Serien-/Filmzuordnungen getrennt pflegen. Alle Vorgaben sind zunächst aus.
            Der Scan liest ausschließlich Metadaten ein.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="outline"
              aria-disabled={busy}
              onClick={() => {
                if (!busy) void load(true);
              }}
            >
              YouTube-Stand neu laden
            </Button>
            <Button
              aria-disabled={busy || locked || !valid || !dirty}
              onClick={() => {
                if (!busy && !locked && valid && dirty) void save();
              }}
            >
              {busy ? "Bitte warten …" : "YouTube-Register speichern"}
            </Button>
          </div>
          {feedback && (
            <p
              role={feedback.error ? "alert" : "status"}
              className={
                feedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
              }
            >
              {feedback.message}
            </p>
          )}
          {locked && (
            <p className="text-sm">
              Vor erneutem Speichern neu laden. Das übernimmt den gespeicherten Stand und ersetzt
              die lokalen Eingaben.
            </p>
          )}
          {registry && !valid && (
            <p role="alert" className="text-sm text-destructive">
              Ungültiger Eintrag: Name, eindeutige Quelle, zugehörigen Kanal und positive
              TVDB-/TMDB-ID prüfen.
            </p>
          )}
          {!registry ? (
            <p role="status">
              {feedback ? "Kein bestätigtes Register geladen." : "Kanalregister wird geladen …"}
            </p>
          ) : (
            <>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  checked={enabled}
                  disabled={busy}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
                YouTube-Metadatenkatalog aktivieren
              </label>
              <div className="space-y-2">
                <label htmlFor="youtube-source-url" className="text-sm font-medium">
                  Kanal, Playlist oder Video prüfen
                </label>
                <div className="flex gap-2">
                  <Input
                    id="youtube-source-url"
                    ref={sourceInput}
                    value={url}
                    readOnly={busy}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://www.youtube.com/@Kanal"
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && url.trim()) void inspect();
                    }}
                  />
                  <Button
                    variant="outline"
                    aria-disabled={busy || !url.trim()}
                    onClick={() => {
                      if (url.trim()) void inspect();
                    }}
                  >
                    URL prüfen
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Die Prüfung liest YouTube-Metadaten. Speichern allein startet keinen Abruf. Kanäle
                  anschließend ausdrücklich aktivieren.
                </p>
              </div>
              {pending && (
                <fieldset disabled={busy} className="space-y-3 rounded-md border p-4">
                  <legend className="px-1 text-sm font-medium">
                    {pending.kind === "series" ? "Serie aus Playlist" : "Film aus Video"} zuordnen
                  </legend>
                  <label className="block text-sm">
                    Programmname
                    <Input
                      value={pending.name}
                      onChange={(event) => setPending({ ...pending, name: event.target.value })}
                    />
                  </label>
                  <label className="block text-sm">
                    {pending.kind === "series" ? "TVDB-ID" : "TMDB-ID"}
                    <Input
                      type="number"
                      min="1"
                      step="1"
                      value={pending.targetId || ""}
                      onChange={(event) =>
                        setPending({ ...pending, targetId: Number(event.target.value) })
                      }
                    />
                  </label>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {pending.sourceId}
                  </p>
                  <div className="flex gap-2">
                    <Button onClick={addMapping}>Zuordnung übernehmen</Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setPending(null);
                        sourceInput.current?.focus();
                      }}
                    >
                      Verwerfen
                    </Button>
                  </div>
                </fieldset>
              )}
            </>
          )}
        </CardContent>
      </Card>
      {registry && snapshot && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Kanäle</CardTitle>
              <CardDescription>
                {registry.channels.length} von 64 Kanälen. Die Kanal-ID bleibt die Identität.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <fieldset disabled={busy} className="space-y-3">
                {registry.channels.map((channel, index) => (
                  <div key={channel.id} className="space-y-2 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={channel.enabled}
                          onChange={(event) =>
                            setRegistry({
                              ...registry,
                              channels: registry.channels.map((row, i) =>
                                i === index ? { ...row, enabled: event.target.checked } : row
                              ),
                            })
                          }
                        />
                        {channel.name} aktiv
                      </label>
                      {snapshot.presetChannelIds.includes(channel.id) && (
                        <Badge variant="secondary">Vorgabe</Badge>
                      )}
                    </div>
                    <Input
                      aria-label={`Kanalname ${channel.id}`}
                      value={channel.name}
                      onChange={(event) =>
                        setRegistry({
                          ...registry,
                          channels: registry.channels.map((row, i) =>
                            i === index ? { ...row, name: event.target.value } : row
                          ),
                        })
                      }
                    />
                    <a
                      className="break-all text-xs text-muted-foreground underline"
                      target="_blank"
                      rel="noreferrer"
                      href={`https://www.youtube.com/channel/${channel.id}`}
                    >
                      {channel.id}
                    </a>
                    {!snapshot.presetChannelIds.includes(channel.id) && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          if (
                            registry.programMappings.some(
                              (mapping) => mapping.channelId === channel.id
                            )
                          ) {
                            setFeedback({
                              error: true,
                              message: "Zuerst die Programmzuordnungen dieses Kanals entfernen.",
                            });
                            return;
                          }
                          setRegistry({
                            ...registry,
                            channels: registry.channels.filter((row) => row.id !== channel.id),
                          });
                        }}
                      >
                        Kanal entfernen
                      </Button>
                    )}
                  </div>
                ))}
              </fieldset>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Programmzuordnungen</CardTitle>
              <CardDescription>
                Playlist → Serie (TVDB), einzelnes Video → Film (TMDB). Eine Programmbindung
                bestätigt noch keine einzelne Episode.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <fieldset disabled={busy} className="space-y-3">
                {registry.programMappings.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    Noch keine Programmzuordnung. Oben eine Playlist oder ein Video prüfen.
                  </p>
                )}
                {registry.programMappings.map((mapping, index) => (
                  <div key={youtubeMappingKey(mapping)} className="space-y-3 rounded-md border p-3">
                    <div className="flex items-center justify-between gap-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={mapping.enabled}
                          onChange={(event) =>
                            updateMapping(index, { enabled: event.target.checked })
                          }
                        />
                        {mapping.name} als {mapping.kind === "series" ? "Serie" : "Film"} aktiv
                      </label>
                      {snapshot.presetMappingKeys.includes(youtubeMappingKey(mapping)) && (
                        <Badge variant="secondary">Vorgabe</Badge>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-sm">
                        Programmname
                        <Input
                          value={mapping.name}
                          onChange={(event) => updateMapping(index, { name: event.target.value })}
                        />
                      </label>
                      <label className="text-sm">
                        {mapping.kind === "series" ? "TVDB-ID" : "TMDB-ID"}
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          value={mapping.targetId || ""}
                          onChange={(event) =>
                            updateMapping(index, { targetId: Number(event.target.value) })
                          }
                        />
                      </label>
                    </div>
                    <p className="text-sm">
                      Uploader-Kanal:{" "}
                      {registry.channels.find((channel) => channel.id === mapping.channelId)?.name}
                    </p>
                    <p className="break-all text-xs text-muted-foreground">
                      {mapping.kind === "series" ? "Playlist" : "Video"}: {mapping.sourceId}
                    </p>
                    {!snapshot.presetMappingKeys.includes(youtubeMappingKey(mapping)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setRegistry({
                            ...registry,
                            programMappings: registry.programMappings.filter((_, i) => i !== index),
                          })
                        }
                      >
                        Zuordnung entfernen
                      </Button>
                    )}
                  </div>
                ))}
              </fieldset>
              <div className="mt-4 space-y-2">
                <Button
                  aria-disabled={busy || locked || !valid || !dirty}
                  onClick={() => {
                    if (!busy && !locked && valid && dirty) void save();
                  }}
                >
                  YouTube-Register speichern
                </Button>
                {feedback && (
                  <p
                    className={
                      feedback.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"
                    }
                  >
                    {feedback.message}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Metadateninventar</CardTitle>
              <CardDescription>
                Ausdrücklicher Scan, höchstens 1.000 Videos pro Playlist. Frühestens alle sechs
                Stunden. Der letzte vollständige Index bleibt bei Fehlern erhalten.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <Button
                  aria-disabled={
                    busy ||
                    dirty ||
                    locked ||
                    !enabled ||
                    coolingDown ||
                    snapshot.scan.state === "running"
                  }
                  onClick={() => {
                    if (
                      !busy &&
                      !dirty &&
                      !locked &&
                      enabled &&
                      !coolingDown &&
                      snapshot.scan.state !== "running"
                    )
                      void refresh();
                  }}
                >
                  Metadaten einlesen
                </Button>
                <Button
                  variant="outline"
                  aria-disabled={busy || snapshot.scan.state !== "running"}
                  onClick={() => {
                    if (!busy && snapshot.scan.state === "running")
                      void run(async () => {
                        await requestCatalogue({ action: "cancel" });
                        await load(false);
                      });
                  }}
                >
                  Scan abbrechen
                </Button>
              </div>
              {dirty && (
                <p className="text-sm text-muted-foreground">
                  Vor einem Scan Änderungen speichern.
                </p>
              )}
              {coolingDown && snapshot.nextRefreshAt && (
                <p className="text-sm text-muted-foreground">
                  Nächster Scan ab {new Date(snapshot.nextRefreshAt).toLocaleString("de-DE")}.
                </p>
              )}
              <p role="status" className="text-sm">
                {snapshot.scan.message} {snapshot.scan.completedMappings} Zuordnungen ·{" "}
                {snapshot.scan.batches} Batches · {snapshot.scan.entries} Einträge
              </p>
              {snapshot.lastCompleteAt && (
                <p className="text-xs text-muted-foreground">
                  Letzter vollständiger Scan:{" "}
                  {new Date(snapshot.lastCompleteAt).toLocaleString("de-DE")}.{" "}
                  {snapshot.indexCurrent
                    ? "Passend zur gespeicherten Zuordnung."
                    : "Voriger Zuordnungsstand."}{" "}
                  Kein aktueller Verfügbarkeits- oder Mediennachweis.
                </p>
              )}
              {inventory && (
                <>
                  <ul className="divide-y text-sm">
                    {inventory.items.map((row, i) => (
                      <li key={`${row.mappingKey}/${row.videoId ?? i}`} className="py-2">
                        {row.content?.title ?? "Nicht verfügbarer Playlist-Eintrag"}
                        <span className="block text-xs text-muted-foreground">
                          {row.availability === "listed"
                            ? "Im Katalog gelistet; Episode und Medien noch ungeprüft"
                            : "Privat, gelöscht oder nicht verfügbar; ohne erfundene Episodenbindung"}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex items-center gap-3">
                    <Button
                      size="sm"
                      variant="outline"
                      aria-disabled={page === 0}
                      onClick={() => {
                        if (page > 0) setPage(page - 1);
                      }}
                    >
                      Vorige Seite
                    </Button>
                    <span className="text-xs">
                      Seite {page + 1} · {inventory.count} Einträge
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      aria-disabled={(page + 1) * 100 >= inventory.count}
                      onClick={() => {
                        if ((page + 1) * 100 < inventory.count) setPage(page + 1);
                      }}
                    >
                      Nächste Seite
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
