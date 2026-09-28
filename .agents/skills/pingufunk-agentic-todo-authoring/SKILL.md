---
name: pingufunk-agentic-todo-authoring
description: Create, repair or consolidate executable phased Pingufunk TODOs from approved plans and raw findings. Use for code-anchored planning with preserved requirements, explicit owners, dependencies and acceptance; not for implementing or weakening an approved task contract.
---

# Pingufunk TODO-Authoring

Ein TODO ermöglicht den Start beim ersten offenen Punkt ohne erfundene
Produktentscheidung. Deutsch gemäß CONTRIBUTING.md; Code/Kommentare bleiben
Englisch. Diese Pingufunk-Adaption hat keine Myoxus-Tool-/Host-Abhängigkeit.

## Quellen und Autorität

AGENTS.md, aktuelle Nutzerentscheidungen, vorhandene TODOs/Rohnotizen, relevante
Code-Owner, Pläne und Reviewbefunde vollständig im betroffenen Scope lesen.
Vorhandene projektlokale Learnings berücksichtigen; fehlt ein Learnings-System,
die belegten Projekt-Reviews nutzen, keinen fremden privaten Bestand importieren.
Upstream-Änderungen als Fakten prüfen, nicht als Erlaubnis zum Scopewechsel.

Vor Konsolidierung jede gültige Anforderung einer verbleibenden gemeinsamen
Regel oder konkreten Checkbox zuordnen. Nur belegte erledigte/veraltete oder
vom Nutzer verworfene Arbeit entfernen. Nicht ausgeführte Arbeit bleibt offen,
auch wenn Analyse, Commit oder Charakterisierungstest bereits fertig sind.

## Phasen und ausführbarer Vertrag

- Ein kanonischer aktiver Vertrag unter todo/; kein Metaindex, Ledger, Done-
  Archiv oder zweiter Statusreport ohne Projektbedarf. Pläne behalten Analyse/
  Referenzwissen, nicht eine konkurrierende Implementierungsreihenfolge.
- Gemeinsame Nutzerentscheidungen, Sicherheits-/Erhaltungsregeln und Abschluss-
  politik einmal vor den Phasen. Danach die geordnete Checkboxliste als einziger
  ausführbarer Vertrag; keine Pflichtoperation in ungetrackter Abschlussprosa.
- Phasen nach unabhängig beurteilbarem Ergebnis und primärem Code-Owner;
  Abhängigkeiten vor dem Ergebnis nennen. Bestehende Paket-IDs stabil halten,
  tatsächliche Reihenfolge sichtbar machen. Keine Taxonomie nur nach Ordnern.
- Jede Checkbox schließt ein kohärentes, buildbares Ergebnis: vorhandene
  Dateien/Symbole, Zielowner, Operation/Consumer in Abhängigkeitsfolge, zu
  erhaltender Vertrag und obsolete Zweige sowie binäre Abnahme nennen.
  Keine File-/Test-/Screenshot-Mikroaufgaben statt Produktresultat. Eine bereits
  beauftragte Test-/CI-Grundlagenphase ist ein eigenes Infrastrukturresultat.
- Ein gemeinsamer Contract-Cutover bewegt Producer und Consumer zusammen.
  Zwischenstände dürfen keine inkompatiblen Interfaces oder kaputte Starts
  als „erledigt“ hinterlassen. Shared Frameworks erst mit realem Consumer.
- Jeden Operations-/Entscheidungs-/Freigabestopp in die entsprechende Checkbox
  aufnehmen. Ungeklärte Produktdefaults, externe API-Zusagen, RPO und tatsächliche
  Betriebswerte sind explizite Entscheidungsgates, kein vages „ggf. später“.
  Planfreigabe ist nie Deployment-, Migrations-, Grab- oder Entfernungsfreigabe.

## Review und Abnahme

Den vollständigen betroffenen Owner-/Call-/Writepfad reviewen, Findings beheben
und nach Änderungen erneut prüfen. Danach die autorisierte repräsentative
Produktoperation/Readback durchführen, soweit ein solcher sicherer Pfad
existiert, und passende kausale Gates aus package.json/Workflows nutzen.
Für nicht sichtbare Owner Mock-/Domain-/Dateisystemgates; keine erfundene UI-
Journey. Geplante Charakterisierung in P00 bleibt ausdrücklich zulässig.

Tests schützen konkrete Regressionen/Consumer, nicht nur Statuscodes oder
Source-Strings. Wertvolle Tests erhalten; keine blanket skips. Produktgates bei
reinem TODO-Authoring nicht ausführen. Grüne Evidenz ohne relevante Änderung
wiederverwenden; keine Myoxus-Matrix-/Cargo-/Yarn-Kommandos erfinden.
UI-TODOs benennen reale Pingufunk-Routen, Zustände und Pointer-/Keyboard-
Interaktionen; Desktop-only, keine Mobil-/Geräte-/Simulatorchecks.
Dokumentationsowner in die Checkbox des geänderten Vertrags integrieren.

## Status und Abschluss

Implementierung ändert nur Checkboxstatus und optional eine faktische
Abschlussnotiz direkt am Punkt. Abhängigkeits-/Scope-/Abnahmeänderungen brauchen
einen autorisierten Replan; Konflikte stoppen den betroffenen Punkt, kein
Umdeuten. Erfüllt bedeutet unveränderte Abnahme bestanden und Ownerreview ohne
offene Findings; späterer Befund öffnet den Punkt erneut. Kohärente Commits/
Pushes zum eigenen Topicbranch vor nächster unabhängiger Arbeit, kein implizites
Upstream-PR oder Release. Beginn: erste offene Checkbox der frühesten Phase.

Zum Schluss Vollständigkeit gegen Quellen, Code-Anker, Reihenfolge, Gates,
Ressourcenlinks und Eliminierung konkurrierender TODO-Kopien prüfen.
Der PostgreSQL-Skill besitzt die DB-Fachregeln, test-gates die Gate-Auswahl;
deren Instruktionen vor tatsächlichem Einsatz lesen.
