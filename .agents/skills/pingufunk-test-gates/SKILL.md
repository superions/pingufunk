---
name: pingufunk-test-gates
description: Select and report Pingufunk implementation and CI verification using npm, Vitest, ESLint, TypeScript and Next. Use for regression tests, changed-code gates and evidence reuse; not for unrequested test deletion or production integration.
---

# Pingufunk Test-Gates

Lies AGENTS.md, den betroffenen Planvertrag, package.json, vitest.config.ts und
einschlägige Tests/Workflows. Pingufunk hat keine Myoxus-Testmatrix oder Cargo-
Wrapper. Befehle und verfügbare Gate-Scripts aus diesem Checkout nehmen.

## Auswahl und Ausführung

1. Geänderte Owner und letzte gültige Evidenz erfassen. Docs-/Skilländerungen
   brauchen Format-, Link-/Struktur- und Diffprüfung, nicht automatisch einen
   Produktbuild oder laufende Datenbank. Bereits grüne Tests ohne geänderte
   Produkt-/Test-/Dependency-/Runtimeinputs als wiederverwendet ausweisen.
2. Für TS-Implementierung fokussierte Tests zur Diagnose verwenden, dann am
   kohärenten Abschluss `npm test`, `npm run lint`, `npm run typecheck`,
   `npm run format:check` und `npm run build` entsprechend dem geänderten Vertrag.
   Toolchain Node mindestens 24 und npm ci; keine Yarn-/Rust-Annahmen.
3. Newznab-Matching prüft Identität/Koordinaten/Sprache, negative Kandidaten,
   total/Pagination und RSS→NZB→Download-Vertrag. Importtests prüfen Jobpfade
   und tatsächlichen Consumer; eine erfolgreiche HTTP-Antwort reicht nicht.
4. Provider/Servarr/Downloadnetzwerk mocken. Datenbankvertragsänderungen gegen
   disposable PostgreSQL testen; nach P11 kein SQLite-Ersatz für den PG-Gate.
   Migrationfixtures dürfen synthetisches SQLite als Quellformat verwenden.
5. Testressourcen durch den Test selbst begrenzt anlegen und in finally/teardown
   schließen. Cleanupfehler nicht verstecken; keine gemeinsamen DBs/Volumes
   löschen. Langläufer mit Timeout und owned process-tree cleanup versehen.
6. Keine blanket skips, geschluckten Exceptions oder schwächeren Assertions
   für einen grünen Lauf. Bei ausdrücklicher Testkonsolidierung Invariante und
   ausführbaren Scope vor/nach vergleichen; nur gemessene Einsparungen behaupten.

## Abschluss

Exakte Commands, Ergebnisse und bestehende vs. neue Fehler berichten.
Neue, wiederverwendete, durch beobachtete Hooks abgedeckte und bewusst nicht
erneut ausgeführte Gates unterscheiden. `git diff --check` und Scope-Review.
Desktop-only UI-Evidenz bei sichtbaren Änderungen separat einholen, nicht durch
grüne Unit-Tests ersetzen. Ein Gate ist meaningful, wenn es bei Abschalten der
geschützten Implementierung für die konkrete Regression fehlschlägt.
