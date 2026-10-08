# Review des Proxy-Ablöseplans

Stand: 06.10.2026; ursprünglicher Planreview vom 28.09.2026, datierte Folgeprüfungen unten.
Review von [proxy-retirement-plan.md](proxy-retirement-plan.md).
Dies ist ein zweiter, quellen- und testgestützter **Selbstreview**, kein
unabhängiger Peer-Review und keine Freigabe für produktive Änderungen.
Der nachfolgende R9-Abschnitt dokumentiert die damalige Pflichtentscheidung
historisch. Sie wurde am 30.09.2026 ausdrücklich aufgehoben: SQLite bleibt
unterstützt, PostgreSQL ist optional und kein Proxy-Ablösegate. Aktuell gilt
ausschließlich der [Phasenvertrag](../todo/proxy-retirement.md); frühere
Pflicht-, HAProxy- und RPO-Aussagen in diesem Review sind nicht operativ.

## Historisches Urteil vom 28.09.2026

Der Plan beschreibt einen tragfähigen Weg zur vollständigen Ablösung, wenn
alle Abnahmegates geschlossen werden. **Heute ist die Ablösung nicht sicher.**
Es fehlen sowohl Such-/Identitätsfunktionen als auch ein nachgewiesener
Download-/Importvertrag. Keine Paketbeschreibung ist bereits implementiert.
P11 sichert eine optionale PostgreSQL-Wahl mit weiter nutzbarem SQLite; eine
Proxy-Ablösung auf SQLite ist nach der späteren Nutzerentscheidung zulässig.

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

### R9 — Historische PostgreSQL-Pflicht, am 30.09.2026 aufgehoben

Der folgende Befund bleibt als Entscheidungshistorie lesbar. Die aktuelle
Vorgabe steht in R10 und im Phasenvertrag.

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

### R10 — Backendwahl und Zugriffsweg sind installationsabhängig

Die neue Nutzerentscheidung hebt R9s Pflichtziel ausdrücklich auf. Der derzeitige
PG-only-Branch wäre für bestehende SQLite-Installationen eine Regression; P11.1
ist daher wieder offen. Für Prisma 6 ist der Datasource-Provider Bestandteil
des Schemas und des generierten Clients, nicht bloß ein austauschbarer URL-Wert.
SQLite und PostgreSQL brauchen eigene Client-/Migrationsketten und gemeinsame
Domänentests. Ein PG-Ausfall darf keinen SQLite-Fallback auslösen. Ein
PostgreSQL-Endpunkt kann je Installation anders erreichbar sein; HAProxy,
Swarm-Netz und TLS-Details werden weder im öffentlichen Code festgelegt noch
aus einem anderen Projekt übernommen. URL, Passwörter und private Topologie
gehören nicht ins Git. Nach PG-Schreibvorgängen ist ein verlustfreier Rückweg
ein eigener Implementierungs- und Testumfang (P11.9), kein kleines Runbook-
Detail. Ohne ihn bleibt eine Rückschaltung auf SQLite gesperrt. Ein PG-
Schreibcutover kann mit vorab getestetem PG-kompatiblem Image und erhaltenem
PG-Datenstand einen verlustfreien App-Rollback vorsehen. P06–P10 können auf
SQLite unabhängig fortgesetzt werden.

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

| Quellen / offene Anforderung                                                         | Verantwortlicher TODO                             |
| ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| A1/A6, B03/B10: Koordinaten und einzelne Renditions                                  | P00.1, P01.1–P01.2, P09.2                         |
| A4/A7, B01/B02/B04: TV-Kontext, Release, Pagination, breite Kandidaten               | P02.1–P02.3, P07.3                                |
| A2/A3, B05/B07, R4: Sprache, frühe Deduplikation, GUID, Tracktags                    | P03.1–P03.3, P07.3                                |
| B14/B15, R5: Temp/Complete, Kategorien, Legacy, Isolation/Retry                      | P04.1–P04.2, P05.4                                |
| B08/B09: Sonarr-Anbieter, fehlende Episoden, sichere Titelfallbacks                  | P06.1–P06.3                                       |
| B06, R3: Remote-Regelquelle, generische Topics, Auto-Unique                          | P07.1–P07.2                                       |
| A5, B11/B12/B13, R1/R2: accountfreie Filme, Query/ID/Jahr, Dauer                     | P08.1–P08.3                                       |
| R7: Inhaltsprüfung nicht als Such-Vorabdownload                                      | P09.1–P09.2                                       |
| B16: Transport entfällt, Endpoint-/Fehler-/Readinessvertrag bleibt                   | P05.1, P10.1, P10.6                               |
| API-Budgets, Secret-Rotation/-Leaks, Base-URL, Cache/Settings                        | P05.1–P05.3, P11.2, P06.2                         |
| O01/R9/R10: optionale Backendwahl, alle Daten/Typen, Sequences, Resume, Rücktransfer | P11.1–P11.9, bei PG-Wahl P10.2–P10.5              |
| O02/R6: beide Verbindungen, Host/Key, Path-Mapping, GitOps und Rollback              | P10.2, P10.6–P10.7                                |
| CI/Runner/Publikation; R8: vorhandene Upstream-Fixes schützen                        | P00.2, gemeinsame Regeln, P01.2/P04.1/P09.2/P10.1 |
| Ungeklärte Sprach-/Dauer-/Legacy-/Providerdefaults                                   | P03.1, P06.1, P08.1, P09.1                        |
| Tatsächliche Versionen und private Betriebswerte/Freigaben                           | P11.3/P11.7 bei PG-Wahl, P10.1–P10.7              |

Beim strukturellen Review korrigiert: Content-Search gehört zu
`src/services/`, nicht `src/providers/`; Cachekonfiguration gehört zu den
vorhandenen Settings-/Cache-Ownern, nicht zu einer erfundenen cache-config-Datei.
Der Rollbackpunkt ist der erste tatsächliche PG-Anwendungswrite, nicht ein
späteres Schreibfreigabelabel. Auch die Migrationstests außerhalb des aktuellen
Vitest-Globs brauchen ein wirksames Gate. Ein PG-only-Checkpoint ist Voraussetzung
für getrennte DB-/Matchingdeployments; kein ungetestetes älteres Image nach
neuen PG-Schemamigrationen als kompatibel ausgeben.

Reihenfolge und Statusführung nach R10: P11 ist eine optionale Backendspur;
P06/P07/P09 und der Proxy-Ausstieg können auf SQLite unabhängig fortfahren.
Bei PG-Wahl liegt der echte Cutover getrennt von der Proxy-Umschaltung, mit
separaten Pausen für Importvergleich, Read-only-Start und Schreibfreigabe.
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

## Vertragsreview der Nutzerentscheidungen vom 30.09.2026

Erneuter **Selbstreview** des ausführbaren TODO-Vertrags, kein unabhängiger
Peer-Review und keine Produktabnahme. Gegen aktuelle Owner geprüft:
`scripts/database-config.mjs`, `shows.ts`, Settings-/Arr-Client,
`mediathek.ts`-TV-/RSS-/Filmconsumer, NZB-Parser, Downloadmodell und
Workerabschluss. Keine echten Bibliotheksantworten, Medien oder DB geöffnet.

Gefundene und im kanonischen TODO korrigierte Lücken:

- **Backendauswahl:** Der Resolver erzwingt ohne Selektor bisher SQLite auch
  bei PG-URL. P11.1 gezielt wieder geöffnet: URL-/Secret-basierte Auswahl und
  dieselbe Entscheidung in Shell-/lokalen Entrypoints; fehlerhafte Konfiguration
  oder PG-Ausfall niemals als Aufforderung zum Backendwechsel. Die frühere
  Dual-Backend-Testevidenz bleibt historisch, beweist diese Auswahl noch nicht.
- **Sonarr-Ergänzung:** P06 benennt jetzt Merge-Schlüssel, Nichtüberschreiben,
  Konfliktbehandlung, Dauerunits/-grenzen sowie ausschließlich überwachte
  Serien im RSS. Begrenzter Snapshot braucht Cursorrotation, gemeinsames
  HTTP-/Zeitbudget, stabile Pagination und epochengerechte Cacheinvalidierung.
  Alle Defaultzahlen sind dokumentierte konfigurierbare Planungswerte bzw.
  explizite technische Caps, keine behaupteten fremden API-Zusagen.
- **Filmquellen:** Die zwischenzeitliche Radarr-Bevorzugung ist auf erneuten
  Nutzerwunsch zurückgenommen. P08 prüft zuerst Mediathek-Metadaten. Externer
  Metadatendienst und Mediathek/Videoquelle sind ausdrücklich getrennt;
  kein neuer Dienst oder lokales Radarr wird vorausgesetzt. Fehlende Film-ID/
  Produktionsjahr-Evidenz ist keine Erlaubnis zu Query-ID-Stempeln oder Fuzzy-
  Zuordnung. Tatsächlich verfügbare Quellevidenz bleibt Implementierungsgate.
- **Legacy-Abschluss:** P09 trennt fehlende optionale Erwartungen von kaputten
  v1-Payloads, trägt Erwartungen über DB/Restart/Retry und prüft vor completed.
  Protokoll-Legacy ist kein bewiesenes Alter. Medienprobe ohne Sollwerte kann
  nicht jedes plausible Sample erkennen oder fehlende Sprache belegen; diese
  Grenze ist benannt statt als vollständiger Inhaltsnachweis ausgegeben.
- **Erster SQLite-Schemacutover:** Bereits P07.2 muss das historisch leere
  Bootstrap-Ledger explizit behandeln; erst P09 wäre zu spät. Beide Backends
  und erhaltene IDs/Daten bleiben Pflichtgates für die betreffenden Migrationen.

Nach Korrektur erneut auf Nutzerumfang, stabile Paket-IDs, Abhängigkeiten,
Units/Grenzfälle, Owner-/Consumer-Cutover, Desktop-only UI-Abnahme und getrennte
Betriebsfreigaben geprüft. Keine Implementierungscheckbox neu geschlossen.
Offen bleiben die benannten technischen Gates, nicht erneut die beantworteten
Fachfragen. Dokumentprüfung ist keine aktuelle API-/DB-/Produkt-/Live-Evidenz;
Produktgates müssen bei Umsetzung der neuen Verträge erneut ausgeführt werden.

## Umsetzungsreview P11.1 und technischer Vertrag P06.1 (30.09.2026)

Selbstreview, kein unabhängiger Peer-Review. Die wieder geöffnete Backendauswahl
ist in aad3588 behoben: URL-/Secret-Protokoll statt vorexportiertem SQLite-
Default, identische Entscheidung für App/Migrator, PG ohne Selektor weiterhin
Maintenance. Fehler bleiben generisch, keine URL-Ausgabe und kein Fallback.
408 reguläre Tests, acht separate disposable PG-Tests sowie beide neu gebauten
Container-Smokes bestanden. Fork-CI und Docker-Validierung desselben Commits
ebenfalls erfolgreich, ohne Veröffentlichung oder Produktionsausführung.

P06.1 gegen offizielle API, Controller und Mapper geprüft; Details/Quellen im
[Sonarr-Vertrag](sonarr-metadata-contract.md). Synthetische Parserregressionen
trennen Serien-/Episoden-/Instanz-ID, Monitoring, Episoden-/Serienlaufzeit und
UTC-Zeitpunkt/Kalendertag. Ungültige Kalenderdaten und 24:00 normalisieren nicht
still in einen anderen RSS-Tag. Fremde/duplizierte Episode verhindert Teilbestand;
unbekannte Laufzeit bleibt unbekannt. Keine Bestandsmetadaten überschrieben.
Parser sind noch nicht an Netzwerk, Lookup oder RSS angeschlossen: P06.2 und
P06.3 bleiben offen, insbesondere gemeinsamer Versuchszähler/Bodydeadline,
Epochencache/Merge, Consumerfehler, Medien-Schlussfilter und Desktop-Controls.
Kein synthetischer Parsernachweis ersetzt tatsächliche Versions-/Feldprüfung
der später gewählten Sonarr-Instanz oder die RSS→NZB→Queue-Abnahme.

Upstream wurde neu abgerufen: 1b41ebb verbessert TVDB-Suche/Settings, enthält
keinen Sonarradapter. Die überlappenden Fork-Owner nicht blind durch Merge
ersetzt. Main, andere Checkouts, Produktivdienste und reale Daten unverändert.

## P06.2-Transportgrundlage und Testisolation (30.09.2026)

Selbstreview des Teilfortschritts; P06.2 bleibt offen. Gemeinsamer getypter
Versuchszähler mit unverlängerbarer Deadline, GET-JSON-Client mit captured
Credential und ein gemeinsamer Bodyreader statt zweier unabhängiger Parser.
Arr-Grenze 5 MiB, Mediathek weiterhin 8 MiB; Byte- und Chunkcaps, striktes UTF-8,
kontrollierte Cancellation und generische Fehlertexte. Tests prüfen Retrybudget
über mehrere Calls, erschöpften/abgelaufenen Scope, langsamere Header plus Body,
stalled/oversized/invalid Responses, UTF-8-Chunkgrenzen und tatsächlichen Abbruch
eines ansonsten gültigen kleinen JSONs bei zu vielen Chunks. Zeitordnungsprobe
nutzt Fake-Timer, nicht eine flakey Wallclock-Wette.

Erster Gesamtlauf: 453 Tests grün, ein bestehender Download-Retry-Test fehlgeschlagen.
Owning-Code ruft den Worker via asynchronem Import auf; der vorherige erfolgreiche
Retrytest hatte diesen Start nicht drainiert. Dessen Mockcall traf nach dem Reset
den folgenden Fehlerfall. Korrigiert wird die Isolation mit einer zusätzlichen
positiven Start-Assertion im Erfolgstest, weder Produktverhalten noch negative
No-Start-/Historyschutz-Assertion verändert. Anschließend 457 reguläre Tests,
Lint, Typecheck, Format und Build erfolgreich; nach Umstellung der neuen
Zeitordnungsprobe separat deren Suite erneut grün. DB-/Schema-/Dependencyinputs
unverändert; die letzte PG-/Container-Evidenz ist dafür wiederverwendbar.

Noch keine Sonarraktivierung, keine fertige Merge-/RSS-/UI-Integration. Das neue
Budgetobjekt ist Infrastruktur, kein Beweis, dass jeder künftige Suchcall es schon
verwendet. Keine Checkbox geschlossen, keine Produktivdienste oder Daten berührt.

## P08 — Nutzerkorrektur und gemeinsamer Vertrag (01.10.2026)

Die frühere Senderseiten-Filmstrategie und eine Trennung in manuelle/automatische
Indexer sind ausdrücklich verworfen. Der ausführbare TODO wurde autorisiert
neu gefasst, nicht im Implementierungsreview still abgeschwächt. Ein gemeinsamer
Handler für direkte Arr-Anbindung und Prowlarr; keine Callerheuristik oder
vorausgesetzten Syncprofile. MediathekView bleibt Suchquelle; optionale lokale
Arr-Metadaten liefern den Suchkontext, keine sichere Identität aller Videos.
Filmseitenadapter und ihre ausschließlich zugehörigen Fixtures entfernt;
allgemeine Bodyreader und P07-Playervertrag erhalten.

Selbstreview über Settings/Secrets/URL/Cache, optionalen Radarr-GET-Transport,
ID-/Titel-/Jahreskonflikte, Filmretrieval, Variantenfolge, RSS/NZB und Queue.
Findings behoben: ungültige Quelldauer durfte bei Minimum null nicht durchgehen;
Metadata-Ausfall darf unabhängige Textsuche nicht ohne Not sperren; dabei darf
kein neuer Gesamtbudgetscope entstehen. Variante vor Matcher/Minimum hätte
gültige Fassungen verdrängt; Auswahl liegt nun nach Eignungsprüfung.
TMDB-Filmauflösung liest bounded Bodies, bestätigt beide lokalisierten IDs
und übernimmt nicht das erste von mehreren IMDb-Findergebnissen.
Radarr-/Sonarr-Credentials maskiert, Browser-Credentialwrites abgelehnt.

Versionierte Requestgenerator-/Decision-/Override-Owner und Grenzen stehen in
docs/movie-source-evidence.md. Gezielt versus RSS ist nicht identisch mit
interaktiv versus automatisch. Arr entscheidet selbst; fehlende Identität ist
keine garantierte Ablehnung oder universelle GUI-Sichtbarkeit.

635 reguläre Tests, Lint, Typecheck, Format und Build erfolgreich;
zehn bedingte PG-Tests im regulären Lauf nicht ausgeführt, keine neue PG-Evidenz.
Abhängigkeiten, Schema und Persistenzwriter unverändert. Film-Recent/RSS,
TV-Kandidaten und vollständige Consumerabnahme noch offen: P08 nicht geschlossen,
P09 nicht begonnen. Keine Produktionsabfrage, Aktivierung oder Datenmigration.

## P08.1-Abnahme und Recent-/TV-Kandidatencheckpoint (01.10.2026)

P08.1 ist nach Feldowner-, Transport-, Cache-, Credential- und Consumerreview
abgenommen. Film-RSS liest nur überwachte optionale Radarr-Ziele; doppelte IDs,
unschemahaftes Monitoring und fehlgeschlagene Source-Folgeseiten führen nicht
zu teilweisem Erfolg. Begrenzter 60s-Bibliothekscache und minutenbezogenes
Sourcefenster statt unverändertem Stunden-RSS. Direkte und vermittelte Anfragen
nutzen denselben Handler; der reale RSS→NZB→Queue-Pfad ist hermetisch ausgeführt.
Ohne Filmkontext ist der Feed leer, kein erfundener Indexertest-Treffer.
Consumergrenzen bei leeren Feeds/nicht parsebaren RSS-Titeln bleiben benannt.

Neue TV-Kandidaten dürfen Request-ID/Koordinaten nicht übernehmen. Review-
Findings behoben und kausal getestet: Daily-Date-Fehler konnten erneut über
den Unknown-Pfad erscheinen; kompakte S02E12-Quelltitel wurden vom früher
Slash-only-Parser nicht erkannt; Sonarr klont Renditions, weshalb ein
Referenzvergleich den verifizierten Treffer zusätzlich neutral ausgab.
Letzteres schützt ein neuer positiver Doppel-/negativer Nachbarfall bei
Minimum null. Bestehende Regeln, A7-Nachbarfilter und P07-Player bleiben erhalten.

Neue lokale Evidenz: 651 reguläre Tests erfolgreich, zehn bedingte PG-Tests
nicht im regulären Lauf ausgeführt; Lint, Typecheck, Formatcheck, Build und
Diffcheck grün. Keine DB-/Schema-/Lockfileänderung. Vorheriger 48e08a0-
Checkpoint hat erfolgreiche Fork-CI samt disposable PG-Gate und Docker-
Validierung; diese Workflow-Evidenz ersetzt nicht den Lauf des neuen Commits.
P08.2/P08.3/P08.4 bleiben bis zur restlichen Consumer-/Gesamtbudgetabnahme
offen. Insbesondere alte Serienanbieter/Showrefresh/Regelauflösung noch nicht
unter demselben Callerbudget nachgewiesen. Keine Main-Integration oder
Produktionsoperation; P09 weiterhin abhängig von vollständiger P08-Abnahme.

## P08-Gesamtbudget-Reviewcheckpoint (01.10.2026)

Die verbleibenden Budgetowner sind bis zu TVDB-Login, TMDB-Staffeln,
Katalogrefresh, Regelmetadaten, Regelgenerierung und Sonarr-RSS weitergereicht.
Vordergrundsuchen starten keinen separaten Katalogrefresh; überfällige Regeln
werden im selben Scope erneuert. Explizite Caller erben keine fremden
Coalescing-Deadlines. Körper sind begrenzt; API-Fehler, fremde IDs und
unvollständige Staffeln erzeugen keinen erfolgreichen Leer-/Teilcache.
Providerfehler dürfen eine unabhängig konfigurierte Metadatenquelle innerhalb
des Restbudgets nutzen, aber keine neue Deadline/Versuchszahl erhalten.

Review-Findings korrigiert: Ablaufgrenze ist nicht identisch mit verbleibender
Versuchszahl null nach dem letzten erfolgreichen Abruf; ein solcher vollständiger
Abruf darf publiziert werden. TVDB-nameTranslations kann eine Sprachcodeliste
statt benannter Texte sein. Optionale/null Episodenfelder und Folge 0 werden
nicht zu deutscher Sprache oder Laufzeitbelegen umgedeutet. Nicht gelesene
Fehlerbodies werden abgebrochen. Fehlgeschlagene Basisprovider dürfen nicht
nach erfolglosem Sonarr-Lookup als bestätigtes leeres Resultat erscheinen.

Die gemeinsame Retrievaltermfunktion schützt weiterhin den Filmvertrag und
erweitert TV um begrenzte Aliase/Umlaut-/Wortvarianten sowie einen belegten
Episodentitel bei exakter Suche. Sie vergibt keine Identität. Source-Unions
werden erst nach allen erfolgreichen Fenstern gecacht; neue Cacheversion.
Kausale Tests decken echte HTTP-Attemptzählung, Retrykaskade, Bodycaps,
Fremd-ID, mehrdeutige TMDB-Findresultate und Staffel-Teilversagen ab.
662 reguläre Tests bestanden, zehn bedingte PG-Tests nicht ausgeführt;
Lint, Typecheck, Formatcheck, Build und Diffcheck grün.
Der neue Gesamtbudgetcheckpoint bleibt unabhängig von der abschließenden
P08-Consumerabnahme, P09 sowie finalem DB-/Medien-End-to-End.

## P08-Abschlussreview (01.10.2026)

P08.2–P08.4 vollständig gegen den bestehenden Vertrag reviewt und abgenommen.
Quelle/Suchziel/Requestkontext bleiben getrennt, sichere TV-Nachbarn geschlossen,
neutrale Kandidaten ohne falsche IDs/Koordinaten/Jahre/Sprachen. Keine neue
Senderseitenstrategie. Alle genannten HTTP-Owner teilen ihr Callerbudget.
Versionierte Arr-RSS-/Request-/Decision-/Override-Owner und Prowlarr-Sync-
Grenze dokumentiert; synthetische direkte/vermittelte Consumerpfade ausgeführt.

Neues Consumerfinding behoben: relative NZB-Enclosures wurden vom alten Test
gegen localhost repariert, obwohl der echte Arr-Consumer absolute Download-
adressen braucht. Der vorhandene Linkowner erhält einen requestlokalen
öffentlichen URL-Kontext, optional mit Deployment-Unterpfad; keine XML-
Reparse-/Rewrite-Schicht. Gleichzeitige Caller und Responsecache-Fingerprints
werden isoliert. Forwarding-/User-Agent-Header bestimmen keine URL oder
Freigabe. Hash-GUID-Werte bleiben identisch, nicht als Permalink behauptet.
Caps-Default auf tatsächliche 100 berichtigt, max 5.000 und eindeutige vollständige
Paginationprüfung vor Requests. Die Tests prüfen die absolute URI ohne eine
heimlich hinzugefügte Base sowie NZB-MIME/Quellidentität/Download/Queue.

683 reguläre Tests erfolgreich; zehn bedingte PG-Tests nicht im regulären Lauf.
Lint, Typecheck, Formatcheck, Build und Diffcheck grün. Budgetcheckpoint
322c910 hat erfolgreiche Fork-CI 36790909761 samt disposable PG-Gates und
Docker-Validierung 36790909775. Diese Evidenz wird nicht als Lauf des noch
unveröffentlichten URL-Checkpoints ausgegeben. Keine DB-/Schemaänderung,
Main-Integration, Instanzänderung oder produktive Suche/Migration.
P09 kann beginnen; P10/P11-Endabnahme und Produktionsfreigabe bleiben separat.

## P09-Grundlagenreview (01.10.2026, nicht abgenommen)

Die ersten isolierten Owner sind vorhanden: strenges v1-Erwartungsobjekt mit
nullable Dauer/Sprache/Dimensionen und Herkunft sowie bounded lokale
Container-/Stream-/Tagprobe. Abwesenheit bleibt Legacykompatibilität, kein
Altersnachweis; ungültiger gespeicherter v1-Inhalt kann nicht heruntergestuft
werden. Review schützt Sekunden/Minuten, fehlende Tags, Coverbilder,
ausgefallenen Audio-/Videostream, Inodewechsel und eigene Prozessgruppengrenze.
Kein Netzwerkprotokoll erlaubt, keine Provider-/Datei-/Tooldiagnostik ausgegeben.
stdout+stderr zusammen höchstens 1 MiB und maximal 30s Prozesslaufzeit.
Fachschema, lokale Dateieigentumsgrenze und Prozess-/Fehlerpfade separat geprüft.

34 neue isolierte Tests bestehen. Eine synthetische Zwei-Sekunden-MP4-Datei
wurde im eigenen netzlosen, kurzlebigen Container erzeugt und mit denselben
ffprobe-Feld-/Format-/Protokolloptionen erfolgreich gelesen. Quelle für die
Optionssemantik: [ffprobe](https://ffmpeg.org/ffprobe.html) und
[Protokoll-Whitelist](https://ffmpeg.org/ffmpeg-protocols.html).
Diese Probe qualifiziert weder vollständiges Decode noch Filmidentität oder
tatsächlich gesprochene Sprache. JSON-Streamtags sind nur Containerangaben.

Noch keine Produktverdrahtung, neue Schemafelder oder abgeschlossene
P09-/P11-Abnahme behauptet. Als Nächstes gemeinsam NZB-Transport, Parser,
beide Persistenzketten/Importer/Legacyübergang, Queue-Retry/Restart und
alle Abschlusszweige samt Byte-/Mux-/DB-Fehlergrenze implementieren.

## P09-Transport-/Persistenzreview (01.10.2026, Teilcheckpoint)

Optionaler strenger v1-NZB-Block läuft über Downloadlink, Fake-NZB-Route,
Parser, beide Addfile-Routen und echte Queuewrites. Ein kaputter, unvollständiger
oder doppelter deklarierter Block wird nicht als Legacy angenommen. Alte
NZBs ohne Block bleiben kompatibel; deren Werte bleiben NULL. Die Producer-
Aktivierung und der gemeinsame Worker-Abschluss sind noch nicht abgeschlossen.

Append-only SQLite-/PG-Spalten `mediaExpectations` und `mediaValidation` sind
nullable Text. Die vier akzeptierten SQLite-Konturen (Bootstrap, drei historische
Migrationen, P07, aktuell) behalten ihre IDs und Daten. Nichtleere Ledger müssen
genau zum jeweiligen Präfix und Originalchecksums passen. Der Snapshotvergleich
ergänzt nur die historisch fehlenden neuen nullable Felder; er ignoriert keine
bestehende Fachspalte. Typisierter PG-Import und Verifier erhalten vorhandene
Payloads exakt; fehlende historische Spalten ergeben NULL. Retry validiert den
gespeicherten v1-Block, behält ihn bytegleich und übernimmt keine alten Probefakten.

737 reguläre Tests sowie separat echte disposable PG-Gates erfolgreich.
Der PG-Harness prüft zusätzlich echten Addfile→Queue→Disconnect/Restart→Retry
und den Import sowohl aus Bootstrap als auch aus aktueller SQLite-Kontur mit
nichtleeren neuen Payloads. Lint, Typecheck, Produktformat und Build grün;
nach der Importtest-Erweiterung Typecheck erneut grün, unveränderte Produktgates
wiederverwendet. Die generierten Clients wurden mit dem Repository-Generator
erzeugt. Keine Bestands-/Produktionsdatenbank migriert; P09/P11 bleiben offen.

## P09-Worker-/Medienreview (01.10.2026, Fork-Abnahme ausstehend)

Alle eigenen RSS-Producer liefern nun v1, belegte Laufzeit/Audioevidenz und
unbekannte Dimensionen. Ein gemeinsamer Abschlussowner schützt progressive,
HLS- und Konvertierungszweige vor importbereiter Fertigmeldung ohne Probe.
Content-Length wird nur beim nicht kodierten Body zuverlässig verglichen.
Status/Pfad/Probefakten werden nach der Probe in einer begrenzten Transaktion
gespeichert. Verlorene Commitbestätigung führt zu durablem Statusabgleich,
nicht zum Überschreiben eines bereits verifizierten completed. DB-Ausfall
pausiert ohne Spinloop; nächster expliziter Weckruf bzw. Kaltstart übernimmt
Recovery. Kein unimplementierter automatischer Reconnecttimer behauptet.

Sonarr-HLS kann jetzt über das bestehende Opt-in gewählt werden, Default aus.
Exakte Suche, Staffel und RSS einschließlich NZB/Queue mit HLS sind synthetisch
geprüft. Keine Kategorien-/GUID-/Pfadänderung, kein neuer Provider-/Senderparser.
Probe-/Tracktag-/Identitätsgrenzen stehen unter `docs/media-validation.md`.
Review aller Source-/Producer-/Parser-/Persistenz-/Retry-/Abschluss-/Fehlerowner
einschließlich Units, Cancellation, Prozessownership und Schreibgrenzen ohne
offenes Implementierungsfinding. Eine anfängliche PG-Ausfallassertion ließ
fälschlich nur downloading zu; converting ist ebenfalls ein korrekter
unterbrochener Status. Kein beobachtetes vorzeitiges completed wird behauptet.

774 reguläre Tests, zwölf bedingte separate Fälle nicht im regulären Lauf;
Lint, Typecheck, Format und Build grün. Zusätzlich 15 Ausführungen im disposable
PG-Harness (darunter die eigene SQLite-Persistenzprobe) erfolgreich. Realer
Container-/ffprobe-Gate auf beiden Backends mit synthetischen MP4/HLS/MKV,
HTML/Truncation/fehlendem Audio/Sample, SAB-Importpfad, Queuefortsetzung und
Restart grün; kontrollierter eigener PG-Ausfall plus Weckrufrecovery grün.
Neue drei Fixturetests anschließend fokussiert grün, Typecheck nach Korrektur
zweier testseitiger ES-Target-BigInt-Literale erneut grün.

TLS-Smoke mit ursprünglichem Bootstrap und aktuellem Sourceledger samt
nichtleeren P09-Payloads besteht jeweils Snapshot/Prepare/Import/Verify/Sequences,
Maintenance, echten Write, privates Backuprestore und distinct immutable
PG-kompatibles Maintenance-Rollback. Separat immutable Vor-P07-Image mit
unveränderter SQLitequelle vor neuen Zielwrites erfolgreich. Der Forkworkflow
baut beide gepinnten Checkpoints selbst und prüft alle Rückwege; lokale
Image-IDs sind keine veröffentlichten Registry-Digests. P09/P11.7/P11.8 bleiben
bis erfolgreichem aktuellen Forklauf offen. Produktion/Main/upstream unverändert.

## P09-UI-Producer-Nachreview (01.10.2026)

Nach dem grünen Worker-/Rollbackcheckpoint 1b24208 (Fork-CI 36797426991,
Docker 36797426815) fand der zusätzliche Browserconsumerreview die noch
eigenständig erzeugten Legacy-NZBs in Suche und Filmoberfläche. Der vorherige
Ownerreview war in diesem Punkt nicht vollständig; keine P09-Abnahme erteilt.
Die Search-API liefert jetzt serverseitige NZBs je Rendition aus dem gemeinsamen
Erwartungs-/NZB-Owner. UI-Dateinamen/Kategorien bleiben erhalten, Browser
berechnet weder XML noch Audio-/Dauersollwerte. Default- und Providerantworten
einschließlich expliziter Audioevidenz getestet; echte Addfile-/Queuewrites
derselben UI-NZBs auf beiden disposable Backends belegt.

Desktopprüfung mit eigenem headed Playwright, 1440×1000, tatsächliches
Produktionsbundle auf eigener Loopbackinstanz und synthetischer SQLite-DB:
Baseline-Build-ID `siOR6pQddUEi3JLo8Imfx`, neuer Build
`JFt0FjMEQj08lMP6HlvdG`. Gematchte `/search`-/`/movies`-Ergebniszustände in
Light und Dark selbst angesehen, kein Layout-/Fokus-/Overflowregressionsbefund.
Suchfeld mit Tastatur/Enter und Suchen-/Download-/HD-/SD-/Low-Buttons mit Pointer
bedient. Browser-POSTs wurden vor jeglichem Download abgefangen: neuer
v1-Block, 120 Sekunden, unbekannte Audio/Dimensionen und tatsächliche gewählte
URL bei allen drei Qualitätsaktionen verifiziert. Serverprovider ist ein
ausdrücklich gesicherter synthetischer Preload; alle externen Fetches gesperrt.
Kein echter Grab und keine produktive Konfiguration.

Screenshots liegen nur ignoriert im eigenen QA-Verzeichnis unter
`downloads/ui-qa.*/output/playwright/{search,movies}-{light,dark}-{before,after}.png`;
keine Bilder im öffentlichen Git. Nachprüfung Konsole ohne Warnungen/Fehler.
Der erste Baseline-Aufruf hatte separat einen vorhandenen favicon-404.
P10-Reviewinput: Filmsubtitle behauptet weiterhin fest „min. 60 Min.“ trotz
konfigurierbarer API-Regel; Suchfehler erscheinen nur als leerer Zustand und
die Root-SAB-Route behandelt Remove-/Retry-Fehler anders als ihr API-Alias.
Diese vorhandenen Consumerbefunde gehören zur vollständigen P10.1-Abnahme;
sie werden nicht als bereits behoben ausgegeben. P09 wartet auf aktuellen
UI-Checkpoint/Forklauf; historische Produkt-/Mediengates nur wiederverwendet.

## P09-Abnahme und P10-Consumercheckpoint (01.10.2026)

P09 und P11.7/P11.8 sind nach CI 36798866207 und Dockerlauf 36798866196
abgenommen; dort 782 reguläre Tests und die separat ausgeführten DB-Gates.
Kein Deployment, kein PG→SQLite-Rücktransfer nach Writes und keine
produktive Arr-Verbraucherprobe.

P10.1 bleibt offen. Die beiden shipped SAB-URLs haben jetzt einen gemeinsamen
Owner samt `fullstatus`, Maintenance und redigierten Fehlern. Native
SQLite-/PG-Routeproben prüfen Queue, Failed-History, Retry mit erhaltenen
Erwartungen und gezieltes Remove. Dabei wurde der tatsächliche
`MediaExpectationsError` beim beschädigten Retry zunächst als 500 behandelt;
der reale Regressionstest schlug fehl. Jetzt kontrollierter 409, unveränderte
History, kein Legacy-Downgrade. Ein fehlgeschlagener Settingsreset wird nicht
mehr als Erfolg ausgegeben; nur Prisma-P2025 ist idempotenter Erfolg.

Such-/Filmfehler erhalten sichtbares Feedback statt falschem Leerzustand,
Keyboardsubmission teilt den In-flight-Guard des Buttons, Reads sind begrenzt.
Film-Mindestdauertext folgt dem konfigurierbaren Vertrag. Shows beschreiben
historische Persistenz statt einen nicht mehr aktiven Cache. Ruleset-/Download-
Read-/Mutationsfehler werden angezeigt; aktive Downloads zeigen keinen
funktionslosen Abbruch als verfügbare Aktion. Das ist kein neuer Cancel-Worker.
Lokale Pfadsyntax wird ohne URL/Steuerzeichen geprüft; bestehende relative
Pfade bleiben gültig. Existenz/Mountrechte werden ausdrücklich nicht attestiert.
Setup wartet auf Settings und fängt fehlgeschlagenes Speichern ab; Speichern
einer Settingskarte verwirft nicht mehr andere ungespeicherte Eingaben.

Produktgates vor visueller Abnahme: 814 reguläre Tests, Lint, Typecheck,
Format und Build grün; aktualisierte native Routeprobe und alle 15 gesonderten
DB-Ausführungen bestanden. Der Medien-Imageharness prüft zusätzlich beide
Historyadressen, echtes jobisoliertes Dateientfernen und erneut probtes Retry;
dieser neue Imagegate und die vollständige Desktopabnahme stehen noch aus.
Baseline 933a304 wird separat gebaut, damit Assets nicht mit einem gerade
überschriebenen laufenden `.next` vermischt werden. Zwei dadurch ungültige
Zwischencaptures für Settings/Setup sind keine Abnahmeevidenz.

## P10-Paritätsreview: Verbraucher und Ausfallgrenzen (01.10.2026)

Die konkrete B01–B16/O01–O02-Zuordnung steht in
`docs/proxy-retirement-parity.md`. Historische Proxymechanismen werden nicht
pauschal kopiert: insbesondere kein öffentlicher Radarr-Metadatendienst,
keine Senderseitenparser, kein HTTP-Proxytransport, keine getrennten Endpunkte
für vermeintlich manuelle und automatische Aufrufe. Direkte und vermittelte
Indexerrequests verwenden denselben Vertrag.

Desktopabnahme gegen Baseline `933a304` und serviertes P10-UI:
acht Routen, Light/Dark, 32 gematchte Bilder visuell geprüft. Pointer und
Tastatur prüfen Ergebnisse, Leer-/Fehler-/Ladezustände, Duplicate-Enter-Guard,
Filter, synthetische Historyaktionen, Settingssave/Reload/API-Readback,
Erhalten fremder ungespeicherter Karten, Pfadsyntax und Secretpräsenz.
Absichtlich fehlgeschlagene Settings- und Setup-Saves erhalten Eingaben,
persistieren nichts und lassen den Setupschritt offen; Recovery bestätigt.
Ein Capture mitten in der Dialoganimation wurde ersetzt. Nach frischer
Navigation aller acht gesunden Routen keine Konsolenwarnungen/-fehler oder
Pageerrors; injizierte HTTP-Ausfälle erzeugen erwartete Resource-Errors.
Nur ignorierte synthetic/disposable Artefakte; keine Mobilprüfung.

Die Systemstatistik zählte bisher `processing`, aber nicht den aktuellen
Workerzustand `converting`. Der kausale Test zählt beide sowie queued und
downloading, ohne historische Zeilen umzudeuten. Der gemeinsame SAB-Owner
begrenzt ausschließlich Reads auf drei Sekunden. Die erweiterte Imageprobe
fand einen hängenden Read über eine bestehende Verbindung zum angehaltenen
PG-Server; ein bloßer Exceptioncatch genügte nicht. Timeout ergibt generischen
500 statt leerem Erfolg. Prisma kann den bestehenden Read dort nicht
abbrechen; dessen spätere Antwort wird ignoriert. Mutationen erhalten bewusst
keinen solchen Timeout/Retryvertrag, weil ihr ACK unsicher sein könnte.
Fake-Timer-Regressionen prüfen alle vier Readmodi auf beiden URLs, die exakte
Deadline und Timercleanup. Health prüft Queue statt statischem Versionserfolg.

Der vollständige Medienharness ergänzt echte Newznab-RSS→Enclosure→NZB→
Queue→lokal geprüfte Datei→SAB-History auf beiden nativen Backends und
beiden Newznabadressen. Seine Quelle ist ein streng DB-/Owner-gebundener
Preload mit externer Fetchsperre. Zwei Harnessfehler wurden kausal korrigiert:
Next bündelt xml2js statt eines Node-require-Moduls im Runner; Parsing nutzt
deshalb gelockte npm-ci-Dependencies. Die öffentliche Testadresse wird explizit
auf eigene Loopback gesetzt, nicht aus einem internen Next-Host geraten.
Lokale Probe mit altem P09-Image bestand für SQLite und die PG-Medienkette,
scheiterte aber am noch unbegrenzten PG-Ausfallread; sie ist kein aktueller
grüner Gesamtgate. Die vollständige neue Imageabnahme muss den Checkpoint mit
Readdeadline prüfen. Fork-CI/Docker 36801029863/36801029824 waren für den
vorherigen Health-/Historycheckpoint grün, nicht bereits dieser neue Nachweis.

P10.1 bleibt bis zur aktuellen vollständigen Forkprobe offen. Echte
Arr-Instanzen, private Pfadmappings und Produktions-Cutover sind weiterhin
separate Freigabegates. P11.9 wurde nach P09 erneut auf Aufwand geprüft und
bleibt ausdrücklich optional zurückgestellt, nicht als durchgeführt markiert.

Abschließende Abnahme: Produktcheckpoint `8de3148aade50de88bfe71ca374e4076c5be5260`
ist im eigenen Fork verifiziert. CI 36802563431 und Dockerprobe 36802563450
sind vollständig grün, einschließlich beider Quellvarianten mit TLS und
Rollback, isolierter SQLite-Persistenz und vollständiger Medien-/Ausfallkette
auf beiden Backends. Lokal 830 reguläre Tests (12 DB-konditionale Tests separat
ausgeführt), 15 native DB-Testausführungen, Lint, Typecheck, Format und Build
bestanden. P10.1 ist damit abgenommen; die zuvor genannten offenen Imagegates
sind geschlossen. Die ergänzte Readdeadline wurde im realen PG-Ausfall geprüft.
UI-Evidenz wird wiederverwendet: spätere Änderungen betreffen nur SAB-Reads,
Systemstatistik und Testharness, nicht die geprüfte UI. Eigene Desktoplaufzeit
und Browser beendet; fremde Container unverändert. Keine offenen Findings
innerhalb der beauftragten synthetischen Entwicklungsabnahme. Tatsächliche
Arr-Interoperabilität und P10.2–P10.7 bleiben unfreigegebene externe/betriebliche
Gates; P11.9 bleibt ausdrücklich optional zurückgestellt.

## Genehmigtes Arr-Testsetup und neuer Verbraucherbefund (01.10.2026)

Vier eigene lokale Container im internen Docker-Netz eingerichtet, mit eigener
Pingufunk-SQLite-Datei und getrennten privaten Arr-Konfigurationen. Tatsächliche
Versionen: Sonarr 4.0.20.3014, Radarr 6.4.4.10685, Prowlarr 2.6.5.5623.
Images und Mounts werden bei APIoperationen gegen das eigene Manifest geprüft;
keine fremden Container oder Produktion. Native Sonarr-Newznab/SAB-,
Radarr-SAB- und Prowlarr-Newznab-Tests bestanden. Prowlarr benötigte seinen
tatsächlichen AppProfileId, nicht eine erratene Konstante. Der erste Versuch mit
Hostports im internen Netz wurde gezielt gestoppt; Controllerzugriffe erfolgen
jetzt per stdin aus dem eigenen Container. Secrets nicht in argv/URL/Git.

Radarr-Newznab schlägt reproduzierbar mit HTTP 400 fehl: erfolgreiche Anfrage,
aber keine Ergebnisse in den Filmkategorien. Der native Movie-Recent-Owner
liefert ohne optionalen Filmkontext absichtlich leer. Dies ist kein
scheinbarer API-Erfolg und kein Anlass, einen Film zur Einrichtung zu erfinden.
P10.1 wurde für den tatsächlichen Setupvertrag wieder geöffnet. Noch kein
gespeicherter Indexer/Downloadclient, keine Weiterleitung über Prowlarr, kein
Grab oder Import attestiert. Aufbau, Stopcommand und Grenzen unter
`docs/arr-test-instances.md`. Produktcode, Main und Produktion unverändert;
vorhandene synthetische Produkt-/DB-/UI-Gates bleiben gültig.

## Erweiterte Verbraucherabnahme (02.10.2026)

Deaktivierte Radarr-Neuanlage plus unterstütztes `forceSave`-Update belegt;
der separate Empty-Feed-Test bleibt ehrlich HTTP 400. Keine erfundenen Filme,
obligatorischen Metadaten-Credentials oder zusätzlichen Pingufunk-Endpunkte.
Native direkte/vermittelte Film-/Episodensuche, echte manuelle Arr-Aufnahme
über Release→NZB→SAB→Completed→Import und native Quellhistoryentfernung bei
erhaltener physischer Importdatei bestanden. Die frische vermittelte Wiederholung
lief in einem eigenen Archivcheckout auf dem bekannten Entwicklungsrechner,
nicht in vorhandenen Checkouts. Falsche Keys ergeben 401, Fremdsuchen sind leer
und externes Fetch bleibt gesperrt. Versionierte unüberwachte Fixtures liegen
in vor Änderung gesicherten disposable Arr-DBs, niemals in einer realen Bibliothek.
Prowlarrs automatische Application-Synchronisierung ist nicht attestiert.
Dieser zusätzliche Arr-Lauf verwendet SQLite; frühere unveränderte native PG-
und UI-Evidenz wird wiederverwendet, kein erneuter Arr-plus-PG-Lauf behauptet.

Ein frischer Harnesslauf fand punktierte Scene-Suchbegriffe, die der ursprüngliche
QA-Quellfilter nicht berücksichtigte. Der Fixtureowner normalisiert jetzt Zeichen
und prüft alle tatsächlichen Suchterms gegen die synthetische Quellzeile;
positive und fremde negative Anfragen schützen das Verhalten. Kein Produktmatching
wurde gelockert. Einzelne aktivierte Transportwege verhindern eine falsche
Zwei-Ergebnisse-Erwartung für vom Consumer deduplizierte identische GUIDs.
Commands und Setupgrenzen stehen in `arr-test-instances.md`.

### Offener Security-/Releasebefund

Frisches `npm ci` des unveränderten Lockfiles und `npm audit --json` melden
am 02.10.2026 **26 Paketbefunde: 3 critical, 17 high, 5 moderate, 1 low**.
Transitive Metabefunde sind enthalten; kein Nachweis von 26 unabhängigen Exploits.
Gelockt: Next 16.1.6, Vitest/Coverage 4.0.18, Prisma 6.19.2, PostCSS 8.5.6,
AJV 8.17.1. Next betrifft Runtime/Standalone/Bildoptimierung (`next/image`
in der Desktop-Sidebar); Vitest/Coverage und CSS-/ESLint-Tools sind Test/Build.
Prisma CLI/Config betrifft Generatoren beider Clients und den Migrator.
Kein Vitest-UI-Server wurde gestartet.

Maintainerquellen bestätigen den
[Next-AVIF/libheif-Befund](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4)
für die gelockte Version (korrigierter 16er-Stand: 16.3.3) und den
[Vitest-UI-Befund](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp),
der einen lauschenden UI-Server voraussetzt, nicht `vitest run`. Das entkräftet
nicht sämtliche transitiven Befunde. Eine Ausnutzung der Installation ist nicht
nachgewiesen. Der npm-Prisma-Vorschlag 6.12.0 wäre ein Downgrade, kein blind
anwendbarer Fix. Kein `audit fix --force`, Lockfileupdate oder Majorwechsel.

Owner: P10.2, Package/Lockfile, Next-Konfiguration, Vitest und Prisma-Generator-
und Migratorpfade. Vor Release/Nutzer-Rollout ist ein separat freigegebener
Security-/Kompatibilitätscheckpoint mit primärquellengeprüften Fixversionen,
beiden Clients und betroffenen Produkt-/DB-/Build-/Desktop-/Arr-Gates nötig.
Die funktionale P10.1-Abnahme schließt diesen Befund nicht. Kein Live-Zugriff
wird vorausgesetzt oder angefragt; späterer Rollout bleibt nutzergeführt.

### CI-Nachprüfung der Verbraucherabnahme (02.10.2026)

Der erste Fork-CI-Lauf für `b4655e4` scheiterte nicht an einer fachlichen
Assertion, sondern an zwei 5-Sekunden-Testlimits: Bootstrap-Baseline und
migrierte SQLite-Runtime starten echte Prisma-CLI-Prozesse. Der separate
PostgreSQL-Job bestand. Beide parametrisierten Integrationstestgruppen erhalten
ein explizites äußeres Budget von 60 Sekunden; Unterprozessgrenzen, sämtliche
Preservation-/Negativassertions und Teardown bleiben unverändert. Keine globale
Timeoutlockerung, kein Skip und keine Abschwächung des Datenvertrags.
Erneut lokal ausgeführt: zehn fokussierte Tests sowie 830 reguläre Tests grün;
die zwölf bedingten DB-Tests werden nicht als hier ausgeführte PG-Tests gezählt.
Der neue Fork-CI-Lauf bleibt bis zur tatsächlichen Ausführung ein eigener Gate.

### Autorisierter Sicherheitscheckpoint (02.10.2026)

Der Nutzer hat die gezielte Behebung und Aktualisierung freigegeben. Next,
`@next/env` und `eslint-config-next` sind gemeinsam auf 16.3.8 gepinnt;
Vitest/Coverage auf 4.1.11 und Prisma CLI/Client gemeinsam auf 6.19.3.
PostCSS 8.5.28 und AJV 8.20.0 sowie die betroffenen transitiven Abhängigkeiten
wurden mit npm im Lockfile aktualisiert. Keine pauschale Latest-/Force-Aktion,
kein Prisma-Majorwechsel oder Downgrade. Vite 8 ist der von Vitest ausdrücklich
akzeptierte Test-Consumer; die Produktlaufzeit nutzt Next, nicht Vite.

Primärquellen: [Next-AVIF-Advisory](https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4),
[Vitest-UI-Advisory](https://github.com/vitest-dev/vitest/security/advisories/GHSA-5xrq-8626-4rwp)
und [Deepmerge-Rekursions-Advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).
Prisma 6.19.3 verlangt weiterhin Deepmerge 7.1.5. Der ausschließlich auf
`@prisma/config` begrenzte Override 8.0.2 erhält den Prisma-6-Vertrag und wird
durch echten c12-Konfigurationsload sowie eine rekursive Merge-Regression geprüft.
Bei einer passenden korrigierten Prisma-Abhängigkeit den Override erneut prüfen
und entfernen; er ist keine allgemeine Freigabe beliebiger transitiver Majors.

Frisches `npm ci`: beide Clients generiert, vollständiger und Production-only
`npm audit` jeweils null Befunde. Dies ist kein Exploit- oder vollständiger
OCI-Sicherheitsnachweis. Lokal neu ausgeführt: 832 Tests, Lint, Typecheck,
Formatcheck und Produktionsbuild erfolgreich. `downloads/` ist ein ignorierter
Daten-/QA-Artefaktbereich, kein zweites TS-Projekt: Der Typecheck schließt ihn
jetzt aus, statt archivierte alte Next-Typen mit der aktuellen Anwendung zu mischen.
Produktquellen und eigentliche Tests bleiben enthalten; SQL unverändert.

Vite weist auf einen künftig anderen Configloader hin; Next meldet dynamische
Dateitracingstellen in generiertem Prisma-Code und Medienprozessen. Diese
Warnungen werden nicht unterdrückt oder durch Editieren generierter Clients
kaschiert. Der Docker-Buildkontext schließt private Daten/Environmentfiles aus.
Native PostgreSQL-Nachprüfung auf einem isolierten Entwicklungsrechner:
15 Ausführungen einschließlich Runtime, Reconnect, verweigerter Writes,
Medienabschluss und Import bestanden. Neue Node-24-Runner-/Migratorimages
wurden gebaut, nicht veröffentlicht. Mit diesem Runner bestanden direkte
und vermittelte Sonarr-/Radarr-Suchen, Prowlarr-Positiv-/Fremdfälle sowie die
vermittelten Film- und Episodenketten bis zum nativen Import und zur
Quellhistoryentfernung bei erhaltener physischer Importdatei. Diese Arr-Probe
verwendet SQLite; sie ist kein Arr-plus-PostgreSQL-Nachweis. Alle vier eigenen
Testcontainer wurden anschließend gestoppt, Fixtures und Backups erhalten.

Eine erste Radarr-Suche direkt nach Fixturestart lieferte null Ergebnisse;
die spätere identische Suche bestand ohne Produktänderung. Eine Startphase
ist als Ursache nicht bewiesen. Kein Retry oder abgeschwächter Test kaschiert
diesen Harness-/Timingbefund; vor einer künftigen Arr-Probe Startbereitschaft
erneut untersuchen. Der leere Radarr-Indexertest bleibt ehrlich HTTP 400.

Desktopnachprüfung am tatsächlich servierten Next-16.3.8-Bundle: acht Routen
(Settings, Suche, Filme, Shows, Downloads, Rulesets, Setup, Logs) in Light,
1440×1000, mit 16 selbst geprüften passenden Vorher-/Nachher-Screenshots.
Die Vergleichsbasis wurde aus dem exakten Vorcheckpoint `fad9311` gebaut;
ein älteres QA-Archiv wurde als unpassende Basis verworfen. Keine beobachtete
Layoutregression. Matching-Präferenz geändert, gespeichert, nach Reload und
echtem API-Readback erhalten; beide Browserkonsolen ohne Fehler. Ausschließlich
synthetische disposable SQLite-Daten, externe Serverfetches gesperrt, keine
Mobilprüfung oder echten Suchen/Downloads. Eigene Browser und Server beendet.

[Fork-CI 37061130068](https://github.com/superions/pingufunk/actions/runs/37061130068)
für `04d6b95` erfolgreich, einschließlich nativer PostgreSQL-Gates.
Die erste Dockerprobe deckte einen veralteten Harnessvertrag auf: der Preflight
erwartete fest 6.19.2. Er verlangt jetzt weiterhin den exakten Client, liest
aber dessen geprüften exakten Prisma-6-Pin aus dem Projektmanifest. Kein
Major-only-Vergleich und keine Abschwächung anderer TLS-/Datenassertions.
[Dockerprobe 37061129957](https://github.com/superions/pingufunk/actions/runs/37061129957)
für `04d6b95` erfolgreich: Runner, Migrator und isolierte historische
Rollbackcheckpoints gebaut; TLS-Migration, post-write Rollback,
SQLite-Persistenz und tatsächlicher Medienabschluss auf beiden Backends
bestanden, ohne Imagepublikation. Für den abschließenden reinen
Dokumentationscheckpoint wird diese unveränderte Produkt-/Dependency-/
Harness-Evidenz wiederverwendet, nicht als neue Ausführung ausgegeben.
Historische Rollbackimages werden nur als isolierte Testinputs verwendet;
deren alte Abhängigkeiten sind keine Sicherheitsfreigabe für einen Rollout.
Release/Rollout und installationsbezogene OCI-/Scanpolicy bleiben gesperrt.

## Lokale technische Abnahme (03.10.2026)

**Entscheidung: technische lokale Testabnahme bestanden.** Geprüft wurde eine
eigene persistente Entwicklungsinstallation aus Main `0c139f3`, getrennt von
Produktion und anderen Checkouts. Runner-Image-ID:
`sha256:fed7da718381877edb07d5bd9f1edcdca9a76a66270b5c41b6dcdcc5473e7b4c`.
Die tatsächlichen APIs bestätigen Sonarr **4.0.20.3014**, Radarr **6.4.4.10685**
und Prowlarr **2.6.5.5623**. Private Pfade, Hostadressen, Testkeys und Rohantworten
bleiben in ignorierten lokalen Betriebsunterlagen, nicht in diesem Repository.

Frisch ausgeführte Nachweise:

- Alle vier eigenen synthetischen Testcontainer einzeln explizit neu gestartet;
  begrenzte API-Readinessprüfung bestanden. Persistente Settings, jeweils zwei
  direkte/vermittelte Indexer und der SAB-Client erhalten. Automatische
  Beschaffung und RSS bleiben deaktiviert; Fixtures sind unüberwacht.
- Bereits importierte synthetische Film-/Episodendateien vor/nach Restart über
  tatsächliche Arr-Datei-IDs und physische Größe/SHA-256 identisch. Es wurden
  dabei keine neuen Grabs ausgelöst.
- Native direkte und über Prowlarr vermittelte Film-/Episodensuche nach Restart:
  jeweils ein erwarteter Treffer; Fremdsuche leer, falsche Keys 401,
  externe Fetchziele gesperrt. Kein automatischer Prowlarr-Application-Sync-Test.
- Serviertes RSS→NZB: beide bestehenden Newznab-Aliase gleich, generische
  Film-/Episodentreffer sprachlich neutral, aktuelle Medien-URL im NZB erhalten,
  NZB-Titel konsistent mit RSS. Negative Suche und Folgeseite leer. Film-RSS
  ohne optionalen Filmkontext bleibt ehrlich leer, nicht als erfolgreicher
  nativer Radarr-Verbindungstest ausgegeben.
- Desktop-Interaktion: positive/negative Suche, Matching-Checkbox ändern,
  speichern, API-Readback und Reload belegen Persistenz. Ausgangswert anschließend
  wiederhergestellt und per API bestätigt; Browserkonsole ohne Fehler.
  Tatsächlich servierter Desktopzustand visuell geprüft, keine Mobiltests.
- Alle vier synthetischen SQLite-DBs: `PRAGMA integrity_check` erfolgreich;
  Pingufunk mit fünf abgeschlossenen Migrationen und ohne aktive Downloadqueue.
- Separate schreibgesperrte Katalog-Vorschau: echte MediathekView-Suche liefert
  fünf quellengestützte Tatort-Kandidaten. Beide Download-API-Wege und Settings-
  Write lehnen mit 503 ab; Queue/History leer. Nach eigenem Restart SQLite
  integer, keine Downloads und kein gespeicherter abgewiesener Settings-Key.
  Keine echten Medien heruntergeladen oder Live-Bibliotheken angesprochen.
- `npm audit` und `npm audit --omit=dev`: jeweils null Befunde.

Wiederverwendete, unveränderte Evidenz, keine neue Vollausführung:

- Vorheriger Lauf auf **demselben Main-Image**: native vermittelte synthetische
  Film-/Episodenketten Release→NZB→SAB→Completed→Import sowie native
  Quellhistoryentfernung bei erhaltener physischer Datei.
- [Main-CI](https://github.com/superions/pingufunk/actions/runs/37067874775)
  und [Docker-Validierung](https://github.com/superions/pingufunk/actions/runs/37067875012)
  für `0c139f3` erfolgreich: 832 Tests, Lint, Typecheck, Format, Build sowie
  native PG-, TLS-Migrations-, post-write-Rollback-, SQLite-Persistenz- und
  Medienabschlussgates auf beiden Backends. Keine Imagepublikation.
- Bestehende vollständige Desktop-Screenshotmatrix auf unveränderten UI-Quellen;
  dieser Lauf ergänzt die tatsächliche Bedienung und Persistenzprüfung,
  behauptet aber keine neu aufgenommene vollständige Screenshotmatrix.

Diagnoseabgrenzung: Der frühere vorübergehend leere Radarr-Suchlauf korreliert
mit dem tatsächlich gespeicherten nativen 60-Sekunden-Indexer-Cooldown nach
dem ehrlich fehlgeschlagenen Empty-Feed-Verbindungstest. Kein Status wurde
manipuliert und keine fehlgeschlagene Suchassertion heimlich wiederholt.
Nach Restart sind die gezielten Suchen erfolgreich. Zwei erste RSS/NZB-
Diagnoseassertionen hatten falsche Testtreiber-Annahmen (RSS-Medienlink versus
NZB-Enclosure und NZB-Metadatenfeld `title`); sie wurden nach Prüfung des
bestehenden Producer-/Parservertrags korrigiert, ohne Produktänderung.

Diese Abnahme bestätigt den technischen Proxy-Ersatzkandidaten in der isolierten
Installation, nicht jede reale Sendung, regionale Verfügbarkeit, automatische
Prowlarr-Application-Synchronisierung oder produktive Betriebsparameter.
SQLite-Laufzeitevidenz ersetzt nicht PostgreSQL-Evidenz; letztere stammt aus den
unveränderten grünen Gates. **P10.2–P10.7 bleiben offen.** Keine Produktions-
installation, Datenmigration, Proxy-Abschaltung, Routenumschaltung, Release-Tags
oder öffentlichen Images wurden durch diese Testabnahme freigegeben.

## Radarr-Filmkorrelation und Bibliothekslimit (03.10.2026)

P08.2/P08.4 wurden nach dem Produktbefund ausdrücklich wiedereröffnet: die
frühere synthetische Verbraucherprobe enthielt bereits ein Quelljahr und
belegte die alltägliche Metadatenkorrelation deshalb nicht. Prowlarr transportiert
Indexeranfragen, aber weder lokale Radarr-Bibliotheksmetadaten noch dessen
API-Key. Der optionale native Metadatenzugriff benötigt eigene Konfiguration.

Auf `55edcf7` erneut den vollständigen Pfad reviewt: lokale TMDB-Auflösung vor
externem Lookup, vollständiger Titel/belegter Alias, Laufzeit in Sekunden gegen
Metadatenminuten mit ±10 %, Produktionsjahr ±1 direkt gegen das Metadatenjahr,
keine kumulierten Jahresabweichungen. Fehlendes Quelljahr darf erst danach
ergänzt werden; unbekannte Dauer, Fuzzy/Clip, Konflikte und mehrdeutige RSS-
Remakes bleiben generisch. Quell-/Fassungs-GUID und aktuelle Medien-URL bleiben
erhalten. Explizite leere/null Quelllaufzeit bedeutet unbekannt, nicht bestanden;
malforme numerische Angaben bleiben Fehler. RSS-Titelindex begrenzt die
Zuordnungsarbeit, statt jedes Ziel gegen jedes Sourcefenster erneut zu parsen.

Radarr-Bibliotheksantworten erhalten ein eigenes persistentes Bodylimit:
`integration.radarr.inventoryMaxMiB`, Default 10, ganze MiB 1–64. Ungültige
Werte scheitern vor Credential-/HTTP-I/O; Änderungen invalidieren Bibliotheks-
und Suchcaches. Einzelne Metadatenantworten bleiben 5 MiB, Inventar höchstens
2.000 Zeilen. Kein global höherer Response-Default und kein unbeschränkter Fetch.

Abnahme: 873 reguläre Tests grün (zwölf bedingte PG-Gates separat), Lint,
Typecheck, Formatcheck, Build und diff-check bestanden; `npm ci` und Audit ohne
Befunde. [Fork-CI](https://github.com/superions/pingufunk/actions/runs/37135870734)
mit nativer PostgreSQL-Prüfung und
[Docker-Validierung](https://github.com/superions/pingufunk/actions/runs/37135870743)
mit beiden Backends/Migration/Medien/Recovery bestanden, keine Veröffentlichung.
Auf exakt diesem Runner bestätigt eine isolierte echte Radarr 6.4.4.10685 /
Prowlarr 2.6.5.5623 den jahrlosen synthetischen Quelltitel direkt und vermittelt:
korrekte Movie-ID/TMDB-ID/Jahr, keine Parse-/Unknown-Movie-Ablehnung, kein Grab.
Der erste vor nativer Indexer-Readiness leere Versuch war keine Abnahme;
die spätere begrenzte Read-only-Probe bestand alle Assertions. Eigene Instanzen
anschließend gestoppt, Konfiguration erhalten; fremde Runtimes unangetastet.

Unter separater Nutzerfreigabe wurde der lokale Runner im Homelab aktiviert,
Settings per API gespeichert/readbackgeprüft und native Filmzuordnung gelesen.
Private Betriebsparameter, tatsächliche Antworten, Secrets, Scan-/Backup-Pfade
und Rückweg bleiben im privaten Homelab-Runbook, nicht im öffentlichen Fork.
Korrekte Identität garantiert keine Freigabe durch das Arr-Sprachprofil:
unbelegte Tonsprachen bleiben neutral. Keine DB-Migration, keine Testgrabs und
keine öffentliche Imagepublikation; späterer Dokumentationscommit baut dieses
unveränderte Produktimage nicht erneut und wiederholt dessen Tests nicht.

## P03.4 — Struktureller Tonsprachenvertrag (Entwicklungsreview)

Neuer Owner `source-audio.ts`: ARTE-HbbTV mit exakter Programm-/URL-Bindung,
ZDF mit begrenztem MP4-Sound-Track-Header. Keine HTML-Parser, Konten, Fremdtoken,
Originalsprachenheuristik oder Medienvollabfrage. Rendition-Splitting verhindert
die Übertragung eines HD-Belegs auf fremdsprachige Standard-URLs. Film-ID, Text
und RSS führen die Ergänzung vor Selektion/Dedupe/Pagination durch.

Im Selbstreview wurde ein sachlicher Fehler behoben: Providerbelege dürfen
nicht durch `JSON.stringify`-Schlüsselreihenfolge verglichen werden. Der Worker
vergleicht jetzt einzelne Vertragsfelder und prüft die Dateiidentität erneut
nach dem frischen Providerabruf. v1 bleibt streng; v2 trennt Providerbeleg und
fehlende Tracktags. Beide Versionen müssen auf beiden Backends erhalten bleiben.
Cacheversion v10 vermeidet veraltete Antwortverträge; bessere Sprachbelege
ändern allein keine bisherigen Fassungs-GUIDs.

Grenzen ausdrücklich dokumentiert: höchstens vier Probeidentitäten im gemeinsamen
Budget, keine volle Katalogabdeckung und keine neue HLS-/Sender-/TV-Abdeckung.
Die alte HD-Feld-/Auflösungsannahme ist keine Sprachinvariante und bleibt ein
separates Risiko. Ältere Images ohne v2 sind nach v2-Writes kein sicherer Rollback.
Abnahme und verbleibende Gates stehen ausschließlich bei P03.4 im Phasen-TODO;
kein unabhängiger Peer-Review, produktiver Imagewechsel oder DB-Cutover behauptet.

Finaler Produktstand `1f9f18e`: zusätzlich die UTF-8-Decodierung wieder in die
absolute Bodydeadline einbezogen und kausal gegen Zeitüberschreitung getestet.
906 reguläre Tests, Lint, Typecheck, Formatcheck, Build und Diffcheck grün;
bedingte PostgreSQL-Prüfungen separat erfolgreich. v1/v2 über beide echten
disposable Backends, Queue/Restart/Retry sowie native direkte und Prowlarr-
vermittelte Radarr-Suche bestanden: Originalsprache Englisch, konkreter
Release German, korrekte Film-ID/Jahr; kein Grab. Anlaufversuche ohne Kandidat
waren keine Abnahme; der spätere assertierte Lauf bestand. Eigene Instanzen
gestoppt, Konfiguration erhalten, andere Instanzen unangetastet.
[CI](https://github.com/superions/pingufunk/actions/runs/37142390426) und
[Docker-Abnahme](https://github.com/superions/pingufunk/actions/runs/37142390422)
auf diesem Produktstand bestanden ohne Veröffentlichung. P03.4 ist als
Entwicklungsabnahme geschlossen, nicht als produktiver Wechsel. Der separate
HD-Feld-/Auflösungsbefund ist als P09.3 offen erfasst; keine stillschweigende
Gesamtabnahme aller Qualitätszusagen.

### MP4-Nachprüfung: große Sampletabellen

Die bisherige begrenzte Probe verlangte einen vollständigen `moov` im
Rangefenster. Große Sampletabellen verhinderten daher erreichbare Sound-
Trackbelege. P03.4 wurde für diese Nachprüfung wieder geöffnet, nicht durch
Sprachheuristik oder größere Antwortlimits umgangen. `00b2ce3` liest nur
deklarierte, innerhalb ihrer Eltern und der unveränderten Dateilänge liegende
Boxgrenzen und benötigte `hdlr`/`mdhd`-Felder. Sampletabellen werden übersprungen.
Alle Trackheader müssen erreichbar sein; ein drittes nötiges Fenster bleibt
unbekannt. Höchstens zwei 1-MiB-Antworten, 4.096 Header und gemeinsame Deadline;
keine Zeichenkettensuche in Medienbytes, Remote-ffprobe oder Vollabfrage.

Synthetische große Video-/Audio-Sampletabellen, DE/FR, gemischte/unklare weitere
Spuren, Elternüberlauf, mdhd-Versionen und Deadline nach finaler Sprachdecodierung
sind kausal geprüft. Nach Behebung eines Testfixture-Typfehlers bestanden
917 reguläre Tests, Lint, Typecheck, Formatcheck, Build und Diffcheck; unveränderte
Turbopack-Tracingwarnungen bleiben sichtbar. Aktuelle
[CI](https://github.com/superions/pingufunk/actions/runs/37146674348) und
[Docker-/Backend-Gates](https://github.com/superions/pingufunk/actions/runs/37146674264)
grün. Echte isolierte native Radarr-/Prowlarr-Verbraucher auf dem neuen Runner
prüften German trotz englischer Originalsprache direkt und vermittelt, ohne
Grab; Auth-/Netzwerkgrenzen ebenfalls grün. Ein vorheriger Readinessfehler war
keine Abnahme. Eigene QA gestoppt, Daten erhalten. Schema, v1/v2-Payloads und
Worker unverändert; keine neue DB-Migration oder öffentliche Veröffentlichung.
Private Betriebsabnahme und echte Importdaten bleiben im Homelab-Runbook.

### Nachprüfung: auseinanderliegende Track-Trailer

Der größere `moov` allein war nicht die vollständige Ursache. Zusätzlich
entfernte Trailer nach großen Sampletabellen können weitere Headerfenster
benötigen. Auch eine tiefenorientierte Reihenfolge garantiert dann nicht, dass
alle Trackgrenzen in zwei Bereichen liegen. Die sichere Unknown-Antwort darf
nicht durch das Überspringen möglicher weiterer `mdia`-/Audiotracks ersetzt
werden. Die bestehenden Tests und die native ARTE-Verbraucherabnahme bleiben
gültig, belegen aber diese MP4-Struktur nicht. P03.4 ist deshalb erneut offen;
synthetische Trailer-Regression und begrenzte Leseplanung bzw. ehrliche
Abdeckungsgrenze sind beim bestehenden Owner zu bearbeiten. Keine privaten
Quellantworten oder operatorseitigen Einzelgrabs als Produktfixture/Abnahme.

## P09.4 — Secret-sichere progressive Transferdiagnose

Der explizite Diagnose-/Reproduktionsauftrag ergänzt den bestehenden
`download-manager.ts`-Owner, keine zweite Downloadpipeline. Upstream main
`e62ed90` wurde frisch geprüft: dort werden rohe Transferausnahmen ausgegeben;
ein gleichwertiger geschlossener secret-sicherer Diagnosevertrag ist nicht
vorhanden. Diese Rohfehlerausgabe wird nicht in den Fork übernommen.

Der bisherige Boolean verliert nun keine gesamte Fehlerphase mehr:
ein typisierter Transferbeleg unterscheidet Request/Response, Open/Write/Finish,
Body-Read und Fortschrittspersistenz. Geschlossene Code-Allowlist mit vier
Cause-Ebenen; keinerlei Message/Stack/URL/Dateipfad/Response-/Prisma-Metadaten.
Eine durch Dateifehler ausgelöste Reader-Abortion behält die Dateiphase.
Inaktivität während eines DB-Callbacks wird nicht zum Netzwerkbeweis umgedeutet.
Zuverlässige Content-Length und dekodierte Gzip-Bytes bleiben getrennt.
Das bestehende Error-Textfeld und SAB-History tragen denselben safe Vertrag;
DB-Ausfall/Reconnect darf ihn nicht zu einem generischen Folgefehler verlieren.
Keine Schemamigration, neue Retries oder Änderung der Inaktivitätsdauer.

Native Loopback-HTTP-Tests reproduzieren einen tatsächlichen Socket-Abbruch nach
Byteempfang, Redirect-Ablehnung ohne Zielabruf, Gzip sowie gültige Dateiübertragung.
Gezielte DB-/Write-/Open-Race-/Timer-/Längen-Faults schützen Fehlerphase,
Secret-Negativfälle, Partialbereinigung, Nachbarfileerhalt und Queuefortsetzung.
Die DB und Medienprobe dieses Transferharness sind gemockt; dies ist weder eine
neue Medienabnahme noch der Beweis einer historischen Produktionsursache.
Reproduktionsvertrag und Grenzen: `docs/download-failure-diagnostics.md`.
Produktive Dienste, Quellen, Bibliothek und bestehende Aufträge bleiben
unangetastet. P03.4 und P09.3 bleiben unabhängig offen.

Lokale Entwicklungs-Gates: nach `npm ci` 930 reguläre Tests und 48 fokussierte
Owner-Tests; 13 PostgreSQL-Gates bedingt und lokal nicht ausgeführt. Lint,
Typecheck, Formatcheck, Build und Diffcheck bestanden mit Node 26.10.0.
Der zuerst gefundene Open-Listener-Typfehler ist behoben; relevante Gates danach
erneut grün. Bestehende 14 Turbopack-Tracingwarnungen bleiben unverändert.
[Fork-CI](https://github.com/superions/pingufunk/actions/runs/37150444785) auf
Produktstand `fc99caf` ist zusätzlich mit Node 24 erfolgreich, einschließlich
separater PostgreSQL-Integration. P09.4 entwicklungsseitig abgenommen; kein
Produktiv-Rollout oder historischer Root-Cause-Nachweis. Die automatische
Docker-Validierung ist ein eigenes Release-Gate und keine Deploymentfreigabe.

## P09.3 — Quellenauflösung und historische Slotidentität (04.10.2026)

Der neue gemeinsame Renditionowner ersetzt die drei pauschalen Katalog-
Slotstempel. Optionale strukturierte ARTE-Maße müssen an die exakte Medien-URL
gebunden sein; fehlende, fremde und widersprüchliche Angaben bleiben unbekannt.
Keine zusätzlichen Probeabfragen oder Senderseiten. Audiosprache und Maße
werden getrennt klassifiziert. Ein 720p-Beleg im HD-Slot produziert 720p,
nicht 1080p; Unbekannt erhält keine SD-/HD-Unterkategorie und keinen WEB-Hint,
den Arr selbst als SD lesen würde. Der [Auflösungsvertrag](rendition-quality-contract.md)
benennt bewusst begrenzte Abdeckung und die alte Auswahlhinweis-Semantik.

Nachreview: dieselbe URL in HD-/Standard-Slots erst **nach** konkreter Auswahl
deduplizieren, damit unbekannte Standardfassung weiter auswählbar bleibt.
UI-NZB erwartete zuvor die Default-URL statt der angeklickten Rendition;
jetzt tragen alle NZBs nur die jeweiligen Maße. Bestehende v1/v2-Verträge
prüfen lokale Breite **und** Höhe vor Completed. Die historischen Slot-GUIDs
bleiben erhalten; neue Dimensionsbelege allein erzeugen keine neue Identität.
Keine Altdateien, History, Profile oder gespeicherten Jobs umschreiben.

Lokale Gates nach `npm ci` mit Node 26.10.0 bestanden: 965 reguläre Tests,
Lint, Typecheck, Formatcheck, Build und Diffcheck. 13 bedingte PostgreSQL-Tests
werden lokal übersprungen; der gesonderte
[Fork-CI-Lauf](https://github.com/superions/pingufunk/actions/runs/37167389069)
auf `38836c5` ist mit Node 24 einschließlich PostgreSQL-Integration erfolgreich.

Der native Qualitätsgate auf demselben Runnerstand ist bestanden: Radarr
6.4.4.10685 direkt und durch Prowlarr 2.6.5.5623 klassifiziert den HD-Slot mit
1280×720 als `WEBDL-720p`, fehlende oder widersprüchliche Maße als `Unknown`.
Sonarr 4.0.20.3014 prüft jeweils den tatsächlichen Producer-Qualitätssuffix
über seinen nativen Parser, nicht eine lokale Parserkopie. Filmzuordnung,
TMDB-ID/Jahr und unabhängiger deutscher Tonsprachenbeleg bleiben erhalten.
Alle drei Varianten laufen in neu angelegten internen Testnetzen; kein Grab.
Das ist kein neuer vollständiger Sonarr-Importnachweis.

Die vollständige
[Docker-Validierung](https://github.com/superions/pingufunk/actions/runs/37167389065)
für `38836c5` ist ebenfalls erfolgreich, ohne Image-Publikation. Eine real
erzeugte 1280×720-Datei besteht mit passenden Sollmaßen; abweichende Sollmaße
1920×1080 sowie 1920×720 werden vor Completed abgewiesen. Die Unit-Regressionen
prüfen auch den umgekehrten Fall abweichender lokaler Maße. Beide disposable Backends prüfen
die echte Datei/SAB-History und erhalten die v1/v2-Erwartungen über Restart und
Retry. Bestehende TLS-Migrations-/post-write-Rollback-, SQLite-Persistenz- und
PG-Ausfallgates bleiben grün. P09.3 ist entwicklungsseitig abgenommen.

Die ersten Treiberläufe wurden **nicht** als Abnahme gewertet: Prozessstart
war noch keine API-Readiness, ID-Suchen brauchen den eigenen verifizierten
Radarr-Metadatenkontext, und der absichtlich fehlgeschlagene Empty-Feed-Test
kann einen nativen Indexer-Cooldown hinterlassen. Der Treiber wartet nun
begrenzt und lesend auf tatsächliche API-Readiness und Cooldownablauf. Kein
Indexerstatus wird gelöscht, keine fehlgeschlagene Suchassertion wiederholt
und keine Assertion für ein grünes Ergebnis abgeschwächt.

Dimensionsabdeckung bleibt auf bereits gelesene, passende strukturierte
ARTE-Maße begrenzt. Unbekannte Fassungen dürfen weiterhin über den historischen
Slot-Auswahlhinweis sichtbar bleiben; dieser ist kein Mindestauflösungsfilter.
Korrigierte konkrete Auswahl oder `best` kann eine andere vorhandene URL
sichtbar machen; stabile GUIDs allein verhindern kein Upgrade gegenüber einer
bereits geladenen Fassung. Profile/Auswahl/History vor einem gesonderten Rollout
gemeinsam prüfen. P03.4s MP4-Sprachbefund ist unabhängig; keine Produktivfreigabe
oder vollständige Sprachabdeckung behauptet.

## Autorisierte Betriebsumschaltung und nachfolgender PG-Halt (03.10.2026)

Nach gesonderter Nutzerfreigabe: Proxy-Ausstieg zuerst auf SQLite, PostgreSQL
danach; ausschließlich lokal übertragene Images. Betriebswerte, Geheimdateien,
Backups und tatsächliche Controllerrevisionen stehen ausschließlich im privaten
Betriebsrunbook, nicht in diesem öffentlichen Fork.

- OCI-Hardening `23ad4b1`: globales npm/npx aus Runtime und Migrator entfernt,
  nicht aus Buildstages. Frische exakte Archivscans einschließlich ungefixter
  HIGH/CRITICAL auf unterstütztem Alpine ohne Findings. Kein Lockfilewechsel.
  [CI](https://github.com/superions/pingufunk/actions/runs/37075947430) und
  [Dockerprüfung](https://github.com/superions/pingufunk/actions/runs/37075947435)
  erfolgreich, einschließlich nativer SQLite-/PG-/TLS-/Rollbackgates.
- Legacy-SQLite mit leerem Ledger über den geprüften Baselineowner in eine
  separate Datei überführt, nie neue App gegen die alte Bootstrapdatei gestartet.
  Sechs Modelle erhalten; Original und finaler Snapshot zeilenweise gleich.
  Aktive Datei integrity_check `ok`, keine FK-Verletzungen, fünf Migrationen,
  zwei weiterhin abgeschlossene Downloads. Nur zwei neue Integration-Settings.
- Prowlarr-Indexer und alle drei SAB-Verbindungstests bestanden; vorhandene
  Consumer-IDs/Keys, Pfade und Kategorien erhalten. Native Adressen und originale
  Such-/Enableflags nach Freigabe per API verifiziert. Prowlarr-Synchronisierung
  reaktivierte zwischenzeitlich Sonarr-Suchflags: deaktivierte Downloadclients
  schützen die Prüfung; ein einzelner Arr-PUT beweist keine dauerhafte Sperre.
- Die bisher proxyseitige verifizierte Identität `Solo for Weiss` / `Solo für
Weiss`, TVDB 319457, über den bestehenden Katalogmechanismus übernommen,
  ohne erfundene Episoden oder Audio-Sprachbelege. [TVDB](https://thetvdb.com/series/319457-show)
  bestätigt die Serienidentität. `1ec873e`: Datenvalidator und 58 fokussierte
  Tests bestanden; [CI](https://github.com/superions/pingufunk/actions/runs/37078325186)
  und [Dockerprüfung](https://github.com/superions/pingufunk/actions/runs/37078325198)
  grün. Lokale Katalogdatei und gepinnte URL decken RSS-Erststart und Suche ab.
- Echte native S02E01-Suche liefert Blackout. Sonarr-Interactive-API erkennt
  Staffel/Folge und verweigert den erneuten Download wegen vorhandener Datei.
  Negative Textsuche leer; unbekannte ID fail-closed 503. Keine produktiven
  Testgrabs, keine neue vollständige Desktopmatrix behauptet. Vorherige
  synthetische vollständige Import- und Desktopnachweise bleiben wiederverwendet.
- Native App und übrige Media-Services laufen; Proxy bleibt bei null Replikaten
  erhalten. Keine physische Proxyentfernung oder Daten-/Backupbereinigung.

Verbleibende Betriebsgrenzen: täglicher Registry-only-Scanner kann lokale Tags
nicht auflösen; frischer Archivscan ist keine dauerhafte Überwachung. Historische
Rollbackarchive brauchen vor neuem Start die aktuelle Imagepolicy. PostgreSQL-
Preflight fand einen gesunden unterstützten Primary, aber `ssl=off`; die
implementierte CLI fordert TLS. Keine PG-Rolle/DB, DDL, Datenübernahme oder
Secretanlage ausgeführt. Änderung am gemeinsamen Cluster erfordert separat
reviewte Infrastrukturfreigabe; kein TLS-Bypass. P10.2–P10.7 bleiben wegen ihrer
jeweils noch offenen Betriebs-/PG-/Beobachtungs-/Entfernungsgates ehrlich offen.

## Expliziter PostgreSQL-Klartexttransport (03.10.2026)

Auf Nutzerentscheidung ist TLS kein zwingender Installationsvertrag mehr:
`sslmode=disable` in derselben geschützten App-/Runner-URL wählt ausdrücklich
Klartext. Ohne Parameter bleibt die Migration TLS-pflichtig; `require` erzwingt
TLS, `prefer` ist kein Cutovermodus. Doppelte/ungültige Werte brechen ab.
Keine Netz-/HAProxy-Sonderannahme, kein Downgrade nach Verbindungsfehler und
kein PostgreSQL→SQLite-Fallback. Der Runtime-Resolver erhält die gewählte
Prisma-Option; bestehende Laufzeitdefaults werden nicht heimlich umgeschrieben.

Review: Preflight, DDL-Vorbereitung, Import und Wiederaufnahme sowie tatsächliche
Sequence-Transaktion benutzen denselben Transportowner. Der Standalone-
Preflight löst jetzt ebenfalls Secret-Dateien auf. Tatsächliche TLS-Eigenschaft
bleibt Bestandteil der Runidentität; Helperinhalt gehört zum Importerhash.
Primary-, Versions-, Rollen-, Schema-, Fidelity- und Rollbackprüfungen bleiben
unverändert. Ein TLS-Backend trotz explizitem `disable` wird ebenso abgelehnt.

Neue Evidenz: `npm ci`, 842 reguläre Tests (zwölf separate PG-Gates im normalen
Lauf nicht aktiviert), Lint, Typecheck, Formatcheck und Build bestanden.
Vollständiger disposable PG-Harness auf dem Entwicklungshost anschließend
grün: 15 Tests, einschließlich Bootstrap/current-Import, echte CLI prepare/
import/verify/sequences ohne internen TLS-Testoverride, secret-backed Preflight,
verweigerter `require`-Verbindung am TLS-losen Server, Persistenz/Write-Gate und
Reconnect. Der zusätzliche Test hatte zunächst einen TypeScript-Env-Typfehler;
in `96e3082` korrigiert und Typecheck erneut bestanden.
[Aktueller Fork-CI-Lauf](https://github.com/superions/pingufunk/actions/runs/37129277696)
erfolgreich. Docker-/TLS-Containerprüfung `37129277596` zum Zeitpunkt dieses
Nachtrags noch laufend; nicht als frisch bestanden behauptet. Vorherige TLS-
Containerbelege sind keine neue Containerabnahme der geänderten Skripte.

Frischer unveränderter Lockfile-Audit meldet sechs HIGH-Paketbefunde in
Entwicklungsabhängigkeiten (braces/micromatch samt ESLint-/lint-staged-Konsumenten);
`npm audit --omit=dev` null. Kein unreviewtes audit-fix/Downgrade. Build-/Migrator-
Reichweite und neue genaue Imagescans bleiben vor einem nächsten Rollout zu
prüfen. Keine Produktionsdienste, Secrets oder Datenbanken in diesem Schritt
verändert; PostgreSQL-Übernahme und reale Freigabegates bleiben offen.

Container-Nachprüfung: Der zunächst laufende Docker-Gate `37129277596` scheiterte
am fehlenden neuen Helper im expliziten Migrator-COPY. Lokaler Build zeigte
zusätzlich die fehlende Ausnahme der Script-Allowlist in `.dockerignore`.
Beide Verpackungsfehler in `1f5bfb5` korrigiert; keine geschwächte Assertion oder
blinder Retry. Danach beide tatsächlichen Images auf dem Entwicklungshost neu
gebaut und vollständige TLS-Containerprobe einschließlich Snapshot, prepare,
Import/Verify/Sequences, Maintenance, Appstart und durablem First-write-Checkpoint
erfolgreich. Immutable Post-write-Rollback nicht neu lokal ausgeführt;
dieser zusätzliche Gate bleibt im noch laufenden Docker-Forklauf.
[Fork-CI für den Verpackungsfix](https://github.com/superions/pingufunk/actions/runs/37130113142)
erfolgreich; Dockerlauf `37130113176` noch nicht abschließend bestätigt.
Auch die neue SQLite-Containerprobe bestand: Fresh Install, Bootstrap-Baseline,
gespeicherte Settings, Restart/Persistenz und fail-closed Negativfälle. Keine
produktive SQLite-Datei angesprochen und keine Testdatenbank beibehalten.

## TV-Identität und renditionsgebundene Sprache (05.10.2026)

Unter ausdrücklich freigegebenem Implementierungsauftrag wurden gemeinsame
Owner korrigiert, keine serienbezogene Titel-Allowlist angelegt:

- Sonarr: globale validierte Aliasse übernehmen, fehlendes Inventarelement
  nach frischem gefiltertem Lookup einmal nachladen, Nichtfunde nicht negativ
  cachen. Instanz-/ID-Konflikte bleiben gesperrt. Generische `Episode N`-Titel
  erfordern weiterhin exakte Serienbindung, explizite Koordinaten und belegte
  passende Soll-/Quelllaufzeit. Ein Bruchteil allein impliziert niemals S01.
- ARTE: HLS-only im geprüften Player verwirft indexierte MP4s nicht. Player-
  Identität, Titel, Koordinaten und Rechte bleiben nötig; die MP4-Tonsprache
  stammt erst aus exakten HbbTV-Programm-/URL-/Audiocode-Deklarationen.
- ARD: keine HTML-Parser, Seriencrawler oder Account-Fallbacks. Strukturierte
  Audiodeklarationen für die indexierte CRID und exakte MP4-URL sind ein
  unabhängiger Beleg, auch bei unbekannten Container-Tracktags. `main`-Stream,
  eindeutiger identischer Player, freie Rechte und übereinstimmende bekannte
  Audioarten sind nötig. Originalsprache/Locale sind kein Deutsch-Default.
  Providerstatus kann veraltete Text-Fassungsmarker ersetzen; rohe Katalogdaten
  dürfen diese internen Felder weiterhin nicht einschleusen.
- Explizit genehmigtes Budget: TV-Suche 32 Versuche, RSS/Filme zehn, überall
  15 Sekunden. MP4 höchstens vier 1-MiB-Fenster, vollständige Grenz-/Trackprüfung;
  benötigtes fünftes Fenster bleibt neutral. TV-Belegprüfung vor Sprachwahl,
  Dedupe/Pagination. Renditionsplit erhält die Bedeutung von `best`.
- `ard_media` erweitert v2; frische Workerprüfung gegen dieselbe URL/Video-ID
  und unverändert strenge lokale Medienprüfung. Kein Schema-/Backendwechsel.
  Ein altes v2-Image ohne neuen Provider ist kein kompatibler Rückweg.

Review von Parsergrenzen, Einheiten, Identität, Cachefrische, Request-/Body-
Deadline, Selektionsreihenfolge, GUIDs, Medienprobe und Persistenz durchgeführt.
Upstream `4ebaa8e8fa839fe44fa7862be0b49896385f5b49` erneut geprüft: kein
entsprechender Sonarr-/Quellenbelegowner vorhanden; nicht ungeprüft gemergt.

Neue Evidenz: `npm ci` (Audit null), **997 reguläre Tests** in 89 Dateien;
14 bedingte PG-Gates in der normalen Suite separat. Lint, Typecheck,
Formatcheck und Produktionsbuild bestanden. Build enthält vorhandene Prisma-/
yt-dlp-Tracingwarnungen, keine neue Kompatibilitätszusage daraus. Separater
vollständiger disposable PostgreSQL-Harness erfolgreich, darunter sechs reale
Legacy-/ARTE-/ARD-Persistenzfälle auf beiden Backends samt Queue/Restart/Retry.
Keine produktive Datenbank verwendet. Zwei synthetische Staffeln (sechs ARD-
Folgen und vier ARTE-Teile der zweiten Staffel) durch tatsächliche Newznab-
Handler bis RSS/NZB/Queue geprüft, inklusive Pagination und genauer Rendition.
Fremde IDs/URLs, gesperrte/mehrdeutige Player, gemischte/unbekannte Audios,
Auxiliary-Streams sowie falsche lokale Tracktags bleiben abgewiesen.

Kausaler Gegencheck: dieselben neuen Regressionen gegen unveränderte Owner
von `8c3b6c3` in separater Baseline-Kopie: zehn konkrete Fehlverhalten in fünf
Suites; bestehende 114 Fälle weiter grün. Keine Imports künstlich abgeschaltet.
Öffentliches strukturiertes ARD-JSON zusätzlich begrenzt lesend geprüft; reale
Antworten/URLs nicht als Fixtures persistiert. Der ARD-Extractor von yt-dlp
bestätigt den Strukturvertrag, dessen permissiven Deutsch-Default übernehmen
wir nicht.

**Noch keine produktive Abnahme.** P06.2/P06.3/P07.3 für die neuen Befunde
wieder geöffnet; frische Fork-CI und native Consumer-/Imageprüfung bleiben vor
erneutem Schließen nötig. P03.4 bleibt insgesamt offen. Die Unit-/Persistenz-
Gates beweisen keinen neuen Sonarr-Import, keine vollständige Sprachabdeckung
und keinen Rollout. Produktive Bibliotheken, Profile, Routen, Services und
Datenbanken in diesem Implementierungsschritt unverändert.

Nachprüfung desselben Auftrags: Der öffentliche ARTE-Gegencheck zeigte zunächst
trotz zwölf korrekter Episodenzuordnungen **null** normale Deutsch-Belege.
Ursache war der in `progressiveUrl` ausgeschlossene tatsächliche CDN-Host
`arteptweb-a.akamaihd.net`. Exakten Host ergänzt, keine `akamaihd.net`-Wildcard.
Synthetische vollständige Staffelregression auf diesen Host umgestellt;
zusätzlicher Producer-/Workercheck mit negativen Nachbardomains. Danach liefert
der begrenzte öffentliche Gegencheck vier normal-deutsche Episoden mit
begründeter Staffel; ARD mit demselben Owner sechs normal-deutsche Episoden.
Das prüft Quelle, Matching und Sprache, nicht einen produktiven Arr-Import.
Providerdimensionen der geprüften ARTE-HD-Fassung sind tatsächlich 1280×720,
nicht aus ihrem Slothinweis erfundene 1080p.

Erneute lokale Gates: **998** reguläre Tests, Lint, Typecheck, Formatcheck,
Produktionsbuild und Diffcheck grün. Backend-Persistenznachweise unverändert
wiederverwendet, weil kein Payload-/Schema-/Datenbankvertrag geändert wurde.
[Fork-CI des ersten Checkpoints](https://github.com/superions/pingufunk/actions/runs/37322690901)
auf `43b619e` bestanden einschließlich separatem PG-Harness. Dieser Beleg
ersetzt nicht die frisch erforderliche CI/Imageabnahme der CDN-Ergänzung.

## TV-Ergänzungsbefunde — frische Consumerabnahme (05.10.2026)

Für `b189bf2` sind [Fork-CI](https://github.com/superions/pingufunk/actions/runs/37323756642)
und [Docker-Validierung](https://github.com/superions/pingufunk/actions/runs/37323756720)
erfolgreich. Die separate PG-Integration und native synthetische Consumer-/
Medienprüfung auf beiden Backends ergänzen die 998 regulären lokalen Tests;
die 14 bedingten PG-Fälle werden nicht als regulär lokal ausgeführt gezählt.
Unveränderte Produktinputs erlauben Wiederverwendung von Lint/Types/Format/Build.

Nach gesonderter Homelab-Rolloutfreigabe liefert das tatsächlich servierte neue
Image in lesenden nativen Sonarr-Staffelsuchen über die bestehende Prowlarr-Route
alle sechs regulären deutschen ARD-Episoden (WEBDL-1080p) sowie alle vier
deutschen ARTE-Episoden (WEBDL-720p, mit Untertiteln), jeweils korrekt S01/Enn
und ohne Rejections. Normale ARD-Fassungen sind für jede Folge vorhanden;
zusätzliche Audiodeskriptionsfassungen bleiben als solche gekennzeichnet.
Keine Profile, Consumer-Routen oder Bibliotheksmetadaten wurden dafür geändert;
kein Grab und kein neuer produktiver Import. Quellenverfügbarkeit ist zeitlich
begrenzt, kein dauerhafter Verfügbarkeitsvertrag folgt aus diesem Zeitpunkt.

P06.2/P06.3/P07.3 sind für diese Ergänzungsbefunde erneut abgenommen. P03.4
bleibt insgesamt offen: weder zwei erfolgreich belegte Staffeln noch vier
bounded MP4-Fenster beweisen sämtliche Film-/Quellen-Sprachen. Unvollständige
Belege bleiben neutral. Privater Image-/GitOps-/Backup-/Rollbacknachweis und
laufende Betriebsfreigabe gehören ausschließlich ins private Homelab-Runbook;
dieser öffentliche Review enthält keine Instanzwerte oder realen APIantworten.

## Breite TV-Suche, TBA und ZDF-MP4-Maße (06.10.2026)

Neue Befunde in P06.4/P09.5 getrennt erfasst; ältere Abnahmen nicht als Beweis
dieser Ergänzung wiederverwendet. Ein genauer TBA-Platzhalter wurde bisher als
konkreter Titel behandelt; ein bereits geladener Basis-Platzhalter konnte zudem
die sichere Sonarr-Koordinatenzuordnung verhindern. Neue Regressionen reproduzierten
den TBA-/TBD-/To-be-announced-Fehler vor der Korrektur. Der Merge erhält Basiswerte
und markiert bestätigte Koordinaten transient; der Matcher verlangt gesicherte
Serie, vollständige Quellkoordinaten und bekannte passende Dauer. Konkrete
Titel-/Datumskonflikte bleiben gesperrt. RSS rendert den tatsächlichen Quelltitel.

Der neue TV-Abfrageowner verwendet begrenzte OR-Abfragen über verifizierte Namen
und eindeutig seriengebundene Regel-Themen. Suchtext wird nicht als Alias gespeichert;
Sammelthemen und mehrfach gebundene Themen werden nicht Identitätsbeweis. Review
ergänzte RSS-Dedupe und Regel-Fingerprint einschließlich late-response-Abbruch,
damit breitere Abfragen weder Duplikate noch alte Regelentscheidungen publizieren.
Ein benötigter fehlgeschlagener Lookup liefert keine Teilmenge. RSS-Datumsfenster
bleibt unverändert; Vorabfolgen erfordern eine separate Nutzerentscheidung.

Der bestehende ISO-BMFF-Probeowner liest kodierte Maße aus einem unterstützten
VisualSampleEntry ohne Voll-Download, Senderseitenparser oder zusätzliche Hosts.
Genau eine Videospur/Beschreibung und vollständige Grenzen sind Pflicht; Maße
und kohärente Audiosprache sind unabhängig. Vier 1-MiB-Fenster/Deadline bleiben;
Audio-only-Worker ohne neue Videoseeks. Der bestehende v1/v2-/SQLite-/PG-Vertrag,
historische GUIDs und Altjobs ändern sich nicht.

Eine synthetische ZDF-Staffel mit englischem kanonischem Namen, deutschem
Regel-Thema und zwei TBA-Episoden wird ausschließlich über das Thema gefunden.
Der tatsächliche Newznab-Handler, RSS, Pagination, NZB und Queue-Parser bestätigen
belegte S/E, deutschen Ton und echte 720p-Metadaten trotz HD-Slot. Negative
Koordinaten-/Serien-/Dauer-/konkrete Titelkonflikte, Mehrvideo, unbekannter Codec,
verschlüsselte/beschädigte Videobeschreibung und gemischte Audios bleiben geschützt.

Lokale Abnahme: Node 26.10.0, reguläres `npm ci`, **1017** Tests in 90 Suites grün;
14 bedingte PostgreSQL-Fälle nicht als lokal ausgeführt gezählt. Lint, Typecheck,
Formatcheck, Produktionsbuild und Diffcheck grün. Bestehende 14 Turbopack-Tracing-
Warnungen bleiben sichtbar. Lokal kein Docker-Daemon; frisch erforderliche native
Sonarr-TBA-Suche direkt/via Prowlarr sowie Container-/Backendgates werden durch
den Forkworkflow ausgeführt und sind vor dem Schließen der TODOs abzuwarten.
Neue QA-Fixture bleibt unüberwacht, Quellen synthetisch und externes Netz blockiert;
keine Grabs, Produktivdienste, Profile, Metadaten oder produktive DB verändert.
Kein Rollout und keine vollständige Sprach-/Importabnahme behauptet.

Review-Nachtrag: Auch der TV-Quellkandidatencache muss den Regel-Fingerprint
enthalten, weil neue Themen bereits die Abfrage ändern. Der kausale Cachetest
verlangt Wiederverwendung bei gleichem Kontext und einen echten neuen Lookup
nach Kontextwechsel. Nach dieser Korrektur **1018** lokale Tests, Lint, Typecheck,
Format und Build erneut grün. [Fork-CI auf `aefa709`](https://github.com/superions/pingufunk/actions/runs/37380855999)
inklusive separater PostgreSQL-Integration bestanden; Containerabnahme noch offen.

Begrenzter öffentlicher Quellengegencheck mit demselben neuen MP4-Probeowner:
zwei aktuelle reguläre ZDF-Folgen liefern jeweils kohärentes Deutsch und kodierte
1920×1080. Nur Range-Metadaten gelesen, keine Voll-Downloads; reale Katalog-
und Medienantworten weder persistiert noch als öffentliche Fixtures übernommen.
Das ist kein produktiver Sonarr-Treffer-, Grab- oder Importnachweis.

Finale Entwicklungsabnahme auf unverändertem Produktstand `aefa709`:
[Docker-Validierung](https://github.com/superions/pingufunk/actions/runs/37380856018)
vollständig bestanden. Native Sonarr-TBA-Suche direkt/via Prowlarr bewahrt
Metadaten, ordnet Quelle zu S01E01/German/720p zu und löst keinen Grab aus.
Native 720p-/UNKNOWN-/Konfliktvarianten, beide Backend-/Mediengates, TLS-Migration
und Post-write-Rollback grün; keine Image-Publikation. P06.4/P09.5 geschlossen,
P03.4 und die Vorabfolgen-/Produktiventscheidung unverändert getrennt offen.
Abschließende Dokumentationsänderungen ändern keine getesteten Produktinputs;
Produkt-CI-Evidenz wird deshalb wiederverwendet, nicht als neuer Lauf ausgegeben.

Nutzerklarstellung zum separat freigegebenen Rollout (06.10.2026): Die frühere
Formulierung einer noch offenen Vorabfolgen-Entscheidung war für Einzel-/Staffel-
suchen unnötig. Diese übernehmen bereits den gesamten validierten Episodenbestand
ohne Airdate-Fenster; der Matcher verlangt konkrete Medien-/Identitätsbelege,
keinen bereits vergangenen TV-Termin. Der RSS-Owner hat dagegen sein eigenes
Vergangenheitsfenster. Das ist keine Voraussetzung für eine explizite Suche
bereits verfügbarer Mediathek-Folgen. Kein zusätzlicher RSS-Grab oder zweiter
Endpunkt wird implementiert; keine automatische Download-/Importabnahme aus
der Rolloutfreigabe abgeleitet. Der Vertrag und P06.4 unterscheiden das nun
ausdrücklich. Unveränderte Produktinputs: dieselben grünen Gates wiederverwendet.

## Architektur-Folgeauftrag (06.10.2026)

### Auftrag, Basis und Aussagegrenze

Nutzerauftrag: größte Verbesserungen codegestützt priorisieren und ausführbare
TODOs erstellen; getrennte GUI-Regler für Film-/Serien-Laufzeit sowie das
Erscheinungsjahr sind Pflicht. **Keine Implementierung oder Betriebsänderung**
dieses Folgepakets. Aktiver Ausgangsstand `7b03d3e` mit unverändertem Produkt
`aefa709`. Frisch abgerufenes Upstream-main:
`4ebaa8e8fa839fe44fa7862be0b49896385f5b49`. Dessen Settings-/UI-Suchpfade
enthalten ebenfalls nicht den hier benötigten atomaren Settings- und gemeinsamen
Renditionvertrag; kein ungeprüfter Merge. Upstreams zusätzliche automatische
Such-/Downloadfunktionen sind kein Auftrag für einen zweiten Arr-Scheduler.

Geprüft: Settings-API/-Context/-GUI und ihre Validatoren, Filmziel-/Quellmatcher,
TV-/Mediathekkoordination, Quellen-/Provideradapter, Rendition-/Audio-/MP4-Belege,
NZB-Erwartungen, Queue-/SAB-Consumer, Abschlussprobe, Startup/Entrypoint,
System-/Logs-/Downloadoberfläche sowie bestehende Tests/CI-Owner. Gegen die
Nutzerentscheidungen, den bisherigen Phasenvertrag und die relevanten datierten
Reviews abgeglichen. Dies ist ein codegestützter Selbstreview, kein unabhängiger
Peerreview, keine aktuelle Produktionsverifikation und kein vollständiger
Security-/Dependency-Audit. Fehlerszenarien unten sind aus dem Code abgeleitet;
dieser Dokumentationsauftrag hat sie nicht neu in einer Runtime reproduziert.

### Größte Hebel und Priorität

| Priorität | Verbesserung                                                               | Nutzen / Aufwand                                                     | Ausführbarer Owner  |
| --------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| 1         | Einheitliche, getrennte Laufzeit-/Jahresregeln und drei GUI-Regler         | Sehr hoher Alltagsnutzen; GUI klein, Jobvertrag mittel               | P12.1–P12.3         |
| 1         | Atomare Settingswrites und kanonischer Readback                            | Verhindert inkonsistente Policy-/Cachezustände; klein–mittel         | P12.1 / P05.2       |
| 1         | GUI verliert keine nutzbare Rendition bei Standard-HLS                     | Konkrete Suchlücke, hoher Nutzen; klein–mittel                       | P14.1 / P10.1       |
| 2         | Fachlich sichere Gründe statt „nicht gefunden“                             | Verkürzt Diagnose erheblich, keine neuen Sprachheuristiken; mittel   | P13.1–P13.2         |
| 2         | Gemeinsame Quellenfakten, Frische und Probe-Coalescing                     | Weniger wiederholte Arbeit, weniger Budgetabbrüche; mittel           | P14.2 / P03.4       |
| 2         | Exklusiver Einzelworkerbesitz und kontrollierter Shutdown                  | Schutz gegen versehentlichen Doppelstart/Recoveryrace; mittel–größer | P15.1               |
| 3         | Radarr-GUI, paginierte History, Runtime-/Volumechecks, Enqueue-Bestätigung | Bedienbarkeit und wachsende Installationen; je klein–mittel          | P12.4 / P15.2–P15.4 |
| 3         | Ownerweise Extraktion und Vertragsbereinigung                              | Weniger Hotfix-Sonderpfade, leichterer Upstreamabgleich; mittel      | P14.3 / P16.1       |

Aufwand ist eine relative Einschätzung, keine Zeitzusage. Der zentrale Hebel
ist **eine nachvollziehbare Pipeline mit gemeinsamen Fakten und Regeln**,
nicht mehr Senderparser, ein größerer Fuzzywert oder ein Gesamt-Rewrite.

### AR1 — Toleranzen sind vorhanden, aber nicht durchgehend derselbe Vertrag

- `src/lib/radarr-settings.ts` bietet `matching.movie.tolerancePercent` (10 %,
  ganze 0–25 %). Die GUI hat dafür kein Feld; auch die übrige optionale
  Radarr-Konfiguration ist dort nicht vollständig bedienbar.
- `src/app/settings/page.tsx` hat den Serienwert nur innerhalb der optionalen
  Sonarr-Karte; dessen Speichervalidierung ist mit URL-/RSS-Feldern gekoppelt.
  Fachliche Matchingregeln gehören unabhängig davon in Matching.
- `src/services/movie-matcher.ts::MOVIE_YEAR_TOLERANCE` ist statisch 1.
  `movie-search-context.ts` benutzt denselben Wert bereits in Parser/Zielprüfung.
  Nur eine Stelle konfigurierbar zu machen wäre ein neuer Widerspruch;
  Requestjahr, Titeljahr und Quelljahr dürfen Abweichungen nicht verketten.
- `download-manager.ts::completeValidatedDownload` liest bei jedem Job den
  **aktuellen Serienwert**. Medienerwartungen v1/v2 enthalten weder Medienart
  noch gespeicherten Toleranzsnapshot. Ein Settingswechsel kann daher die
  spätere Abschlussprüfung eines bereits wartenden Jobs verändern.

Wichtige Abgrenzung: Der Filmmatcher vergleicht Quelle gegen Filmmetadaten,
die Abschlussprobe häufig die tatsächliche Datei gegen die **Quelldauer**.
Diese Referenzen sind nicht austauschbar. Einfach jeden Filmjob mit dem
Filmprozentwert zu probieren wäre keine vollständige Reparatur. P12.2 trennt
Identitätsregel, Assetabschluss, Herkunft und Jobpolicy; generische Jobs werden
nicht anhand von Kategorien oder Dateinamen zu Filmen/Serien erklärt.
Alte unversionierte/v1/v2-Jobs und bestehende GUIDs bleiben kompatibel.
Für neue Jobs wird die Katalogreferenz mit festgehaltenen 10 % separat geprüft;
die Serien-Metadatenreferenz verwendet die festgehaltene Serienregel. Beide
bekannten Referenzen bleiben erhalten. Das sind unterschiedliche Prüfzwecke,
kein vierter Matchingregler. Die bisher dynamische Altjob-Regel bleibt als
Legacygrenze transparent; neue Payloads benötigen einen kompatiblen Rückweg.

Konkrete Planannahmen: vorhandene Film-/Serienwerte behalten; Produktdefaults
jeweils 10 %, nicht jede Installation ungefragt auf 15 % setzen. Jahrdefault
±1 und Minimum ±1 erhalten, zunächst 1–5 Jahre konfigurierbar. GUI-Feld heißt
**Film-Erscheinungsjahr**, weil genau dieser fachliche Vergleich im Code
existiert. Serien-Airdate/Vorabverfügbarkeit bleibt davon unabhängig. Unknown
wird durch keinen Regler zu einem positiven Identitäts-/Sprachbeweis.

### AR2 — Batch-Speichern kann einen Teilstand hinterlassen

`src/app/api/settings/route.ts::POST` validiert den Batch vorab, führt Upserts
dann aber mit `Promise.all` ohne Gesamttransaktion aus. Consumerinvalidierung
folgt erst nach vollständig erfolgreichem Await. Commit eines Upserts plus
Fehler eines anderen kann deshalb gespeicherte Teilwerte **und** alte Caches
hinterlassen. Das ist ein codebelegtes Fehlerszenario, kein hier nachgewiesener
Live-Datenverlust. Für einige andere Keys akzeptiert der Validator weiterhin
`String(value)` statt eines fachlichen Typs.

Der Settingscontext übernimmt nach HTTP-Erfolg das eigene Submitobjekt, nicht
den kanonisch gespeicherten Wert; beispielsweise kann `015` gespeichert als
`15` zunächst anders angezeigt werden. P12.1 behandelt atomaren Write,
gemeinsame Validatoren, bestätigten Readback und Generation als einen Vertrag.
P05.2 deshalb eng wieder geöffnet, historische Cache-Nachweise erhalten.
Gezielte Invalidation ist sinnvoll, aber erst nach verlässlichen Abhängigkeiten;
kein vorschnelles Entfernen heute sicherer globaler Invalidierungen.

### AR3 — GUI und Indexer verlieren/interpretieren unterschiedliche Kandidaten

`src/app/api/search/route.ts::handleDefaultSearch` filtert den ganzen Eintrag
nach `url_video`, während Newznab inzwischen Renditions einzeln prüft.
Standard-m3u8 mit nutzbarem HD-MP4 verschwindet so bei deaktiviertem HLS aus
der GUI. `url_video_hd || url_video` füllt zusätzlich einen HD-Slot ohne
HD-Nachweis auf. Das ist nicht automatisch ein falscher 1080p-NZB-Stempel,
aber ein falsches/verwirrendes Auswahlmodell.

Der alternative `providers=true`-/`provider`-Pfad nutzt die Registry ohne
denselben mitgegebenen Gesamtversuchszähler; sie begrenzt Resultate und behandelt
Sourcefehler anders. `limit` wird dort nur per `parseInt` geparst. Adaptertypen
können keine URL-gebundenen Dimensions-/Providerbelege durchgängig ausdrücken;
der SRF→`ApiResultItem`-Adapter übernimmt selbst das optionale Audiofeld nicht.
Das ist keine Behauptung, SRF liefere heute bereits jeden gewünschten Beleg.

P14.1 vereinheitlicht Abruf, Budget und konkrete Renditionfakten. Fachlich
darf generisches UI-Browsing weiterhin ohne sichere Arr-Zielidentität stattfinden;
Indexeridentität bleibt streng. Partial-GUI-Ergebnis muss als unvollständig
sichtbar sein, kein erfolgreich leeres/partielles Indexerresultat bei benötigtem
Sourcefehler. P10.1 für diese neue Verbraucherlücke gezielt wieder geöffnet.

### AR4 — Fehlende Treffer sind schlecht erklärbar; Abdeckung ist nicht Wahrheit

Matcher/Quellenproben geben meist Treffer oder Unknown zurück, nicht einen
durchgängigen fachlichen Grund. `/logs` ist ein „Coming Soon“-Platzhalter.
Die sichere progressive Transferdiagnose ist bereits vorhanden und wertvoll;
sie ersetzt aber keine Erklärung für Identitätskonflikt, unbekannte Sprache,
Laufzeitabweichung, ausgeschöpftes Quellfenster oder fehlenden Folgeabruf.

P13 nutzt typisierte geschlossene Gründe mit Kapazitäts-/TTL-Grenzen und
Redaction statt roher Docker-/Providerlogs. Ein großer Matchscore bedeutet
keine gesicherte Identität. Completed bedeutet geprüfter Download, nicht
Arr-Import. Optionale lesende Importdiagnose darf nur belegte Zuordnung anzeigen;
ohne Arr-Verbindung bleibt der Importstatus unbekannt.

P03.4 bleibt offen. Weitere Parametererhöhungen oder Hostwildcards sind kein
struktureller Sprachfix. `source-audio.ts` coalesced derzeit innerhalb einer
Anfrage, nicht dauerhaft über Suchanfragen. Der bounded MP4-Owner kontrolliert
Rangegrenzen und gleiche Gesamtlänge, aber keine Assetversion via ETag/If-Range;
eine gleich große Änderung zwischen Fenstern kann so nicht erkannt werden.
P14.2 macht Frische und Cachefähigkeit explizit, ohne vier 1-MiB-Fenster oder
32-/10-Versuche/15-Sekunden zu erhöhen. Fehlender Beleg bleibt neutral.

### AR5 — Prozesslokale Queuekoordination ist keine dauerhafte Besitzgrenze

`download-manager.ts` schützt einen Prozess mit Semaphore/`processingPromise`.
`instrumentation.ts` ruft beim autorisierten Start Recovery für aktive Jobs
auf; es gibt keinen DB-weiten Besitzer/Fencingclaim. Zwei Prozesse können
deshalb dieselbe Queue berühren bzw. aktive Nachbarjobs als unterbrochen markieren.
Das ist ein Architektur-/Fehlstartrisiko, kein belegter aktueller Doppelworker.
`application-entrypoint.mjs` leitet SIGINT/SIGTERM bereits weiter; eine gezielte
Drain-/Leasekoordination des Workers ist damit noch nicht nachgewiesen.

P15.1 härtet ausdrücklich den **Einzelworker**, keine horizontale Skalierung.
PostgreSQL allein löst Ownership, Crash-/Commit-Ungewissheit und Filesystem-
Seiteneffekte nicht. P15.4 behandelt einen zweiten konkreten Randfall:
`addToQueue` erstellt je Aufruf eine UUID, ohne stabilen Auftragsschlüssel;
verlorene Bestätigung plus UI-Wiederholung kann einen zweiten Job erzeugen.
Idempotenz gilt nur für belegte gleiche Aufträge, nicht ähnliche Filmtitel.

### AR6 — Betriebsoberfläche wächst und misst teilweise die falschen Dinge

- `download.ts::getHistory` liest alle completed/failed-Zeilen;
  `/downloads` holt Queue und gesamte History alle fünf Sekunden. Größerer
  Bestand erhöht Query-/Payload-/Browserkosten, auch ohne aktive Downloads.
  P15.2 darf native SAB-Consumer nicht durch blindes Abschneiden gefährden.
- `/api/system` führt zwei synchrone Toolchecks bis je fünf Sekunden aus:
  das kann den Node-Eventloop blockieren und prüft PATH statt zwingend der vom
  Worker benutzten Binary. Historische TVDB-Tabellen sind kein aktiver Cache.
  P15.3 trennt Readiness, Capabilities und alte Datenstatistik.
- `entrypoint.sh` führt bei schreibendem Boot rekursiv `chown/chmod 755`
  auf Download-/Tempvolumes aus. Maintenance ist bereits geschützt; regulärer
  Boot sollte vorhandene Medien-/Nachbarrechte ebenfalls nicht umschreiben.

### Bereinigung, Ausbau und bewusst kein Ausbau

Die großen Owner (`mediathek.ts`, `newznab.ts`, `download-manager.ts`,
Settings-GUI) mischen Koordination und Detailentscheidungen. P16 extrahiert
erst nach gesicherten Policy-/Faktenverträgen, nicht nach einer Zeilenquota.
Typed Cache-/Provider-/Decisionwerte und unabhängige Serializer sind hilfreicher
als ein neues universelles Framework. P14.3 trennt Datumsarten und Unknown;
explizite Vorabfolgensuche bleibt ohne vorgelagerten RSS-Grab möglich.

Nicht vorgesehen: weitere HTML-Mediathekcrawler, private Titelpatches, eigener
automatischer Arr-Scheduler, zwei manuell/automatisch getrennte Endpoints,
generischer Sprachdefault als angeblicher Trackbeleg, Redis/Microservices,
automatische DB-Fallbacks, höhere Replikazahl oder neue Produktpflicht zu PG.
SQLite/PG bleiben gleichwertig; P11.9 bleibt optional. Produktivrollout,
DB-Migration, reale Grabs und physische Proxyentfernung brauchen weiterhin
ihre konkrete Freigabe. Keine privaten Betriebsdaten in diesen Dokumenten.

### Vertragsnachreview und Evidenz

Nach Überführung die neuen TODOs gegen jeden Befund, bestehende Erhaltungsregeln,
aktuelle Code-Owner, Defaults/Units, Consumer, Abhängigkeiten und Abnahmegates
erneut geprüft. Einzige ausführbare Folgeaufträge: P12–P16 im bestehenden
Phasenvertrag; P05.2/P09.2/P10.1 referenzieren ihre engen Folgepakete, keine
doppelten Implementierungslisten. P03.4/P11.9/P10.6/P10.7 bleiben ehrlich offen.
Bestehende datierte Abnahmen und IDs erhalten; veraltete globale Vollabnahme
im TODO-Kopf und das vermeintlich aktuelle historische Reviewurteil korrigiert.

Neu geprüft: Prettier für beide Dokumente, 14 lokale Links einschließlich
des neuen Abschnittsankers, 31 vorhandene Codeanker, 14 eindeutige offene neue
Paket-IDs, genau drei gezielte Wiederöffnungen, Scope und `git diff --check`.
Keine Produktgates bei reinem
TODO-Authoring gemäß Skill. Die zuletzt dokumentierten 1.018 Tests sowie
Produkt-CI/Container-/Backendnachweise werden für unveränderten Code lediglich
wiederverwendet; sie beweisen die **noch offenen** Folgeanforderungen nicht.
Neue GUI-Abnahmen müssen das tatsächlich servierte disposable Desktopbundle
bedienen; neue Persistenzverträge beide disposable Backends. Keine Tests,
Screenshots, Produktionsabnahme oder Deployment dieser neuen Pakete behauptet.

## P12-Implementierungsreview (08.10.2026)

Auftrag jetzt ausdrücklich Umsetzung des Folgepakets, zunächst zusammenhängender
P12-Checkpoint auf `codex/matching-settings-contract`. Upstream
`4ebaa8e8fa839fe44fa7862be0b49896385f5b49` nochmals abgeglichen; kein passender
atomarer Settings-/Jobpolicy-Ersatz übernommen. Kein Produktionszugriff,
Deployment, Imagepublish, Main-/Upstreampush oder reale Bibliotheksoperation.

### Reparierte Verträge

AR1/AR2 werden gemeinsam durch `settings-schema.ts`, die transaktionale API,
bestätigte Clientresponseordnung und einen serverseitigen Suchsnapshot behoben.
24 nichtsecret Produktkeys haben einen gemeinsamen Typ-/Default-/Grenzowner.
Unbekannte historische Zeilen bleiben unverändert lesbar; neue unbekannte,
Null-/Objekt- und ungültige Werte werden vor dem Write abgelehnt. Keine stille
Reparatur vorhandener ungültiger Matchingwerte. Der Commitfehlerpfad sagt
ausdrücklich „unbestätigt“, statt einen verlorenen Commit-Ack als Rollback zu
behaupten. Kontrollierter Readback und Cacheinvalidierung sind kausal getestet;
späte GETs und konkurrierende Formularwrites überschreiben keine Bestätigung.

Die drei unabhängigen Matchingregler sind unabhängig von optionalen Arr-URLs
bedienbar. Die neue Radarr-Karte ergänzt nur vorhandene öffentliche Controls;
HTTP/HTTPS mit Unterpfad bleibt möglich. Credentialstatus ist vorhanden/fehlend/
ungültig, ohne Key oder Pfad. Auch historische credentialhaltige Arr-URLs
werden nicht an den Browser ausgegeben. Keine neue Secretverwaltung.

Neue `MediaExpectations` v3 trennen Medienart, technische Katalogreferenz mit
festen 10 % und belegte Serienmetadaten mit eingefrorener Serienregel. Beide
bekannten Referenzen bleiben erhalten und werden unabhängig geprüft. Source-
Audio-/Dimensionsbindung, Sample-/HLS-/EXDEV-/Byte-/Datei-/Exitguards bleiben
erhalten. Alte v1/v2/unversionierte Jobs werden nicht umgeschrieben; ihre
dynamische Altregel bleibt dokumentiert. Kein Schemawechsel; **nach einem v3-Job
ist ein v3-inkompatibles Image trotzdem kein sicherer App-Rollback**.
Vertrag und Rückweggrenze: [Settings-/Jobpolicy-Referenz](settings-contract.md).

### Lokaler Entwicklungscheckpoint vor Forkabnahme

- `npm ci`, danach **1073 bestandene reguläre Tests / 100 Dateien**;
  18 backendabhängige Runtimefälle regulär übersprungen. Lint, Typecheck,
  Formatcheck, Productionbuild und Diffcheck bestanden auf Node 26.10.0.
- Zusätzlich **14/14 echte disposable SQLite-/PG-Runtimefälle** für Settings
  und Joberwartungen: DB-native Fehler beim zweiten Write, kein Teilstand,
  kanonischer Readback, Unknown-/Null-/Objekt-/Rangeablehnung und Neustart;
  v1/v2/v3-Erwartungen über Einreihung, Retry und Settingswechsel. Das ersetzt
  weder die vollständige PG-CI noch die neue reale Mediencontainerkette.
- Tatsächlich serviertes Desktopbundle (1440×1100), Light/Dark, Pointer/Keyboard,
  Save/Reload/API-/DB-Readback auf beiden Backends. SQLitetrigger und PG-Constraint
  reproduzieren den zweiten Writefehler: keine Erfolgsmeldung, alte DB-Werte,
  ungespeicherte Eingaben bleiben. Leere, gebrochene und übergroße Werte gesperrt;
  andere Dirty-Karten und Matchingtab bleiben beim Readback erhalten.
- Gematchte Vorher-/Nachherbilder in beiden Themes. Dark verwendet eine temporäre
  Root-Themefixture im tatsächlich servierten Bundle, kein Produkt-Themewechsel
  oder DOM-Nachbearbeiten; die Fixture ist entfernt. Frische stabile Light-
  Produktions- und Dark-Testtabs haben keine Consoleerrors/-warnings.
  Frühere HMR-Hydrationmeldungen während laufender Quelländerungen sind kein
  behaupteter fehlerfreier Gesamtverlauf; die Abnahme nutzt frische stabile Tabs.

Die Containerharnesses sichern weiterhin unbekannte Originalsettings, schreiben
für den Persistenztest jetzt den typisierten Filmjahreskey und bestätigen den
kanonischen Wert. Neue v3-Worker-Matrix ergänzt (nicht ersetzt) Legacy/HLS/
Truncation/Audio/Auflösung/Retry/Restart. **Zu diesem Zwischencheckpoint waren
Fork-CI und Dockervalidierung noch ausstehend; P12 und P05.2/P09.2 blieben bis
zu deren unten dokumentierter finaler Abnahme offen.**
P13–P16 sowie P03.4 sind durch diese Arbeit nicht abgenommen.

Separate bestehende Befunde: 14 Build-Tracingwarnungen; `npm ci`/Audit meldet
einen High-Hinweis in transitivem `source-map-js` 1.2.1 (GHSA-68fv-2mgg-jv7q).
Das ist keine nachgewiesene Runtimeausnutzbarkeit und kein behobener Befund.
Dependencies wurden in diesem Settingspaket nicht geändert; keine behauptete
Securityvollabnahme. Review durch denselben Implementierer, kein unabhängiger
Peerreview. Keine Secrets, privaten APIantworten oder Topologie in Fixtures/Git.

Nachreview vor Abnahme: Die zunächst inventarisierte SRF-Enablevoreinstellung
war zu streng gegenüber dem ausgelieferten Consumer. Fehlender Enable-Key
bedeutete dort bereits „mit Credentials und HLS nutzbar“, nicht Disabled.
Der Snapshotdefault erhält jetzt genau das; explizites false, fehlende
Credentials und deaktiviertes HLS bleiben gesperrt. Eine kausale Regression
verwendet den echten SRF-Owner innerhalb des echten Settingssnapshotowners,
ohne externe API oder Credentialdatei. Voriger Produkt-CI-Lauf ist damit nur
historische Zwischenstandevidenz; finale Fork-/Containergates wurden erneut
erforderlich und sind in der folgenden Abnahme aufgeführt.
Nach der SRF-Korrektur alle lokalen regulären Gates erneut bestanden:
**1074 Tests**, Lint, Typecheck, Format und Build. UI-/DB-Evidenz für unveränderte
Formulare und Transaktionen wird wiederverwendet, nicht als neuer Lauf ausgegeben.
Die erste PG-CI fand außerdem noch eine alte Runtimefixture, die einen neuen
unbekannten Key per API schreiben wollte. Dieser muss nach P12 korrekt 400
liefern; Fixture auf unveränderten Legacy-Read plus kanonischen typisierten
Write umgestellt, negative Unknown-Writeprüfung ergänzt. Kein Entfernen des Gates.

### Abschließende P12-Abnahme

Finaler Produktstand `4dc280c89db2a5d34e07bc1aed3d61bc99f561bf`:
[Fork-CI 37704788531](https://github.com/superions/pingufunk/actions/runs/37704788531)
mit Lint/Build und vollständiger PostgreSQL-Integration erfolgreich;
[Dockervalidierung 37704788439](https://github.com/superions/pingufunk/actions/runs/37704788439)
ebenfalls erfolgreich, einschließlich nativer Arr-Renditionconsumer direkt/via
Prowlarr, Runtimewerkzeugen, TLS-Migrations-/post-write-Rollbackprobe,
SQLite-Start-/Restartpersistenz und realer Medienworker-Matrix auf beiden
disposable Backends. Die neue v3-Matrix prüft Film/Serie/Unknown, beide
Dauerreferenzen unabhängig, HLS und Retry; die Legacy-Matrix bleibt erhalten.
Die Zwischenstandevidenz aus Dockerlauf 37704528509 ersetzt diesen finalen
Lauf nicht. Der zunächst fehlgeschlagene CI-Lauf 37704528522 bleibt als
Fixturefinding dokumentiert, nicht als bestandener Lauf ausgegeben.

P12.1–P12.4 sowie ausschließlich die engen Wiederöffnungen P05.2/P09.2 sind
damit abgeschlossen. Die unveränderten Desktop-/Datenbankjourneys werden
wiederverwendet; neue reguläre lokale Tests nach SRF-Korrektur und neue finale
Fork-/Containergates sind gesondert benannt. Eigene lokale Testserver,
SSH-Tunnel und markierter disposable PG-Container sind beendet; keine fremden
Prozesse, Volumes oder Datenbanken bereinigt. Produktstand bleibt auf dem
eigenen Topicbranch; weder Main-Integration, Deployment noch Imagepublikation.
Die separaten Warnungen sowie P13–P16 und P03.4 bleiben ausdrücklich offen.

## Implementierungsreview P14.1 — gemeinsamer begrenzter Quellenabruf

Entwicklungscheckpoint 08.10.2026 auf `codex/search-rendition-contract`, nach
P12. Upstream-main `4ebaa8e8fa839fe44fa7862be0b49896385f5b49` nochmals gelesen:
der betreffende Ganzeintrag-HLS-Filter und die Standard-als-HD-Ersetzung sind
dort nicht bereits behoben. Keine Produktions- oder Main-/Upstreamänderung.

`queryContentWindow` koordiniert beide GUI-Abfrageformen und den strengen
Indexerwrapper. Ein gemeinsames zehn-Versuche-/15-Sekunden-Budget begrenzt
Quellen, Folgeseiten und Retries. Überlange Seiten und fehlgeschlagene
Folgeseiten verwerfen den Quellbestand; die GUI darf andere erfolgreiche
Quellen nur ausdrücklich als Teilantwort anzeigen. Der Indexer übernimmt
keine solche Teilantwort. Bounded Counts behaupten keine Kataloggesamtzahl.

Eligibility entfernt einzelne URL-Slots vor Editiondedupe und Limit. Damit
bleibt HD-/Low-MP4 trotz Standard-HLS auswählbar und Standard-MP4 trotz HD-HLS
erhalten. Fehlendes HD wird nicht erfunden. Der vertrauenswürdige Adapter
erhält URL-gebundene Audio-/Dimensionsfakten; untrusted Rohzeilen dürfen keine
Providerherkunft oder GUI-ID vorgeben. Exakte NZBs verwenden denselben
Renditionowner wie RSS. Ein nur zur anderen URL gehörender Audiobeleg entfernt
auch die daraus abgeleitete Sprachangabe, nicht bloß den Belegcontainer.
Alte GUI-IDs, RSS-/NZB-GUIDs, Kategorien und v1/v2/v3-Jobs bleiben erhalten.

Lokale Gates: **1121 Tests bestanden, 18 getrennt geroutete Fälle übersprungen**,
Lint, Typecheck, Formatcheck, Productionbuild und Diffcheck grün. Darin sechs
echte SQLite-Runtimefälle der GUI→NZB→SAB→DB-/Retrykette. Unveränderte
Installation aus P12 wiederverwendet; kein neuer `npm ci`-Lauf behauptet.
Die separate PG-/native Arr-/Containerabnahme ist zu diesem Checkpoint offen.

Desktopabnahme am tatsächlich servierten Productionbundle, 1280×720 Light:
gematchte Vorher-/Nachherzustände zeigen 2→3 Ergebnisse bei gemischten HLS/MP4-
Slots; nur tatsächliche HD/SD/Low-Auswahl, Keyboard und Pointer geprüft.
Leere Antwort heißt nun ausdrücklich „im abgerufenen Suchfenster“, eine leere
Teilantwort ist kein bestätigter Nichtfund. Sourcefehler, 50-von-70-Fenster,
Partial- und alle-Quellen-deaktiviert-Zustände sind sichtbar geprüft, frische
Browserkonsole leer. Der absichtliche Buttoncheck bei Write-Gate 0 bestätigt
Ablehnung statt Download; native DB-Zählung bleibt **0 Jobs**. Externe
Netzsperre und synthetische Providerfixtures verhindern reale Katalog-/Grabs.
Eigene Tabs und Testserver anschließend beendet; keine fremden Prozesse.

Nachreview durch den Implementierer, kein unabhängiger Peerreview: zusätzlich
die Eligibility-vor-Edition-Grenze, abgeleitete Audioangaben, Roh-ID-Injektion,
übergroße Providerseite und begrenzte Counts kausal negativ geprüft. Vertrag
unter [begrenzter Quellenabruf](bounded-search-contract.md). P14.1/P10.1 bleiben
bis zur neuen Fork-/Containerevidenz offen; P13/P14.2/P14.3/P15/P16 und P03.4
sind durch dieses Paket nicht abgenommen. Bestehende Build-Tracingwarnungen
und der bereits dokumentierte transitive Auditbefund bleiben separate Befunde.

### Abschließende P14.1-Abnahme

Produktstand `7d9893299a807458ffa550374a6359adf0849cab` auf dem eigenen Fork:
[CI 37707678742](https://github.com/superions/pingufunk/actions/runs/37707678742)
inklusive vollständiger PG-Integration erfolgreich;
[Dockervalidierung 37707678881](https://github.com/superions/pingufunk/actions/runs/37707678881)
vollständig erfolgreich. Neue native Sonarr-/Radarr-Qualitätsconsumer direkt
und über Prowlarr, Tooling, TLS-Migration/post-write-Rollback, SQLitepersistenz
und reale synthetische Medienabschlüsse/Retry auf beiden Backends bestätigen
den neuen Producerstand. Keine Wiederverwendung der P12-Containerprüfung als
Ersatz für P14.1. Tatsächliche Desktopprüfung und 1121 lokale Tests wie oben;
finaler Nachcheck nennt bei Leerantworten das begrenzte abgerufene Suchfenster.
P14.1 und ausschließlich die enge Wiederöffnung P10.1 sind damit geschlossen.
P13, P14.2/P14.3, P15/P16 sowie P03.4 bleiben offen, keine Vollabnahme oder
Produktionsfreigabe. Keine DDL, Jobs, Imagepublikation oder Mainintegration.

## Implementierungsreview P15.3 — Readiness und schonender Volume-Start

Entwicklungscheckpoint 08.10.2026 auf `codex/runtime-volume-contract` nach
P12/P14.1. Upstream-main `4ebaa8e8fa839fe44fa7862be0b49896385f5b49` enthält
noch synchrone Request-Toolchecks und rekursives Volume-`chown/chmod`; keine
passende bestehende Korrektur übernommen. Kein Deployment oder Mainpush.

Der vollständige Ownerpfad wurde durch den Implementierer geprüft: tatsächliche
FFmpeg-/ffprobe-/yt-dlp-Auflösung → begrenzte Kindprozesse → geschlossenes
DTO → Route → Desktopparser; Schema-/Verbindungsreads → Maintenance-/Writegate
→ explizit prozesslokaler Workerzustand; persistierte Downloadpfadpriorität →
Prepare nur neuer Verzeichnisse → actual-user Check → Entrypoint. Alte API-
Statistikfelder/500-Vertrag bleiben erhalten, Health ergänzt 503-Readiness.
Der Health-GET startet/installiert/migriert nichts. Zehnsekunden-Strukturcache
beweist keine Strukturprüfung bei jedem Aufruf; aktuelle Verbindung wird
separat live gelesen. Prozesslokaler Status ersetzt keine P15.1-Lease.

Nachreview behoben: PATH statt wirklicher Binaryowner, relative ffprobe-
Konfiguration, Konfigurationsrotation während laufender Toolprüfung,
freie Versionsausgabe, gecachte Readiness bei aktuell ausgefallener DB und
alte gesunde Desktopstatistiken nach Fehler. Volumepfade verwenden die reale
Configpriorität, nicht bloß ENV. Bestehende Owner/Mode/Inhalte bleiben erhalten;
Readonly-Writer bricht ab statt Volume-Reparatur. Das frische Composebeispiel
entspricht dem bereits vorhandenen Bindmount, keine Bestandskonfigumschreibung.

Desktop am tatsächlich servierten Productionbundle, 1280×720 Light, matched
before/after: Pointer/Keyboard, native disposable SQLite-Tabellenunverfügbarkeit
mit Live=200/Ready=503 und sichtbarem Fehler statt Altstatistik; Recoveryreadback
mit null Jobs; langsame synthetische ffprobe ergibt den abgegrenzten Timeout.
Frische Browserkonsole leer, keine horizontale Overflow-/Mobil-/Darkabnahme
behauptet. Eigener Baselinecheckout und Testserver danach beendet/entfernt,
Screenshots als ignorierte lokale Evidenz erhalten. Keine Produktionsdaten.

Native Timeouttests beweisen Eventloopresponsivität; die UI allein ersetzt
diesen kausalen Nachweis nicht. Windowscleanup nicht nativ getestet. Die
await-Deadline ist keine Prisma-Cancellation oder Mutationsretry-Freigabe.
Neue Backendcontainer-/Forkabnahme bleibt bis zum tatsächlich erfolgreichen
Lauf offen; alte P14-Gates ersetzen sie nicht. Vertrag unter
[Runtimeprüfung](runtime-readiness-contract.md). Kein unabhängiger Peerreview.
P13/P14.2/P14.3/P15.1/P15.2/P15.4/P16 und P03.4 bleiben offen; bestehende
Build-Tracingwarnungen und transitive Auditfinding separat unverändert.

Container-Zwischenlauf 37709209422 brach bereits beim Build ab: die bestehende
Script-Allowlist in `.dockerignore` schloss den neuen Volumehelper aus. Die
Allowlist wurde gezielt ergänzt, nicht die private Script-/Datenabschirmung
aufgehoben. Keine Containerabnahme aus diesem fehlgeschlagenen Lauf behauptet.
Finale lokale **1141 Tests**, Lint, Typecheck, Formatcheck und Diffcheck grün;
Productionbuild für den unveränderten Produktquellstand wiederverwendet.

## Implementierungsreview P13.1 — kausale geschlossene Diagnose

Entwicklungscheckpoint 08.10.2026, `codex/decision-evidence-contract` nach
P12/P14.1/P15.3-Produktcheckpoint. Upstream-main
`4ebaa8e8fa839fe44fa7862be0b49896385f5b49` anhand tatsächlichem Movie-/Workerowner
erneut geprüft: kein entsprechender geschlossener Diagnosevertrag vorhanden.
Keine Main-/Produktions-/Upstreamänderung, kein Imagepublish.

Vollständiger betroffener Pfad durch den Implementierer reviewt: GUI-/Indexer-
Requestscope → Quellen-/Folgeseiten-/Budgetentscheidungen → Movie-/Sonarrmatcher
→ Sprach-/Rendition-/MP4-Beleg → Probeerror → Workerfailure-Write. Positive
Belege bleiben getrennt von Scores und fehlenden Facts. Ein Medienfehler wird
erneut vor Persistenz validiert; rohe Errorobjekte bleiben außen. Bestehende
Transferdiagnostik und sichere Quellfehlermessages bleiben kompatibel.

Nachreview behoben: bislang verlorene Probeursache, gespeicherte Berichtobjekte
gegen Fremdmutation, Late-Tasks nach Scopeabschluss, begrenzte parallele
Collectorzahl, TTL-/Kapazitäts-/Eventoverflow, „complete“ als missverständliches
Berichtsfeld (jetzt `recorded`, kein Source-/Match-Erfolg), cached RSS ohne
behauptete neue Belegprüfung. Mehrere Metadatenvergleiche sind Ownerprüfungen,
keine deduplizierte Trefferzählung. Header bleibt neue zufällige Kennung,
XML/Status/IDs/GUIDs unverändert; Prowlarr-Headerweiterleitung nicht behauptet.

Neue Routen-/Matcher-/Probe-/Workerregressionen schützen die wirkliche Ursache
und den Consumer; synthetische Exception-/URL-/Pfadinjektionen werden verworfen.
Kein öffentlicher Reader oder Dockerlogzugriff. Die alten freien Logs sind
nicht pauschal behoben; P13.2 besitzt deren Bereinigung, tatsächlichen
Zugriffschutz, GUI und separat belegten Arr-Import-/Blockstatus.
Fork-/Backend-/Containerabnahme bis zu neuen erfolgreichen Läufen offen.
Vertrag [Entscheidungsdiagnose](decision-diagnostics-contract.md); kein
unabhängiger Peerreview und keine Sprach-/Worker-/Gesamtvollabnahme.

### Finale P15.3- und P13.1-Abnahmen

P15.3 auf `c8ccdcc91f8bb42c2d99d8790c12c6b5c3f90853`:
[Fork-CI 37709293171](https://github.com/superions/pingufunk/actions/runs/37709293171)
und [Containerkette 37709293111](https://github.com/superions/pingufunk/actions/runs/37709293111)
vollständig grün. Die eigenen Volume-Owner-/Mode-/Inhaltssentinels über
Start/Restart/Maintenance, Readonly-Abbruch und Medienabschlüsse auf beiden
Backends sind neu geprüft, keine ersatzweise P14-Evidenz. Erster fehlgeschlagener
Allowlistbuild bleibt dokumentiert. Keine P15.1-Ownershipabnahme.

P13.1 auf `9ed044aa1f2f32a834702a3f1a7d5d30277d3e9d`:
[Fork-CI 37709955459](https://github.com/superions/pingufunk/actions/runs/37709955459)
und [Containerkette 37709955519](https://github.com/superions/pingufunk/actions/runs/37709955519)
vollständig grün, inklusive PG, nativen Arr-/Prowlarrconsumern, Tooling,
TLS-Migration/post-write-Rollback, SQLitepersistenz und realen Medienabschlüssen.
1152 lokale Tests und übrige Gates grün. Keine neue UI-Journey dieses
API-/Workerpakets; P13.2 besitzt UI, Zugriffschutz, freie Logs und Arr-Import.
Die Checkboxen sind geschlossen, Gesamt-/Sprachvollabnahme weiterhin falsch.

## Implementierungsreview P15.2 — paginierte Betriebsreads

08.10.2026 auf `codex/download-read-pagination`. Vollständiger Read-/Callerpfad
durch den Implementierer reviewt: Native SAB-/Arr-Parameter → geschlossene
Validierung → DB-Filter/Sortierung/Serializable-Snapshot → Counts/Slots →
serverseitige Pfadprojektion → GUI-Windowack/Generation → Filter/Paging/Polling.
Mutationen unverändert, kein DDL oder Readtimeout als Retryfreigabe.
Upstream besitzt bereits History-Paging; die Anpassung erhält dessen Prinzip
ohne dessen andere Queue-/Medienverträge zu kopieren.

Nachreview korrigiert: native `limit=0` darf nicht abgeschnitten werden,
verlorene historische private Kategorien im Filter, Timestamp-Gleichstände
und NULL-Sortierung, widersprüchliche Counts beim gleichzeitigen Abschluss,
alte Antworten nach Filterwechsel, malformed Slotdaten und vermeintlich leere
GUI bei Readfehler. ASCII-Suchcases auf beiden DBpfaden getestet; Unicode-
Collation nicht pauschal gleichgesetzt. Offsetseiten sind keine unbewegliche
Historie, alte konkrete IDs bleiben gezielt lesbar.

Serviertes Desktopbundle 1280×720 Light, matched before/after: 1050→50 Zeilen,
zweite Seite, Pointer-/Keyboardfilter, Kategorie/Failed, gezielter alter Titel,
Leer-/DB-Fehler-/Recoveryzustand, Konsole sauber. 176798→8499 HTTP-Bytes bei
derselben 1050er Fixture. Eigene DB zurückgestellt, alle 1110 Jobs unverändert;
kein Retry/Grab/Delete. IAB meldet alle Vergleichtabs visible; kein tatsächlicher
hidden-Tab-Timer-Nachweis behauptet. Pollentscheidung kausal getestet.
PG-/Fork-/Containerfinale noch offen; [Readvertrag](download-read-contract.md).
Keine Produktionsänderung, Mainintegration oder öffentliche Imagepublikation.
