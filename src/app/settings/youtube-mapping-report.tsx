"use client";

import { useEffect, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { youtubeReportSchema, type YoutubeReport } from "@/lib/youtube-report";

const states = {
  mapped: "Identität zugeordnet",
  missing: "Kein zugeordneter Eintrag",
  ambiguous: "Zuordnung unklar",
  unavailable: "Quelle nicht verfügbar",
};
const reportStates = {
  ready: "Bericht aus dem vollständigen Index des gespeicherten Registers.",
  metadata_unavailable:
    "Kanonische Metadaten fehlen oder sind nicht bestätigt. Aus der Programm-ID werden keine Folgen erfunden.",
  metadata_conflict:
    "Kanonische Metadaten oder Zuordnungsregeln widersprechen sich. Zuordnung prüfen.",
  source_conflict: "Quellenidentitäten sind widersprüchlich. Keine sichere Zuordnung bestätigt.",
  index_missing:
    "Noch kein vollständiger Index. Metadaten einlesen; fehlende Einträge sind noch keine Aussage über YouTube-Verfügbarkeit.",
  index_outdated:
    "Der Index gehört zu einem vorigen Registerstand. Erst neu einlesen; alte Videos werden nicht auf neue IDs umgebunden.",
};
export function YoutubeMappingReport({
  mappingKey,
  revision,
  onClose,
}: {
  mappingKey: string;
  revision: string;
  onClose: () => void;
}) {
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  return (
    <ReportPage
      key={`${mappingKey}/${revision}/${page}/${reload}`}
      mappingKey={mappingKey}
      revision={revision}
      page={page}
      onPage={setPage}
      onReload={() => setReload((value) => value + 1)}
      onClose={onClose}
    />
  );
}

function ReportPage({
  mappingKey,
  revision,
  page,
  onPage,
  onReload,
  onClose,
}: {
  mappingKey: string;
  revision: string;
  page: number;
  onPage: (page: number) => void;
  onReload: () => void;
  onClose: () => void;
}) {
  const [report, setReport] = useState<YoutubeReport | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const heading = useRef<HTMLDivElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/youtube/catalogue?mapping=${encodeURIComponent(mappingKey)}&page=${page}`, {
      cache: "no-store",
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(16000)]),
    })
      .then(async (response) => {
        if (!response.ok) throw Error("Unconfirmed mapping report");
        const value = youtubeReportSchema.parse(await response.json());
        if (value.revision !== revision || value.mappingKey !== mappingKey || value.page !== page)
          throw Error("Changed mapping report");
        if (!controller.signal.aborted) setReport(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [mappingKey, revision, page]);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle ref={heading} tabIndex={-1} role="heading" aria-level={3}>
            Zuordnungsbericht
          </CardTitle>
          <Button variant="outline" size="sm" onClick={onClose}>
            Bericht schließen
          </Button>
        </div>
        <CardDescription>
          Programm-ID, Episodenabdeckung und Medienbereitschaft getrennt prüfen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          variant="outline"
          aria-disabled={loading}
          onClick={() => {
            if (!loading) onReload();
          }}
        >
          Bericht neu laden
        </Button>
        {loading && <p role="status">Kanonische Metadaten und gespeicherten Index prüfen …</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Bericht nicht bestätigt. Bei geändertem Register zuerst den YouTube-Stand neu laden.
          </p>
        )}
        {report && (
          <>
            <p className="font-medium">
              {report.name} · {report.kind === "series" ? "TVDB" : "TMDB"} {report.targetId}
            </p>
            <p role="status" className="text-sm">
              {reportStates[report.state]}
            </p>
            <p className="text-sm text-muted-foreground">
              {report.kind === "series"
                ? "Kanonische Ausstrahlungsreihenfolge. "
                : "Kanonische Filmidentität. "}
              {report.indexAt
                ? `Index vom ${new Date(report.indexAt).toLocaleString("de-DE")}. `
                : ""}
              Noch kein Sprach-, Format- oder Mediennachweis. Eine Titelzuordnung startet keinen
              Download.
            </p>
            <div className="flex flex-wrap gap-2">
              <Badge variant="secondary">{report.totals.mapped} zugeordnet</Badge>
              <Badge variant="secondary">{report.totals.missing} ohne Eintrag</Badge>
              <Badge variant="secondary">{report.totals.ambiguous} unklar</Badge>
              <Badge variant="secondary">{report.totals.unavailable} nicht verfügbar</Badge>
            </div>
            <ol className="divide-y text-sm">
              {report.rows.map((row) => (
                <li key={`${row.season}:${row.episode}`} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      {row.season !== null
                        ? `S${String(row.season).padStart(2, "0")}E${String(row.episode).padStart(2, "0")} · `
                        : ""}
                      {row.title}
                    </span>
                    <Badge variant="secondary">{states[row.state]}</Badge>
                  </div>
                  {row.sources.map((source) => (
                    <div
                      key={source.videoId}
                      className="rounded-md border p-2 text-muted-foreground"
                    >
                      <a
                        className="underline"
                        target="_blank"
                        rel="noreferrer"
                        href={`https://www.youtube.com/watch?v=${source.videoId}`}
                      >
                        {source.originalTitle}
                      </a>
                      <p>
                        {source.sourceCoordinates
                          ? `Quelle S${String(source.sourceCoordinates.season).padStart(2, "0")}E${String(source.sourceCoordinates.episode).padStart(2, "0")}. `
                          : ""}
                        {source.availability === "unavailable"
                          ? "Früherer Titel; aktuell nicht verfügbar."
                          : "Im Index gelistet; Medien ungeprüft."}
                      </p>
                    </div>
                  ))}
                </li>
              ))}
            </ol>
            {report.extraCount > 0 && (
              <div className="space-y-2">
                <h3 className="font-medium">
                  Zusätzliche oder ungebundene Einträge ({report.extraCount})
                </h3>
                <ul className="divide-y text-sm">
                  {report.extras.map((item, i) => (
                    <li key={item.videoId ?? i} className="py-2">
                      {item.title ?? "Nicht verfügbarer Eintrag ohne bekannten Titel"}
                      <span className="block text-muted-foreground">
                        {item.state === "unavailable"
                          ? "Keine Episode aus der Playlistposition abgeleitet."
                          : item.reason === "number_conflict"
                            ? "Quellnummerierung widerspricht dem kanonischen Ziel."
                            : item.reason === "metadata_conflict"
                              ? "Metadatenbindung widersprüchlich."
                              : "Kein eindeutiger konkreter Episodentitel."}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant="outline"
                aria-disabled={page === 0}
                onClick={() => {
                  if (page > 0) onPage(page - 1);
                }}
              >
                Vorige Berichtsseite
              </Button>
              <span className="text-xs">
                Seite {page + 1} · {report.rowCount} kanonische Einträge
              </span>
              <Button
                size="sm"
                variant="outline"
                aria-disabled={(page + 1) * 100 >= Math.max(report.rowCount, report.extraCount)}
                onClick={() => {
                  if ((page + 1) * 100 < Math.max(report.rowCount, report.extraCount))
                    onPage(page + 1);
                }}
              >
                Nächste Berichtsseite
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
