---
name: pingufunk-test-gates
description: Select and report Pingufunk implementation and CI verification using npm, Vitest, ESLint, TypeScript and Next. Use for meaningful regression tests, explicit test cleanup, changed-code gates and evidence reuse; production integration requires authorization.
---

# Pingufunk Test-Gates

Lies AGENTS.md, den betroffenen Planvertrag, package.json, vitest.config.ts und
einschlägige Tests/Workflows. Pingufunk hat keine Myoxus-Testmatrix oder Cargo-
Wrapper. Befehle und verfügbare Gate-Scripts aus diesem Checkout nehmen.

## Testansatz und Bereinigung

Nutzerentscheidung vom 2026-11-06: Trivialtests entfernen, nicht aus Gewohnheit
behalten. Bei ausdrücklich beauftragter Bereinigung im Zweifel entfernen;
für diese Bereinigung verbindlich 90 % ± 5 % des gesamten aktuellen Testbestands
entfernen. Keine Empfehlung; anhand der tatsächlich entdeckten Fälle nachweisen.
Testanzahl und Coverage sind kein Qualitäts- oder Freigabenachweis.

- Wenige aussagekräftige Abläufe über die tatsächlichen Owner-Grenzen prüfen.
  Beispiel: HLS-Fortschrittsausgabe → Parser → Scheduler → echte disposable
  Datenbank → abgeschlossener Job. Kein gegenseitiges Wegmocken des Vertrags.
- Behalten: belegte Regressionen, echte Produktentscheidungen und wesentliche
  Fehlerfolgen. Externe Dienste und Medienbytes dürfen synthetisch sein;
  den geschützten Ablauf und seine Persistenz nicht durch Erfolgsmocks ersetzen.
- Entfernen: triviale Getter/Setter, Frameworkverhalten, Quelltext-/Wortlautchecks,
  reine Mockaufruf-/Durchreichprüfungen, Implementierungsspiegel und Duplikate.
  Gleichartige Parameterfälle ohne andere Verzweigung oder Fehlerfolge bündeln.
- Vor einer Löschung kurz den geschützten Vertrag prüfen; eigenständigen
  Schutz nur bei konkretem Nutzen behalten. Keine Inventar-/Dokumentationspflicht
  für jeden gelöschten Test und keine Ersatztests für bloße Implementierungsdetails.
- Bei einem Fehler muss der aussagekräftige Regressionstest am defekten Stand
  scheitern und mit der Korrektur bestehen. Einige repräsentative Negativfälle
  genügen; keine spekulativen Fallmatrizen.

## Ausführung und Nachweis

Gates aus aktuellem package.json und CI wählen. Fokusprüfung zur Diagnose,
danach passende Suite; bestehende grüne Evidenz ohne relevante Änderung nutzen.
Lint, Typecheck, Format und Build entsprechend dem tatsächlichen Änderungsscope.
Keine lokalen Container auf diesem Mac. Datenbankabläufe gegen disposable SQLite
und PostgreSQL prüfen, wenn beide betroffen sind; keine Produktion im Test.
Ressourcen und eigene Prozesse begrenzen und nach Testende schließen.
UI-Änderungen separat am ausgelieferten Desktop-Bundle prüfen.

Ergebnis nennt die geprüften Produktabläufe, relevante Grenzen sowie entfernte
Redundanz. Grüne Mocktests, hohe Testzahlen oder Coverage niemals als Beleg für
ungeprüfte Downloads oder produktive Importfähigkeit ausgeben.
