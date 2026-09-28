# Review des Proxy-Ablöseplans

Stand: 28.09.2026. Review von [proxy-retirement-plan.md](proxy-retirement-plan.md).
Dies ist ein zweiter, quellen- und testgestützter **Selbstreview**, kein
unabhängiger Peer-Review und keine Freigabe für produktive Änderungen.

## Urteil

Der Plan beschreibt einen tragfähigen Weg zur vollständigen Ablösung, wenn
alle Abnahmegates geschlossen werden. **Heute ist die Ablösung nicht sicher.**
Es fehlen sowohl Such-/Identitätsfunktionen als auch ein nachgewiesener
Download-/Importvertrag. Keine Paketbeschreibung ist bereits implementiert.

Die Reihenfolge „klein und hoher Nutzen“ ist sinnvoll: P01 repariert zwei
lokal begrenzte Fehler, P02 schließt den Episoden-Suchvertrag. P03/P04 sind
anschließend Sicherheitsgates, auch wenn ihre Umsetzung mehr Komponenten
berührt. Sonarr-Metadaten P06 bieten großen praktischen Nutzen, benötigen aber
zuerst sichere Secret-, Cache- und Identitätsverträge. Die Film- und allgemeine
ARTE-Zuordnung sind bewusst nicht als vermeintlich einfache Regex-Fixes geplant.

## Prüfverfahren und Aussagegrenzen

1. Vollständigen aktuellen Proxy, dessen Tests und Aufrufverzweigungen gegen
   Stack-Sollstand und private Betriebsdokumentation abgeglichen. Die ältere
   Homelab-Arbeitskopie war als alleinige Grundlage ungeeignet.
2. Jede Proxy-Verhaltensgruppe einem nativen Modul, einem Paket und einem
   Abnahmekriterium zugeordnet: B01–B16 sowie O01–O02. Reine HTTP-Weiterleitung
   muss nicht portiert werden; ihre beobachtbaren API-Verträge schon.
3. Pingufunk-Routen, Parser, Matcher, Metadaten-/Ruleset-Loader, Cache,
   Download-Manager, FFmpeg und relevante Tests gelesen. Upstream neu abgerufen:
   a3b02a6e6ad827d6483700480b9bfbcc59a5823c.
4. Bestandstests und sieben zusätzliche isolierte Charakterisierungen mit
   synthetischen Eingaben ausgeführt. Settings, Contentquellen, Shows und
   Metadaten sind gemockt; keine Produktions-DB und kein realer Download.
5. Proxy-Hilfsfunktionen zusätzlich auf fehlende Laufzeit, widersprüchliches
   Filmjahr und Sprach-/Website-Widerspruch geprüft. Keine Netzwerkabfrage.
6. Den fertigen Plan erneut auf Funktionslücken, Abhängigkeiten, unsichere
   Übernahmen und Rollback geprüft; unten dokumentierte Präzisierungen eingearbeitet.

Kein neuer Live-Task-Abgleich, keine aktuelle Sonarr-/Radarr-Bibliotheksprüfung.
Ein GitOps-Sollstand beweist nicht, welches Image oder welche Konfiguration
gerade läuft. Codebegründete Race-Risiken sind keine nachgewiesenen Live-Vorfälle.
Ein endgültiger unabhängiger Code- und Integrationsreview folgt pro Umsetzungspaket.

## Reproduzierte Befunde

Die Auditfälle charakterisieren das aktuelle Verhalten. „Bestanden“ bedeutet
hier **Fehler nachgewiesen**, nicht „Funktion repariert“; A7 ist die Ausnahme.
Die synthetischen Werte sind zur späteren dauerhaften Regression geeignet.

| Fall | Eingabe / isolierte Ausführung                                                                     | Beobachtung im Ausgangsstand                                     | Schlussfolgerung                                                                      |
| ---- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| A1   | Generic-Release für Example - Staffel 2 (2/6)                                                      | Titel S01E02 und Staffelattribut 01                              | P01: explizite Staffel auswerten, keine falsche S01-Evidenz                           |
| A2   | Generic-Release mit ARTE.FR und fr-Website                                                         | Release wird als GERMAN bezeichnet                               | P03: Sprachstatus vor Titelbereinigung                                                |
| A3   | Zwei Fassungen mit gleicher Website/Qualität, verschiedenen Medien-URLs                            | GUID identisch                                                   | P03: Fassungsidentität und Deduplikation gemeinsam behandeln                          |
| A4   | Textsuche Example, Staffel 2; Titel enthält Staffel 2 statt S02; Mock beachtet Query-Konjunktionen | Query verlangt literal S02, keine Treffer                        | P02/P07: Kandidatensuche verbreitern, Schlussprüfung eng halten                       |
| A5   | Filmsuche Example (1998); unpassender Magazin-Langbeitrag mit neuerem filmlisteTimestamp           | Beitrag wird als Film mit Topic und Ausstrahlungsjahr publiziert | P08: Suchtreffer sind noch kein Filmidentitätsnachweis                                |
| A6   | Standard-URL m3u8, HD-URL mp4, HLS deaktiviert                                                     | Ganze Quelle verworfen                                           | P01: Renditions einzeln prüfen                                                        |
| A7   | TVDB-ID, Staffel 2, Episode 2; zwei synthetische Folgen über passende Regel                        | Nur Episode 2, total 1                                           | Bestehenden ID-Filter erhalten; Fehler nicht pauschal allen TV-Suchpfaden zuschreiben |

Codeorte: A1–A3 in src/services/newznab.ts; A4/A6 in
src/services/mediathek.ts; A5 im Movie-Textpfad derselben Datei; A7 in
getDesiredEpisodes/applyDesiredEpisodeFilter. Die Route
src/app/api/newznab/route.ts reicht ep im Textpfad bisher nicht durch.
Diese Zuordnung trennt reproduzierte Servicefehler von zusätzlichen Route-Lücken.

## Kritische Reviewbefunde und Entscheidungen

### R1 — Proxy-Dokumentation beschreibt nicht überall die implementierte Logik

Die private README behauptet, der direkte Filmfallback werde nur bei leerer
Ursprungsantwort erreicht. handleRequest verwendet für passende GET-Filmsuchen
den direkten Pfad dagegen immer und entfernt sonst alle ursprünglichen Items.
**Korrigiert:** B13 basiert auf Code, nicht auf dem veralteten README-Satz.
P00 muss diese Orchestrierung testen; reine Helfertests reichen nicht.

### R2 — Nicht jede Proxy-Sicherheitsbehauptung hält der Prüfung stand

Isolierte Probes zeigen: fehlende Dauer passiert sowohl Sonarr- als auch
Filmfilter; ein deutscher Kanalname kann eine französische Film-Website
zulassen; das Queryjahr kann ein widersprüchliches Metadatenjahr überstimmen.
Zusätzlich beweist das angehängte Request-TMDB-ID-Attribut keine Quellidentität.
**Entscheidung:** Ziele übernehmen, diese permissiven Heuristiken nicht.
P06/P08 verlangen endliche Laufzeit und belastbare Identität; Titelwort,
Jahreszahl, Locale und ID jeweils nicht allein als Beweis behandeln.

### R3 — Allgemeines ARTE-Matching braucht eine Quelle für Regeln

Regel 109 greift breit auf ein Sammel-Topic. Generierte Regeln sind durch ein
global eindeutiges Topic im Schema begrenzt. Gleichzeitig priorisiert der
Loader die entfernte Upstream-Datei gegenüber der lokalen Fork-Datei.
**Entscheidung:** begrenzter Identity-Guard zuerst; anschließend versionierte
Quellenwahl und bei Bedarf scoped Regeln. Keine blinde Regel-Löschung, keine
All-the-Sins-Dauer-Allowlist, keine unbemerkte Datenbankschemamigration.

### R4 — Sprachauswahl erst im RSS ist zu spät

content-search.ts dedupliziert früh nur über url_video und begrenzt anschließend
die Kandidatenmenge. Damit können Fassungen verschwinden, bevor der Generator
sie bewerten kann. convertMp4ToMkv setzt zudem blind deutsche Container-Tags.
**Präzisiert:** P03 umfasst frühe Varianten-/Kandidatenbehandlung und Container-
Metadaten; P02 unterscheidet gefiltertes total von unbekannter Vollständigkeit
des Quellkatalogs. Konservative Defaults dürfen sichere Treffer nicht durch
beliebige Provider-Reihenfolge verlieren. Unklare Sprache bleibt unklar.

### R5 — Kategorieordner allein lösen nicht alle Importprobleme

Der Proxy isoliert Complete über private Kategorien. Pingufunks Tempdateiname
bleibt dagegen titelbasiert: gleiche Releases können auch mit Proxy kollidieren.
Queue/History melden öffentliche Kategorie und jobbezogenen storage getrennt.
**Entscheidung:** P04 isoliert beide Phasen nativ. Bereits vorhandene private
Kategorien bleiben lesbar; keine automatische Bestandsdaten-Umschreibung.
Delete muss lokalen Dateipfad und extern gemappten Berichtspfad unterscheiden.

### R6 — Proxy-Ablösung betrifft zwei Verbindungen und einen Host-Schlüssel

Indexer-Umschaltung allein lässt den SAB-Downloadclient weiter am Proxy.
Remote Path Mapping ist außerdem an den Downloadclient-Host gebunden.
**Präzisiert:** P10 benennt Indexer, SAB-Host und Mapping-Host ausdrücklich;
keine Änderungen an unbeteiligten Bibliothekspfaden. Aktive Downloads,
unimportierte History und GUID-Änderungen sind eigene Übergangsgates.

### R7 — Medienvalidierung darf keine Such-Vorabdownloads erzwingen

Tatsächliche Auflösung/Audio sind vor completed zu prüfen. Für RSS stehen
zunächst nur Quellinformationen zur Verfügung; ein vollständiger Download
jedes Suchtreffers wäre kein praktikabler kleiner Fix.
**Präzisiert:** P09 trennt Quellqualität im Suchvertrag von Inhaltsvalidierung
nach dem Download. Fehlt ausreichende Qualitätsevidenz, keine Sicherheit
vortäuschen; Abweichungen dürfen nicht als erfolgreicher Download enden.

### R8 — Bereits vorhandene Fixes nicht erneut bauen

TVDB-ID-Episodenfilter ist positiv geprüft. Der aktuelle Upstream enthält
bereits [PR #40](https://github.com/rundfunkarr/rundfunkarr/pull/40) für getrenntes
HLS-Video/Audio-Muxing. Stall-Timeout, EXDEV-Fallback und Kategorie-Recovery
existieren ebenfalls. **Entscheidung:** gezielte Regression und Inhaltsprüfung
statt paralleler Implementierung; HLS nicht ungeprüft global deaktivieren.

## Verifikation und Reproduktionsbefehle

| Prüfung                             | Ergebnis                                         |
| ----------------------------------- | ------------------------------------------------ |
| Private Proxy-Suite, node --test    | 34/34 bestanden                                  |
| Pingufunk, npm test -- --silent     | 171/171 bestanden, 19 Dateien                    |
| Temporäres isoliertes Audit, Vitest | 7/7 charakterisiert                              |
| Zusätzliche Proxy-Probes            | Vier Grenzfälle bestätigen permissives Verhalten |

Für die Bestandstests im jeweiligen Checkout:

```sh
npm test -- --silent
# Nur im privaten Proxy-Checkout, nicht im öffentlichen Fork:
node --test stacks/media/rundfunkarr-proxy.test.mjs
```

Die temporäre Audit-Harness liegt ausschließlich in ignoriertem lokalem
Arbeitsmaterial, nicht im veröffentlichten Repository. Sie ist kein dauerhaftes
Testkommando für einen frischen Checkout. P00 persistiert unabhängig geschriebene
Regressionen aus A1–A7 in der normalen Testsuite. Keine private Proxy-Quelle
oder echte API-Antwort wurde als Fixture übernommen.

## Noch offene Gates

- Lang-/Kurzfilm-, AD-/Untertitel- und Sprachdefaults festlegen, inklusive
  evidenzarmem Altbestand; Auswirkungen der strengen Filter messen.
- Öffentlichen Radarr-Metadatendienst nicht als garantiert stabilen Vertrag
  verkaufen; Nutzbarkeit, Datenschutz, Terms und Schema separat validieren.
- Serien-/Filmnamen, Remakes und Sammel-Topics bleiben ohne eindeutige
  Metadaten unsicher; kein permissiver „best effort“ als automatische Zuordnung.
- API-Zeitbudget, Secret-Rotation, Base-URL-Unterpfad, Redirects und Cache-
  Invalidierung durch Mocktests nachweisen. Keine neuen Schlüssel offen speichern.
- Echte isolierte Job-/Importtests, bestehende Queue-Zustände und SQLite/NFS-
  Belastung fehlen. Schemaänderungen brauchen gesonderten Rollback.
- API-Endpunkte/Parameter gegen die tatsächlich verwendeten Servarr-Versionen
  vor Integration verifizieren; in dieser Analyse nicht live aktualisiert.
- Test-CI des Forks ohne fremde Runner-Abhängigkeit bereitstellen, keine
  unbeabsichtigte Veröffentlichung durch geerbte Image-Workflows.
- Produktive Funktionsparität erst mit freigegebenem isoliertem Integrations-
  betrieb nachweisen; ein Health-200 ist kein ausreichendes Ablösegate.

**Reviewstatus:** Plan präzisiert und für P00/P01-Entwicklungsarbeit geeignet.
Keine Deployment-, Datenmigrations-, Live-Such- oder Proxy-Entfernungsfreigabe.
