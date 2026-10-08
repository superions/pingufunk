import type { UiSearchCoverage } from "@/types";

export function SearchCoverageNotice({ coverage }: { coverage: UiSearchCoverage | null }) {
  if (!coverage) return null;
  return (
    <div role="status" className="text-sm text-muted-foreground space-y-1">
      {coverage.sources.every((source) => source.state === "disabled") && (
        <p>Keine Quelle ist für diese Suche aktiviert. Es wurde kein Katalog abgefragt.</p>
      )}
      {!coverage.complete && (
        <p className="text-amber-700 dark:text-amber-400">
          Unvollständige Suche: Mindestens eine aktivierte Quelle konnte nicht vollständig abgerufen
          werden.
          {coverage.returnedCount === 0
            ? " Das ist kein bestätigter Nichtfund."
            : " Die angezeigten Treffer stammen nur aus den erfolgreich abgerufenen Quellen."}
        </p>
      )}
      {(coverage.candidateWindowLimited || coverage.resultLimitReached) && (
        <p>
          Begrenztes Suchfenster: {coverage.returnedCount} von {coverage.eligibleCount} nutzbaren
          Katalogtreffern im abgerufenen Fenster angezeigt. Kein Gesamtbestand der Mediatheken.
        </p>
      )}
    </div>
  );
}
