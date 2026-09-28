---
name: pingufunk-dependency-review
description: Review Pingufunk dependency removal, consolidation, security findings or bundle cost by tracing consumers and protected behavior. Use for explicit dependency audits; ordinary feature imports do not require a broad audit.
---

# Pingufunk Dependency-Review

Mit benötigtem Verhalten anfangen, nicht mit der Größe der importierten API.
AGENTS.md, package.json, package-lock.json, Build-/Docker-/Generatorpfade und
alle erreichbaren Consumer prüfen. Zero imports beweist keine unbenutzte CLI.

- Runtime, Build, Test und Native-Medienwerkzeuge unterscheiden. Next/Prisma-
  Generierung, XML-/Streamparser, FFmpeg und yt-dlp besitzen eigene Verträge.
  Server-/Browserbundles getrennt betrachten; keine Rust/Yarn/Electron-Annahmen.
- Für jeden Kandidaten Owner, genutzte Funktionen, dynamische Imports,
  CLI-/Codegen-Caller, Ersatzowner und geschützte Regressionen festhalten.
  Vor Eigenbau vorhandene Parser/Provider/Komponenten prüfen.
- Removal, Konsolidierung, lazy loading und Subpath-Import sind unterschiedliche
  Änderungen. Transitive Abhängigkeit erst als entfernt zählen, wenn kein
  eingehender Edge bleibt; Einsparungen nicht mehrfach addieren.
- Sicherheits-/Kompatibilitätsangaben gegen aktuelle primäre Advisories und
  die tatsächlich gelockte Version verifizieren. Scannerbefund ist kein
  Exploitnachweis. Prisma-Major-Upgrade nicht beiläufig mit PostgreSQL verbinden.
- Review produziert Befunde, keine unautorisierte Implementation. Bei
  beauftragter Änderung npm/echte Generatoren für Lockfile/Client verwenden,
  Attribution und veröffentlichte Daten-/API-Verträge erhalten.
- Gate-Auswahl aus pingufunk-test-gates; sichtbares Verhalten bei Bedarf mit
  pingufunk-visual-qa auf Desktop prüfen. Keine Funktionen/Regressionen streichen,
  um eine Dependencyzahl oder Laufzeitvorgabe zu erreichen.

Ergebnis nennt direkte/übrige transitive Edges, tatsächliche Lockänderung,
gemessene vs. geschätzte Kosten, beibehaltene Funktion, Checks und Restrisiken.
Kein npm audit fix --force oder beliebiges latest-Upgrade als pauschale Lösung.
