"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { parseJobDiagnosis, type JobDiagnosis } from "@/lib/job-diagnostics";
import { decisionReasonLabel } from "./decision-diagnosis";

const files = {
  unverified: "Datei nicht verifiziert",
  verified_present: "Geprüfte Datei vorhanden; Größe stimmt mit dem Job überein",
  missing: "Lokale Datei nicht vorhanden (nach Arr-Verschiebung möglich)",
  unsafe: "Datei nicht sicher diesem Job zugeordnet",
  unavailable: "Dateizustand nicht verfügbar",
};
const states = {
  queued: "eingereiht",
  downloading: "Transfer läuft",
  converting: "Mux läuft",
  completed: "Download abgeschlossen",
  failed: "fehlgeschlagen",
};
const imports = {
  unknown: "Importstatus unbekannt",
  unavailable: "Importprüfung nicht verfügbar",
  blocked: "Arr-Import blockiert",
  reported_import: "Arr-API meldet einen zugeordneten Import",
  conflicting: "Arr-Dateizuordnung widersprüchlich",
};
const reasons = {
  integration_disabled: "Anbindung deaktiviert",
  category_unknown: "Kategorie keiner Arr-Anbindung zugeordnet",
  not_associated: "Kein vollständiger Download-ID-/Dateibeleg",
  window_limited: "Begrenztes API-Fenster – unvollständiger Nachweis",
  unsupported_version: "Arr-Version nicht unterstützt",
  request_failed: "API-Anfrage fehlgeschlagen",
  title_mismatch: "Serientitel passt nicht",
  language_mismatch: "Sprache passt nicht",
  quality_mismatch: "Qualität passt nicht",
  path_unavailable: "Importpfad nicht verfügbar",
  import_blocked: "Weitere Importprüfung erforderlich",
  file_mismatch: "History und aktuelle Datei stimmen nicht überein",
  api_file_associated:
    "Gepaarte Grab-/Importhistorie, aktuelle Dateizuordnung und positive API-Dateigröße; Dateiexistenz am Arr-Host nicht physisch geprüft",
};
const checks = {
  unknown: "unbekannt",
  passed: "bestanden",
  passed_provider: "Quellenbeleg beim Abschluss",
};
export function JobDiagnosis({ id }: { id: string }) {
  const [report, setReport] = useState<JobDiagnosis | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const read = async () => {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setLoading(true);
    setReport(null);
    setError(false);
    try {
      const response = await fetch(`/api/downloads/${encodeURIComponent(id)}/diagnostics`, {
        cache: "no-store",
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]),
      });
      if (!response.ok) throw Error();
      const next = parseJobDiagnosis(await response.json());
      if (!next) throw Error();
      if (!controller.signal.aborted) setReport(next);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setLoading(false);
    }
  };
  return (
    <div className="space-y-2">
      {/* The in-flight guard blocks duplicate reads without disabling the focused DOM node. */}
      <Button
        variant="outline"
        size="sm"
        aria-disabled={loading}
        aria-busy={loading}
        onClick={read}
      >
        {loading ? "Prüfe…" : "Diagnose lesen"}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          Diagnose nicht bestätigt. Kein alter gesunder Status übernommen.
        </p>
      )}
      {report && (
        <div className="text-xs space-y-1" aria-live="polite">
          <p>
            Job: {states[report.job]} · {files[report.file]}
          </p>
          <p>
            Laufzeit: {checks[report.checks.duration]} · Sprache: {checks[report.checks.audio]} ·
            Dimensionen: {checks[report.checks.resolution]}
          </p>
          {report.reason && <p>{decisionReasonLabel(report.reason)}</p>}
          <p>
            {imports[report.import.state]}: {reasons[report.import.reason]}
          </p>
          <p className="text-muted-foreground">
            Momentaufnahme der Datei und Arr-API. Medienchecks stammen vom Downloadabschluss, nicht
            von einer neuen Medienprobe. Completed ist kein Importbeleg.
          </p>
        </div>
      )}
    </div>
  );
}
