# Review des Proxy-Ablöseplans

Stand: 28.09.2026. Review von [proxy-retirement-plan.md](proxy-retirement-plan.md).
Dies ist ein zweiter, quellen- und testgestützter **Selbstreview**, kein
unabhängiger Peer-Review und keine Freigabe für produktive Änderungen.
Ergänzt um den verbindlichen PostgreSQL-Auftrag und den Review dazu (R9).

## Urteil

Der Plan beschreibt einen tragfähigen Weg zur vollständigen Ablösung, wenn
alle Abnahmegates geschlossen werden. **Heute ist die Ablösung nicht sicher.**
Es fehlen sowohl Such-/Identitätsfunktionen als auch ein nachgewiesener
Download-/Importvertrag. Keine Paketbeschreibung ist bereits implementiert.
Zusätzlich muss P11 den aktiven Datenbankbackend auf PostgreSQL umstellen;
die endgültige Proxy-Ablösung auf SQLite wäre keine Zielerreichung.

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

### R9 — PostgreSQL ist Pflicht, nicht nur eine mögliche NFS-Optimierung

Die ausdrückliche Nutzerentscheidung ersetzt die frühere Zurückhaltung zur
PostgreSQL-Migration. **Korrigiert:** O01, Reihenfolge, Abschluss- und Rollback-
gate verweisen jetzt auf das verbindliche P11-Paket und den
[Migrationsplan](postgresql-migration-plan.md). Eine Routing-Rücknahme darf
nicht unbemerkt die Datenbankentscheidung rückgängig machen.

Zusätzliche Quellprüfung bestätigt Prisma CLI/Client 6.19.2, sechs Modelle,
drei SQLite-Migrationen, ein unabhängiges SQLite-Bootstrap und ein Entrypoint,
der die Datenbank fest initialisiert. DEBUG gibt derzeit DATABASE_URL aus.
Der vorhandene Schema-Test prüft nur Tabellennamen, keine Typen oder echte
PostgreSQL-Funktion. Die erste Migration und das aktuelle Modell unterscheiden
sich bei der Autoincrement-Semantik von TvdbSeries.id.

Der neue Vertrag schützt IDs/History/Config, BigInt-Präzision, Zeittypen,
Quoted-Identifier, Foreign Keys und den neuen Prisma-Ledger. Keine pauschale
pgloader-Schemaübernahme, kein PostgreSQL-Warmup mit automatischem Queue-Start,
keine Datenbanklöschung oder automatischer SQLite-Fallback. Reale Sequences statt
statischer Liste; Rollen/DDL/setval nicht als Gesamttransaktion darstellen.

Rollback vor und nach neuen PG-Schreibvorgängen wird getrennt; nach Schreib-
vorgängen ist der alte Snapshot nicht aktuell, auch bei Cache-/Settingswrites.
Ein getesteter Maintenance-/Writer-Gate schützt die Startprüfung; Zeitpunkt der
ersten tatsächlichen Schreiboperation erfassen. Serverversion, Primary/TLS,
Importdauer und RPO sind konkrete noch offene Preflight-/Betriebsgates, keine
Gründe, PostgreSQL als optional zu behandeln. Bestehende externe PostgreSQL-
und HAProxy-Infrastruktur bleibt das Ziel, keine neue Swarm-DB.

Die zusätzlichen Projektregeln und sieben Myoxus-Adaptionen sind unter
[agent-workflow.md](agent-workflow.md) nachvollziehbar. Nicht übertragbare
Host-, Rust-, Yarn-, Mantine- und Forgejo-Annahmen wurden ausgeschlossen.

## Verifikation und Reproduktionsbefehle

Die nachstehenden Produkt-/Proxy-Testergebnisse stammen aus der vorherigen
Analyse und werden für den unveränderten Anwendungscode wiederverwendet.
Für diese reine Plan-/Agent-Ergänzung wurden keine neuen Produkt-, Datenbank-
oder Runtime-Tests behauptet. Neu geprüft: alle sieben Skills mit dem
skill-creator-Validator, YAML-Metadaten/Projekt-Routing, 25 relative Links,
P00–P11-Vollständigkeit, gezielte Privacy-/Portabilityprüfung, Prettier und
git diff --check. Diese Strukturprüfungen beweisen keine Migration.

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

## Überführung und Review der Phasen-TODOs

Die offenen Gates sind in [todo/proxy-retirement.md](../todo/proxy-retirement.md)
überführt, nicht erledigt. Es gab keine zusätzliche Roh-TODO-Datei und keine
offene Issue-Liste des Forks (Issues deaktiviert). Kein zweiter Arbeitsvertrag
in diesem Review. Zuordnung für den Vollständigkeitsreview:

| Quellen / offene Anforderung                                              | Verantwortlicher TODO                             |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| A1/A6, B03/B10: Koordinaten und einzelne Renditions                       | P00.1, P01.1–P01.2, P09.2                         |
| A4/A7, B01/B02/B04: TV-Kontext, Release, Pagination, breite Kandidaten    | P02.1–P02.3, P07.3                                |
| A2/A3, B05/B07, R4: Sprache, frühe Deduplikation, GUID, Tracktags         | P03.1–P03.3, P07.3                                |
| B14/B15, R5: Temp/Complete, Kategorien, Legacy, Isolation/Retry           | P04.1–P04.2, P05.4                                |
| B08/B09: Sonarr-Anbieter, fehlende Episoden, sichere Titelfallbacks       | P06.1–P06.3                                       |
| B06, R3: Remote-Regelquelle, generische Topics, Auto-Unique               | P07.1–P07.2                                       |
| A5, B11/B12/B13, R1/R2: accountfreie Filme, Query/ID/Jahr, Dauer          | P08.1–P08.3                                       |
| R7: Inhaltsprüfung nicht als Such-Vorabdownload                           | P09.1–P09.2                                       |
| B16: Transport entfällt, Endpoint-/Fehler-/Readinessvertrag bleibt        | P05.1, P10.1, P10.4                               |
| API-Budgets, Secret-Rotation/-Leaks, Base-URL, Cache/Settings             | P05.1–P05.3, P11.2, P06.2                         |
| O01/R9: PostgreSQL Pflicht, alle Daten/Typen, Sequences, Resume, Rollback | P11.1–P11.8, P10.2–P10.5                          |
| O02/R6: beide Verbindungen, Host/Key, Path-Mapping, GitOps und Rollback   | P10.2, P10.6–P10.7                                |
| CI/Runner/Publikation; R8: vorhandene Upstream-Fixes schützen             | P00.2, gemeinsame Regeln, P01.2/P04.1/P09.2/P10.1 |
| Ungeklärte Sprach-/Dauer-/Legacy-/Providerdefaults                        | P03.1, P06.1, P08.1, P09.1                        |
| Tatsächliche Versionen und private Betriebswerte, RPO/Freigaben           | P11.3/P11.7, P10.1–P10.7                          |

Beim strukturellen Review korrigiert: Content-Search gehört zu
`src/services/`, nicht `src/providers/`; Cachekonfiguration gehört zu den
vorhandenen Settings-/Cache-Ownern, nicht zu einer erfundenen cache-config-Datei.
Der Rollbackpunkt ist der erste tatsächliche PG-Anwendungswrite, nicht ein
späteres Schreibfreigabelabel. Auch die Migrationstests außerhalb des aktuellen
Vitest-Globs brauchen ein wirksames Gate. Ein PG-only-Checkpoint ist Voraussetzung
für getrennte DB-/Matchingdeployments; kein ungetestetes älteres Image nach
neuen PG-Schemamigrationen als kompatibel ausgeben.

Reihenfolge und Statusführung sind konsolidiert: P11 ist technische Bereitschaft
vor P06/P07/P09; der echte PG-Cutover liegt in P10 vor der Proxy-Umschaltung,
mit separaten Pausen für Importvergleich, Read-only-Start und Schreibfreigabe.
Damit wird keine Produktionsfreigabe für weitere Entwicklungsarbeit vorausgesetzt.
Die alten Planabschnitte mit zweiten Umsetzungsschritten sind durch Verweise
ersetzt; Analyse, Dateninvarianten und Herkunftsnachweise bleiben erhalten.

Dokumentprüfung dieser Überführung: zwölf Phasen, 42 eindeutige offene TODOs
in der vorgesehenen Reihenfolge; alle geprüften bestehenden Code-Anker und
37 relativen Ressourcenlinks aufgelöst. Acht Skills mit quick_validate.py
validiert, YAML-Metadaten/Namen/Aufrufe/AGENTS-Routing konsistent. Prettier-
Check der geänderten Dokumente/Metadaten und git diff --check bestanden.
Upstream erneut abgerufen, weiterhin a3b02a6e6ad827d6483700480b9bfbcc59a5823c.
Die frühere 171-Test-Evidenz wird wiederverwendet; keine erneute Produkt-
testausführung, weil Produktcode, Tests, Dependencies und Runtime unverändert sind.

**Reviewstatus:** Alle Inventar-/Reviewgruppen besitzen offene Owner-TODOs mit
Abnahme und Abhängigkeiten. Projektlokaler Skill heißt ausschließlich
`pingufunk-agentic-todo-authoring`; Myoxus ist nur Herkunft, nicht Zielrepository
oder Runtimeabhängigkeit. Struktur-/Format-/Linkprüfungen sind Dokumentevidenz,
keine neue Produkt-, PostgreSQL- oder Liveintegrationsevidenz.
Keine Deployment-, Datenmigrations-, Live-Such- oder Proxy-Entfernungsfreigabe.
