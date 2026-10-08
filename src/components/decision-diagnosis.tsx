import type { DecisionReport, DecisionReason, DecisionStage } from "@/lib/decision-diagnostics";

const stages: Record<DecisionStage, string> = {
  catalogue: "Katalog",
  identity: "Identität",
  runtime: "Laufzeit",
  language: "Sprache",
  rendition: "Fassung",
  availability: "Verfügbarkeit",
  transfer: "Transfer",
  media: "Dateiprüfung",
  request: "Anfrage",
};
const reasons: Record<DecisionReason, string> = {
  catalogue_empty: "Kein Katalogtreffer im gelesenen Fenster",
  catalogue_candidates: "Katalogkandidaten vorhanden",
  source_failed: "Quelle nicht erreichbar",
  followup_failed: "Folgeseite nicht verfügbar",
  window_limited: "Suchfenster begrenzt",
  sources_disabled: "Quellen deaktiviert",
  budget_exhausted: "Versuchslimit erreicht",
  deadline_exceeded: "Zeitlimit erreicht",
  alias_conflict: "Titel-/Aliaswiderspruch",
  coordinate_conflict: "Episodenkoordinaten widersprüchlich",
  year_conflict: "Jahr widersprüchlich",
  identity_missing: "Identität nicht belegt",
  identity_ambiguous: "Identität mehrdeutig",
  identity_verified: "Identität belegt",
  runtime_invalid: "Laufzeit ungültig",
  runtime_missing: "Laufzeit nicht belegt",
  runtime_outside_tolerance: "Laufzeit außerhalb der Toleranz",
  runtime_verified: "Laufzeitprüfung bestanden",
  minimum_duration: "Mindestdauer unterschritten",
  language_unknown: "Tonsprache unbekannt – nicht automatisch Deutsch",
  language_verified: "Tonsprache belegt",
  language_excluded: "Sprachfassung ausgeschlossen",
  language_conflict: "Sprachbelege widersprüchlich",
  rendition_unavailable: "Keine nutzbare Fassung",
  rendition_unverified: "Fassung nicht geprüft",
  rendition_verified: "Fassung belegt",
  probe_unsupported: "Probe nicht unterstützt",
  probe_invalid: "Probe ungültig",
  media_invalid: "Medienprüfung fehlgeschlagen",
  file_unsafe: "Dateipfad nicht sicher zugeordnet",
  file_changed: "Datei verändert",
  expectations_invalid: "Erwartungen ungültig",
  source_evidence_mismatch: "Quellenbeleg stimmt nicht überein",
  tool_unavailable: "Werkzeug nicht verfügbar",
  tool_timeout: "Werkzeug-Zeitlimit erreicht",
  transfer_failed: "Transfer fehlgeschlagen",
  media_verified: "Lokale Medienprüfung bestanden",
  request_invalid: "Anfrage ungültig",
  request_failed: "Anfrage nicht vollständig bestätigt",
  cached_response: "Gecachte Antwort – keine neue Prüfung",
  rights_unknown: "Rechtezeitraum unbekannt",
  rights_current: "Rechtezeitraum aktuell",
  rights_expired: "Rechtezeitraum abgelaufen",
  rights_not_yet: "Noch nicht freigegeben",
  rights_conflict: "Rechteangaben widersprüchlich",
};
const evidence = {
  proven: "belegt",
  missing: "fehlend",
  conflicting: "widersprüchlich",
  unavailable: "nicht verfügbar",
  not_required: "nicht erforderlich",
};
export function decisionReasonLabel(reason: DecisionReason) {
  return reasons[reason];
}

export function DecisionDiagnosis({ report }: { report: DecisionReport | null }) {
  if (!report)
    return (
      <p className="text-sm text-muted-foreground">
        Diagnose unbekannt: kein bestätigter Bericht für diese Anfrage.
      </p>
    );
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">
        Entscheidungsdiagnose{report.overflow ? " · unvollständig" : ""}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">
        Katalog → passende Fassung → Auftrag → geprüfte Datei. Diese Suchprüfung ist noch kein
        Download oder Arr-Import. Zähler sind Prüfungen, nicht eindeutige Filme/Episoden.
      </p>
      <ul className="mt-2 space-y-1">
        {report.events.map((event, index) => (
          <li key={index}>
            {stages[event.stage]}: {reasons[event.reason]} · {evidence[event.evidence]} (
            {event.count})
          </li>
        ))}
      </ul>
      {!report.events.length && <p>Keine neuen Einzelbelege aufgezeichnet.</p>}
      {report.state === "failed" && (
        <p>Bericht nach Fehler beendet; kein vollständiger Nachweis.</p>
      )}
    </details>
  );
}
