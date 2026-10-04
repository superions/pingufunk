# Optionale PostgreSQL-Migration für Pingufunk

Stand: 30.09.2026. Ergänzung P11 zum
[Proxy-Ablöseplan](proxy-retirement-plan.md). **PostgreSQL ist optional;
SQLite bleibt ein unterstützter Betriebsmodus.** Dieses Dokument bleibt technische Referenz mit Ausgangsbefunden
und Daten-/Rollbackinvarianten. Einziger ausführbarer Entwicklungs- und
Freigabevertrag: [Phasen-TODOs](../todo/proxy-retirement.md), P11 und P10.
Installationsnachtrag 04.10.2026: Ein ausdrücklich freigegebener produktiver
Cutover ist einschließlich getrennt bestätigtem Schreibbetrieb und Restart
abgenommen (P10.2–P10.5). Konkrete Betriebswerte und vollständige Nachweise
bleiben im privaten Runbook. Dies ist keine allgemeine Deploymentfreigabe.

Der Entwicklungsbranch unterstützt nach P11.1 wieder **beide Backendtypen**:
Beide Backends sind gleichwertig unterstützt; ohne PG-Konfiguration wird SQLite
verwendet. Getrennte Clients,
Migrationen und Container-/Runtimeproben sind in
[database-backends.md](database-backends.md) beschrieben. Ein fertiger
PG→SQLite-Rücktransfer ist damit nicht behauptet; weitere PG-Abnahmen bleiben
im Phasenvertrag offen.

## Entscheidung, Umfang und Reihenfolge

Transportentscheidung 03.10.2026: PostgreSQL muss auch ohne TLS nutzbar sein.
Die geschützte URL wählt dafür ausdrücklich `sslmode=disable`; `require`
erzwingt TLS. Der Migrationsstandard bleibt TLS, kein Fehlerfallback und keine
fest verdrahtete Proxyroute. `prefer`/mehrdeutige Modi sind für den Cutover
gesperrt. Aktueller Vertrag und Grenzen: [Backendwahl](database-backends.md).

Eine Installation wählt SQLite oder PostgreSQL ausdrücklich. Der Proxy-Ausstieg
darf mit SQLite erfolgen; er hängt nicht von P11 oder einem PG-Cutover ab.
P11 liefert eine isoliert geprobte PostgreSQL-Option mit erhaltener SQLite-
Lauffähigkeit. Neue Schemaerweiterungen aus P07/P09 müssen für beide Provider
umgesetzt und getestet werden. Ein realer PG-Cutover mit Schreibfreigabe ist ein
separater, optionaler Betriebsablauf, nicht Teil der Proxy-Umschaltung.

Dies betrifft **Pingufunks eigene Prisma-Datenbank**, nicht erneut die Sonarr-,
Radarr- oder Prowlarr-Datenbanken. Keine Servarr-main/log-Aufteilung erfinden:
Pingufunk benötigt eine eigene Datenbank mit seinen Anwendungstabellen.

Für eine PG-Installation wird der konkrete Zugriffsweg erst im privaten
Betriebs-Preflight festgelegt: direkter Host, Proxy oder anderer unterstützter
Transport sind keine Repository-Vorgabe. Keine Übernahme fremder
Anwendungsrollen. Networks, Mounts, Downloads und Secret-/Deployment-Konventionen
der jeweiligen Installation bleiben erhalten.
Konkrete private Endpunkte und Zugangsdaten stehen nicht in diesem öffentlichen
Repository. Die tatsächlich eingesetzte PostgreSQL-Version muss für jeden
Cutover live festgestellt werden; sie wurde für die abgenommene Installation
verifiziert und bleibt für jede weitere Installation ein Preflight-Gate.

## Verifizierter Ausgangsstand

Ausgangspunkt der ergänzenden Analyse: Fork-Commit 621df324e039ba78d4c7bf34f200ddceee345491,
Upstream a3b02a6e6ad827d6483700480b9bfbcc59a5823c. Lockfile: Prisma CLI und
Client jeweils **6.19.2**, Next.js 16.1.6. Kein beiläufiges Prisma-Major-Upgrade.

| Ort                                 | Befund                                                              | Erforderliche Änderung in P11                                      |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| prisma/schema.prisma                | provider sqlite, sechs Modelle                                      | Providergetrennte Schemata/Clients und bewusst geprüfte Typen      |
| prisma/migrations/                  | Drei SQLite-Migrationen, SQLite migration_lock                      | Eigene PostgreSQL-Kette; SQLite-Kette weiter betreibbar halten     |
| init-db.sql                         | Separates SQLite-Bootstrap, leere Kompatibilitäts-Ledgertabelle     | SQLite-Bootstrap prüfen; PostgreSQL nutzt versionierte Migrationen |
| entrypoint.sh                       | SQLite-Datei fest verdrahtet, initialisiert und schreibt beim Start | Providerwahl und jeweilige Readiness ohne heimlichen Fallback      |
| entrypoint.sh DEBUG                 | Gibt derzeit DATABASE_URL aus                                       | Unbedingt entfernen/redigieren, auch in Fehlerpfaden               |
| Dockerfile                          | SQLite-URL als Default, sqlite/init-db.sql; Prisma-Client ohne CLI  | Beide Clients bauen, explizit ausführbare Migrationsrunner         |
| .env.example und docker-compose.yml | SQLite-Defaults und Datenmount                                      | Beide Devverträge ohne reale Credentials dokumentieren             |
| src/lib/db.ts                       | Gemeinsamer PrismaClient                                            | Explizite Providerwahl, Pool und Lebenszyklus je Backend           |
| src/lib/db-schema.test.ts           | Vergleicht nur Modell-/Bootstrap-Tabellennamen                      | Echte Schema-/CRUD-/Migrationsprüfung für beide Provider           |

Die historische erste SQLite-Migration erzeugt TvdbSeries.id mit AUTOINCREMENT,
das aktuelle Prisma-Modell verlangt dort hingegen eine explizite ID. init-db.sql
und Migrationen haben außerdem unterschiedliche Default-/Nullability-Details.
Darum sind tatsächliches Quellschema und gespeicherte Typen zu prüfen, nicht
nur der deklarierte Modelltext. Ein SQLite-Ledger kann fehlen/leer sein, obwohl
alle Tabellen durch das Container-Bootstrap existieren.

## Architektur und Artefakte der Umsetzung

- **Ein ausdrücklich gewählter Backendtyp pro Installation, zwei getrennte
  Prisma-Clients und Migrationsketten.** Historische SQLite-Schemata/SQL
  unverändert erhalten und ihre Runtime weiterhin prüfen. Kein automatischer
  Dual-Backend-Fallback: PostgreSQL-Ausfall darf weder neue SQLite-Dateien noch
  einen zweiten Datenbestand erzeugen.
- PostgreSQL-Baseline aus dem überprüften Prisma-6-Schema erzeugen und SQL
  reviewen; nur gegen leere disposable Entwicklungs-/Shadow-Datenbanken.
  Für das echte Ziel die geprüfte Kette mit `prisma migrate deploy` anwenden.
  Kein `migrate reset`, produktives `migrate dev` oder blindes `db push`.
- Die sechs fachlichen SQLite-Modelle bleiben die Importmenge. Eine zusätzliche
  PostgreSQL-only-Tabelle `MigrationCheckpoint` hält vor dem ersten App-Write
  einen dauerhaften, prozessübergreifenden Rollback-Grenzmarker. Ein fehlender
  Insert-Grant oder PG-Ausfall muss den Fachwrite verhindern; der Importer und
  die Sequence-Korrektur lehnen einen gesetzten Marker ab. Ein Marker kann nach
  einem fehlgeschlagenen Fachwrite konservativ zu früh, nie zu spät entstehen.
- Container-Migrationsrunner mit derselben gepinnten Prisma-Version und Schema-
  version wie das App-Image bereitstellen. Der aktuelle Runner hat keine
  ausdrücklich installierte Prisma-CLI. Nicht behaupten, ein Shell-Aufruf darin
  funktioniere bereits. Integration in die bestehende Deploymentstruktur
  konkret reviewen; kein unautorisierter dauerhafter neuer Service.
- Schema-Migration vor dem App-Start kontrolliert genau einmal ausführen;
  normale App-Starts prüfen Version/Readiness und führen keine Datenübernahme aus.
  `migrate deploy` allein beweist keinen driftfreien Datenbankzustand und erzeugt
  keinen Client. Generierung gehört in den Build, Driftprüfung in die Abnahme.
- Einen getesteten Maintenance-/Writer-Gate für die kontrollierte Startphase
  vorsehen: keine Queue-Aufnahme, keine Worker oder sonstigen Anwendungsschreib-
  pfade bis zur bewussten Schreibfreigabe. Eine DB-Health-/Settings-Leseprüfung
  darf nicht nebenbei Metadatenrefresh/Cachewrites oder neue Downloads starten.
- Datenbankrolle ohne Superuser/CREATEDB/CREATEROLE für den Appbetrieb. DDL-
  Berechtigungen des Migrationsrunners gesondert festlegen; keine globalen
  Grants auf andere Anwendungen. Runtime und Migration müssen denselben
  freigegebenen Primary erreichen. Ein etwaiger Proxy ist nicht automatisch
  PgBouncer; `pgbouncer=true` niemals ungeprüft setzen.
- Geplante Secret-Schnittstelle `DATABASE_URL_FILE` vor Prozessstart unterstützen
  und testen. Leeres/unlesbares Secret oder widersprüchliche URL/Datei-Konfiguration
  ablehnen. Nur im Prozessspeicher für Prisma auflösen, nicht auf Disk schreiben,
  nicht in Debug-/CLI-Ausgabe oder Kommandoargumenten offenlegen.
- Pool, Connect-/Query-/Retry-Budgets und Transport/TLS gemäß tatsächlich
  gewählter PostgreSQL-Konfiguration verifizieren. SQLite-Poolparameter nicht
  ungeprüft übernehmen; Netzwerkunterbruch/Fallback/Failover mit Mock oder
  isoliertem Testbetrieb abnehmen. Replikazahl zunächst unverändert lassen.

Providerwechsel benötigen eine eigene SQL-Historie; SQLite-Migrationsdateien
sind nicht portabel. Für produktive Migrationen gelten andere Kommandos als für
Entwicklung. Grundlage: [Prisma-6-Migrate-Grenzen](https://www.prisma.io/docs/orm/v6/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues)
und [Prisma-6-Development/Production](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).
Die [Prisma-6-PostgreSQL-Dokumentation](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql)
liefert Connector-/Typdetails. Auch dort Versionsabschnitte prüfen: Prisma-7-
Beispiele nicht unverändert auf den vorhandenen Client übertragen.

Der Server-Preflight verbindet die explizite
[Prisma-6-Versionsmatrix](https://www.prisma.io/docs/orm/v6/reference/supported-databases)
mit dem [PostgreSQL-Supportkalender](https://www.postgresql.org/support/versioning/)
(geprüft 30.09.2026): Majors 14–18 nur bis zum jeweiligen Supportende;
14 ab 12.11.2026 gesperrt. Bereits abgekündigte Majors und ungeprüfte neue
Majors brechen ab. Eine neue Matrix muss bewusst reviewt werden, nicht aus
aktuellen Prisma-8-Beispielen entstehen. Aktuelle Minor-/Sicherheitsupdates
bleiben eine Betriebsprüfung; ein bestandener Major-Gate beweist diese nicht.
Readiness, Preflight nach DDL und Import prüfen außerdem die echten
Ledgerchecksums sowie Tabellen, Spaltentypen/NULL/Defaults, PK/Unique/Indizes
und FK im gewählten eigenen Schema. Fremde Tabellen, Views, RLS oder eigene
Trigger/Rules sind kein freigegebener Importbereich. Diese Prüfung führt
kein DDL aus und gibt weder Default- noch Zeilenwerte aus.

## Datenvertrag: erhalten statt neu erzeugen

| Tabelle                               | Zwingend zu erhalten / prüfen                                                                                                                                   |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Config                                | Schlüssel und Werte exakt, inklusive vorhandener Settings/Credentials; niemals Klarwerte im Bericht                                                             |
| Download                              | IDs, Status, Fortschritt, BigInt-Bytewerte, Kategorie, URL, lokale Pfade, Fehler und Zeitpunkte sowie nullable P09-Erwartungs-/Prüfstrings; keine neue Queue-ID |
| GeneratedRuleset                      | IDs, Topic-Unique, Zuordnungen, Regex-/Filterstrings und Zeitpunkte; keine Regeneration als Migrationsersatz                                                    |
| TopicCategory                         | IDs, Topic-Unique, Kategorie, TMDB-Zuordnung und cachedAt                                                                                                       |
| TvdbSeries                            | Externe Serien-ID, Namen, Aliase, Cachezeiten und Beziehungen                                                                                                   |
| TvdbEpisode                           | IDs, Serien-FK, Staffel/Folge, Titel, Laufzeit, Datum; bestehende IDs und nächste generierte ID korrekt                                                         |
| \_prisma_migrations / sqlite_sequence | Nicht als Anwendungsdaten kopieren; Ziel erhält eigenes korrektes Ledger und echte PostgreSQL-Sequences                                                         |

Keine stillschweigende Cache-Löschung. Zeitfelder können in SQLite als Text oder
Integer vorliegen: Einheiten, UTC-Konvention und Millisekunden exakt feststellen.
BigInt-Werte ohne JavaScript-Number-Rundung übertragen, einschließlich Werten
oberhalb 2^53. NULL nicht in leeren String, 0 oder now() umwandeln. Strings mit
JSON/Regex bleiben zunächst Strings; keine beiläufige Json-/UUID-Typmigration.
Prisma-UUID-/CUID-Defaults können clientseitig sein: importierte IDs explizit
setzen und spätere Inserts über den echten Client testen.

### P11.3-Feldvertrag des vorbereiteten Preflight

Der aktuelle Preflight (`scripts/postgresql-preflight.mjs`) inspiziert alle sechs
Modelle, akzeptiert historische Bootstrap-/Prisma-Konturen sowie die aktuelle
append-only P07-Kontur mit kombiniertem Serien-/Topicindex und berichtet niemals
Zeileninhalte. Historische SQL-Dateien bleiben unverändert. Die
folgenden Regeln sind bereits als Eingangsprüfung implementiert; die
Import-/Vergleichsabnahme in P11.5–P11.6 steht noch aus.

| Quelle/Felder                                                                                                                                         | Abbildung bzw. Abbruch                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TvdbSeries.id`, `TvdbEpisode.id/seriesId/seasonNumber/episodeNumber/runtime`, `Download.progress`, `GeneratedRuleset.tvdbId`, `TopicCategory.tmdbId` | SQLite-Integer als BigInt lesen; nur innerhalb PostgreSQL-`integer`-Grenzen übernehmen. Externe TVDB-IDs bleiben unverändert, fehlende Pflichtwerte brechen ab.                                                                                                                                         |
| `Download.size/totalSize/downloadedBytes/speed`                                                                                                       | SQLite-Integer als BigInt bis zum vollständigen signierten Int64-Bereich erhalten, auch oberhalb 2^53; kein JS-Number-Zwischenschritt und kein Ersatzwert.                                                                                                                                              |
| Alle Textspalten inkl. `Config.key/value`, URL, Download-Pfad/Fehler, UUID-/CUID-IDs, Topic, Titel, Alias-/JSON- und Regex-Strings                    | Als Text exakt erhalten; kein JSON-Reparse, keine ID-Neugenerierung und keine Regex-Interpretation. SQLite-BLOB/Zahl oder NUL im Text werden abgelehnt, weil PostgreSQL-Text NUL nicht aufnehmen kann. Geheimwerte dürfen weder im Bericht noch im Log erscheinen.                                      |
| `firstAired`, `cachedAt`, `expiresAt`, `aired`, `createdAt`, `completedAt`, `updatedAt`                                                               | Nur explizite Unix-Millisekunden-Integer oder vollständiges ISO-8601 mit Offset und höchstens drei Dezimalstellen. In PostgreSQL `timestamptz(3)` als derselbe Zeitpunkt; gemischte Repräsentation pro Feld sowie naive/unklare Zeittexte brechen ab. Nicht belegte Zeiteinheiten werden nicht geraten. |
| Alle nullable Felder                                                                                                                                  | `NULL` bleibt `NULL`; erforderliche Werte werden gegen den PostgreSQL-Modellvertrag geprüft, auch wenn ein historisches SQLite-Bootstrap eine Spalte nullable angelegt hat. Kein `now`, `0` oder leerer Ersatzstring.                                                                                   |
| PK, `topic`-Unique und `TvdbEpisode.seriesId`-FK                                                                                                      | Quellspalten/-indizes/-FK gegen die historische Schemakontur prüfen, im Snapshot `foreign_key_check`; Original-IDs erhalten. Mengen- und Wertgleichheit bleibt P11.6-Gate.                                                                                                                              |
| `_prisma_migrations`, `sqlite_sequence`                                                                                                               | Nichtleere Ledger müssen zum erkannten Schema passen, vollständig abgeschlossen sein und die echten SQL-Checksums tragen. Keine Ledgerübernahme. Historische AUTOINCREMENT-Höchststände einschließlich gelöschter IDs für tatsächlich entsprechende PG-Sequence-Spalten erhalten.                       |

Ein mit SQLite `CURRENT_TIMESTAMP` erzeugter Text ohne Offset ist nachträglich
nicht zweifelsfrei von einem manuell geschriebenen lokalen Zeitwert zu
unterscheiden. Der Preflight verwirft ihn derzeit bewusst; eine spätere
Normalisierung benötigt einen ausdrücklich belegten Herkunfts-/Zeitzonenvertrag
für den echten Quellbestand. Auch Integer im betragsmäßig kleinen
Epochbereich (unter 100 Milliarden) sind als Sekunden oder Millisekunden
mehrdeutig und werden abgelehnt; sehr frühe echte Millisekundenwerte erfordern
ebenfalls Herkunftsevidenz. Ein WAL-Quellpfad wird nur statisch inventarisiert:
ein bloßes SQLite-Read-only-Open ändert dort SHM-Lockbytes. Die Inhaltsprüfung
läuft daher erst auf dem per Backup-API konsistent erzeugten privaten Snapshot.

## Runner- und Operationsreferenz

Lieferergebnisse stehen in P11.3–P11.8 der
[Phasen-TODOs](../todo/proxy-retirement.md), ihre freigegebene produktive
Ausführung in P10.2–P10.5. Runner und Runbookentwurf sind implementiert; die
vollständige Abnahme bleibt im TODO offen. Gewählt ist explizit typisierter Snapshotimport, kein blinder
pgloader-Schemagenerator.

Backupverfahren und die Trennung von Integrity-/FK-Prüfung stützen sich auf
die [SQLite-Backup-Dokumentation](https://www.sqlite.org/backup.html) und
[SQLite-PRAGMA-Dokumentation](https://www.sqlite.org/pragma.html#pragma_integrity_check).
Die Zielprüfung verwendet reale Sequence-Zuordnungen und die Semantik von
[PostgreSQL-Sequence-Funktionen](https://www.postgresql.org/docs/current/functions-sequence.html),
nicht einen kopierten Servarr-Sequence-Fix.

### Idempotenz und Abbruchverhalten

Run-ID bindet Sourcehash, Importer-, Schema- und Zielidentität. Ein identischer,
bereits validierter Lauf prüft erneut ohne Datenänderung. Ein abgebrochener Lauf
darf nur in seine eindeutig identifizierte Migration/Staging zurückkehren;
nie fremde Tabellen löschen, truncaten oder geänderte History mit upsert
überschreiben. Geänderte Quelle, schemafremdes oder inzwischen aktives Ziel:
Abbruch und neue Entscheidung. Secrets/Config-Payloads nicht im Manifest.
Ein Dateihash gilt nur für den final konsistenten Snapshot, nicht für eine
zwischenzeitlich weiter beschriebene Datenbank.

DDL, Rollenanlage und Sequence-Änderungen sind nicht gemeinsam atomar mit
allen Importdaten. Insbesondere setval wird nicht durch Transaktionsrollback
zurückgenommen. Deshalb klar getrennte Phasen, isoliertes Ziel und bewiesene
Resume-Regeln; keine Behauptung eines vollständig atomaren Gesamtcutovers.

## Rollback und Haltelinien

- **Vor dem ersten tatsächlichen Anwendungsschreibvorgang auf PostgreSQL:** neue App stoppen, Ziel erhalten,
  ursprünglichen SQLite-Image-Digest und ursprüngliche Konfiguration mit
  unveränderter Quelle wiederherstellen. Dieser Punkt gilt nur, solange noch
  keine neuen Anwendungsschreibvorgänge stattfanden und der persistente
  `MigrationCheckpoint` leer ist. Ein gesetzter Marker sperrt diesen einfachen
  Rückweg konservativ auch dann, wenn der Fachwrite später fehlschlug. Niemals PG-App-Image an
  SQLite oder altes SQLite-App-Image an die neue DB anschließen. Proxy/Routing bleibt.
- **Nach neuen PostgreSQL-Schreibvorgängen:** SQLite-Snapshot ist veraltet.
  Auch automatische Cache-/Settingswrites zählen, nicht erst ein manueller Grab.
  Kein automatisches Zurückschalten mit Datenverlust. Writer stoppen, PG-Backup
  sichern, Delta-/Job-/Importbestand und Dateieffekte abstimmen. Der primäre
  verlustfreie App-Rollback verwendet ein vorab getestetes PG-kompatibles Image
  mit demselben PG-Datenstand. Soll stattdessen SQLite wieder aktiv werden,
  ist ein getesteter, semantisch verlustfreier PG→SQLite-Rücktransfer in eine
  neue Datei mit Vergleich und gesicherter Umschaltung erforderlich. Bis dahin
  auf PG bleiben oder Betrieb pausieren; kein stiller Datenverlust.
- **Spätere Proxy-Umschaltung:** Rücknahme der URL-/Host-/Mapping-Änderungen
  bleibt unabhängig; dabei den gewählten Datenbankprovider beibehalten. Proxy- oder
  Matching-Rollback erfordert nicht automatisch einen DB-Rollback. Für P10.6 gilt
  zusätzlich das [GUID-Übergangsgate](proxy-retirement-cutover.md); es ist keine
  Betriebs- oder Deploymentfreigabe.
- Keine produktive Datenbank löschen und kein SQLite-Backup entfernen. Aufbewahrung
  und spätere Bereinigung brauchen eigene Freigabe. Dump/Backup kann Settings,
  Tokens und private Medien-URLs enthalten und gehört in geschützte Ablage.

## Pflichtabnahme und noch offene Betriebswerte

Die technische P11-Abnahme umfasst frische Installationen und Restart auf
beiden Backends, SQLite→PG-Bestandsmigration, CRUD/Settings, Queue/History,
Regeln/Caches, Secret-Ausfälle, DB-Ausfall/ggf. Proxy-Reconnect, Datenvergleich,
Retry/Resume und beide Rollback-Zeitpunkte in disposable Umgebungen. Nach
PG-Writes ist der Pflicht-Rollback ein PG-kompatibles Image mit erhaltenem
PG-Datenstand. Ein optionaler PG→SQLite-Rücktransfer muss vor einer solchen
Rückschaltung alle sechs fachlichen Modelle und spätere Schemaerweiterungen,
IDs, BigInt, Zeiten, NULL und Beziehungen in einer neuen Zieldatei erhalten
und semantisch vergleichen.
Tests nur eines Backends oder nur Tabellenname-Regex belegen das andere nicht.
Die echte Betriebsabnahme bleibt bei einem tatsächlich gewählten Cutover separat.

Vor jedem weiteren optionalen produktiven PG-Cutover konkret zu prüfen: tatsächliche Serverversion,
Sourcepfad und Schemafingerprint, DB-/Rollenname nach bestehender Konvention,
Secretnamen, gewählter Primary-/Transport-/TLS-Vertrag, berechtigte Runner-
Ausführung, Wartungsfenster, Datengröße/Importdauer, Backupablage, Retention und
geprobtes PG-kompatibles Rollbackimage. Ein optionaler Rücktransfer nach SQLite
benötigt eine eigene Abnahme. Keine dieser Betriebsangaben gehört als
konkreter Endpoint oder Secret in dieses öffentliche Repository.

Artefakte, Entscheidungen und Status werden nur in den Phasen-TODOs geführt.
Bis zu implementiertem Runner und geprobtem Runbook gibt es hier keine
vermeintlich fertigen Deploymentbefehle.
