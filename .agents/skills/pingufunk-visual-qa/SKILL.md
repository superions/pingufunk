---
name: pingufunk-visual-qa
description: Verify Pingufunk UI changes on the actually served development or test bundle with desktop-only interactions, matched screenshots and console evidence. Use for user-visible UI work, not API-only or documentation-only changes.
---

# Pingufunk Desktop-UI-Prüfung

Lies AGENTS.md und die betroffenen Routen/Komponenten. Vorher/nachher muss sich
auf denselben Desktop-Route-/State-/Theme-Schlüssel beziehen. Codeinspektion
oder erfolgreiche Unit-Tests sind keine visuelle Evidenz.

1. Autorisierte Development-/Testinstanz und served revision feststellen.
   Routen aus src/app entdecken, keine erfundenen Myoxus-Admin-/Editorrouten.
   Konkrete Nutzer-URL/State als Mindest-Reproduktion behandeln; andere Fixtures
   sind zusätzliche Evidenz, kein Beweis für den gemeldeten Zustand.
2. Passende synthetische Settings, Queue/History- und Suchzustände auf der
   isolierten Instanz nutzen. Nie einen realen Grab/Download oder produktiven
   Settingswechsel durch UI-QA auslösen. Fehlende sichere Umgebung melden,
   nicht durch ein Mockbild einen Live-Fix behaupten.
3. Betroffene Flows per Tastatur/Pointer bedienen: Loading, Leer-/Fehlerzustand,
   Validierung, Speichern/Readback und Dialoge soweit geändert. Desktop-only;
   keine mobilen/kompakten Viewports, Geräte, Simulatoren oder Screenshots.
4. Matched Screenshots selbst ansehen; Console-/Pagefehler, Fokus, Labels,
   Textfit, Overlay und Overflow prüfen. Vorhandene Radix-/Tailwind-Komponenten
   wiederverwenden, keine Mantine-/Facade-Migration voraussetzen.
5. Light/dark/system nur in den tatsächlich vorhandenen und betroffenen
   Themeverträgen prüfen. Private URLs, Mediennamen und Secrets nicht in
   öffentliche Screenshots übernehmen; Bildmaterial lokal/ignoriert halten.
6. Bei schlechterem/unklarem Nachher weiter korrigieren. Betroffene Keys neu
   aufnehmen, unveränderte grüne Evidenz wiederverwenden. Keine Capture-Schleife
   ohne geänderte UI-/Runtimeinputs.

Abschluss nennt tatsächliche Instanz/Revision, Route/State, Bildpfade,
Console-Ergebnis, Interaktionen und offene Grenzen. Ein Source-only Checkpoint
ist nicht „visuell verifiziert“. Browserharness aus der Umgebung verwenden;
dieser Skill erfindet oder installiert keine Test-/Capturewrapper.
