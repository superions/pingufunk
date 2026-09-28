---
name: pingufunk-inline-doc
description: Review and improve inline contracts in handwritten Pingufunk TypeScript, TSX, shell and SQL during nontrivial changes or explicit comment work. Preserve maintainer knowledge without comment quotas; not for standalone documentation tasks.
---

# Pingufunk Inline-Verträge

Kommentare sind Teil einer nichttrivialen Änderung. Sie erklären beobachtbare
Caller-Verträge und belegte Invarianten, nicht jede Zeile. Englisch für Code/
Kommentare, Deutsch für eigenständig beauftragte Projektdokumentation.

1. AGENTS.md, Owning-Code, Caller und Tests lesen. Wissenswert sind Einheiten,
   Identität, Sprache, Cachefrische, Reihenfolge, Cancellation, Dateipfade,
   Berechtigungen, Ressourcenlebensdauer und Migrations-/Retry-Idempotenz.
2. Erklärung an Deklaration bzw. enforcing owner halten. TS/TSDoc `/** ... */`
   für Caller-Semantik, lokale `//`/JSX-Kommentare für die nicht offensichtliche
   Entscheidung. Typen nicht mit redundanten JSDoc-Typangaben wiederholen.
3. Shell-/SQL-Kommentare erklären Quoting, Zustandsgrenzen, Transaktionen,
   persistierte Typen und irreversible Effekte. Keine Credentials/privaten
   Betriebspfade oder nicht belegten Sicherheitsgarantien in Kommentaren.
4. Vorhandene rationale erhalten, veraltete korrigieren/kürzen/entfernen. Keine
   erfundene Incidentgeschichte und keine geplante Eigenschaft als implementiert
   beschreiben. Fehler nicht als gewollten Vertrag dokumentieren.
5. Docs-only Auftrag lässt Runtime/API unverändert. Keine kosmetischen Refactors,
   Manifeste, parallele Linter, Skill-Infrastruktur oder breite Kommentarcleanup-
   Aktion. Maschinenrelevante Directives und Lizenzheader nicht als Prosa ändern.
6. Generierte Clients nicht editieren. Angemessene Gates aus package.json und
   pingufunk-test-gates auswählen; Kommentare allein brauchen keinen DB-Stack.

TODO/FIXME/HACK benennt belegtes fehlendes Verhalten bzw. einen konkreten
Removal-Gate; kein Ersatz für einen genehmigten Planvertrag. Abschlussprüfung:
geht beim Entfernen des Kommentars relevantes Wissen verloren, stimmt er nach
der Änderung, sitzt er beim richtigen Owner? „Keine neuen Kommentare nötig“
ist ein gültiges Ergebnis nach dieser Prüfung.
