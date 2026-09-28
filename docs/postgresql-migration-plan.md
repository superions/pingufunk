# Verbindliche PostgreSQL-Migration für Pingufunk

Stand: 28.09.2026. Ergänzung P11 zum
[Proxy-Ablöseplan](proxy-retirement-plan.md). **PostgreSQL ist ausdrücklich
beschlossen.** Dieses Dokument bleibt technische Referenz mit Ausgangsbefunden
und Daten-/Rollbackinvarianten. Einziger ausführbarer Entwicklungs- und
Freigabevertrag: [Phasen-TODOs](../todo/proxy-retirement.md), P11 und P10.
Keine Migration ausgeführt, keine Deploymentfreigabe.

## Entscheidung, Umfang und Reihenfolge

Pingufunk bekommt PostgreSQL als aktiven Datenbankbackend, auch wenn einzelne
Proxy-Fixes zuvor unabhängig fertig werden. Die Proxy-Ablösung P10 darf nicht
als abgeschlossen gelten, solange Pingufunk noch auf SQLite läuft.
P11 liefert implementierte und isoliert geprobte Bereitschaft nach P05 und
vor neuen Schemaerweiterungen aus P07/P09. Der echte PG-Cutover mit
Schreibfreigabe gehört P10, vor und getrennt von der Proxy-Umschaltung. Suchfixes P01–P04 bleiben frühe, kleine Nutzenschritte.

Dies betrifft **Pingufunks eigene Prisma-Datenbank**, nicht erneut die Sonarr-,
Radarr- oder Prowlarr-Datenbanken. Keine Servarr-main/log-Aufteilung erfinden:
Pingufunk benötigt eine eigene Datenbank mit seinen Anwendungstabellen.

Ziel im bestehenden Betrieb: vorhandene externe PostgreSQL-Infrastruktur,
Zugriff aus dem Swarm über den vorhandenen HAProxy-Weg. Kein neuer produktiver
PostgreSQL-Swarmservice, keine Übernahme fremder Anwendungsrollen. Networks,
Mounts, Downloads und Docker-Secret-/Deployment-Konventionen bleiben erhalten.
Konkrete private Endpunkte und Zugangsdaten stehen nicht in diesem öffentlichen
Repository. Die tatsächlich eingesetzte PostgreSQL-Version ist hier noch
**nicht live festgestellt** und bleibt ein verpflichtender Preflight-Gate.

## Verifizierter Ausgangsstand

Ausgangspunkt der ergänzenden Analyse: Fork-Commit 621df324e039ba78d4c7bf34f200ddceee345491,
Upstream a3b02a6e6ad827d6483700480b9bfbcc59a5823c. Lockfile: Prisma CLI und
Client jeweils **6.19.2**, Next.js 16.1.6. Kein beiläufiges Prisma-Major-Upgrade.

| Ort                                 | Befund                                                              | Erforderliche Änderung in P11                                              |
| ----------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| prisma/schema.prisma                | provider sqlite, sechs Modelle                                      | PostgreSQL-Provider und bewusst geprüfte Typen                             |
| prisma/migrations/                  | Drei SQLite-Migrationen, SQLite migration_lock                      | Neue PostgreSQL-Kette; alte unverändert archivieren                        |
| init-db.sql                         | Separates SQLite-Bootstrap, leere Kompatibilitäts-Ledgertabelle     | Kein aktives PostgreSQL-Bootstrap; durch versionierte Migrationen ersetzen |
| entrypoint.sh                       | SQLite-Datei fest verdrahtet, initialisiert und schreibt beim Start | Secret-Auflösung und PostgreSQL-Readiness; kein SQLite-Dateizugriff        |
| entrypoint.sh DEBUG                 | Gibt derzeit DATABASE_URL aus                                       | Unbedingt entfernen/redigieren, auch in Fehlerpfaden                       |
| Dockerfile                          | SQLite-URL als Default, sqlite/init-db.sql; Prisma-Client ohne CLI  | PostgreSQL-Client bauen, explizit ausführbarer Migrationsrunner            |
| .env.example und docker-compose.yml | SQLite-Defaults und Datenmount                                      | Dokumentierter PostgreSQL-Devvertrag ohne reale Credentials                |
| src/lib/db.ts                       | Gemeinsamer PrismaClient                                            | PostgreSQL-Konfiguration, begrenzter Pool und Lebenszyklus                 |
| src/lib/db-schema.test.ts           | Vergleicht nur Modell-/Bootstrap-Tabellennamen                      | Echte PostgreSQL-Schema-/CRUD-/Migrationsprüfung ergänzen                  |

Die historische erste SQLite-Migration erzeugt TvdbSeries.id mit AUTOINCREMENT,
das aktuelle Prisma-Modell verlangt dort hingegen eine explizite ID. init-db.sql
und Migrationen haben außerdem unterschiedliche Default-/Nullability-Details.
Darum sind tatsächliches Quellschema und gespeicherte Typen zu prüfen, nicht
nur der deklarierte Modelltext. Ein SQLite-Ledger kann fehlen/leer sein, obwohl
alle Tabellen durch das Container-Bootstrap existieren.

## Architektur und Artefakte der Umsetzung

- **Ein aktiver PostgreSQL-Prisma-Client und eine PostgreSQL-Migrationskette.**
  Historische SQLite-Schemata/SQL als unveränderte Wiederherstellungsinputs
  archivieren; kein automatischer Dual-Backend-Fallback. PostgreSQL-Ausfall
  darf weder neue SQLite-Dateien noch einen zweiten Datenbestand erzeugen.
- PostgreSQL-Baseline aus dem überprüften Prisma-6-Schema erzeugen und SQL
  reviewen; nur gegen leere disposable Entwicklungs-/Shadow-Datenbanken.
  Für das echte Ziel die geprüfte Kette mit `prisma migrate deploy` anwenden.
  Kein `migrate reset`, produktives `migrate dev` oder blindes `db push`.
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
  freigegebenen Primary erreichen; HAProxy ist kein PgBouncer und kein
  Anlass, `pgbouncer=true` ungeprüft zu setzen.
- Geplante Secret-Schnittstelle `DATABASE_URL_FILE` vor Prozessstart unterstützen
  und testen. Leeres/unlesbares Secret oder widersprüchliche URL/Datei-Konfiguration
  ablehnen. Nur im Prozessspeicher für Prisma auflösen, nicht auf Disk schreiben,
  nicht in Debug-/CLI-Ausgabe oder Kommandoargumenten offenlegen.
- Pool, Connect-/Query-/Retry-Budgets und TLS gemäß tatsächlich vorhandener
  PostgreSQL-/HAProxy-Konfiguration verifizieren. SQLite-Poolparameter nicht
  ungeprüft übernehmen; Netzwerkunterbruch/Fallback/Failover mit Mock oder
  isoliertem Testbetrieb abnehmen. Replikazahl zunächst unverändert lassen.

Providerwechsel benötigen eine eigene SQL-Historie; SQLite-Migrationsdateien
sind nicht portabel. Für produktive Migrationen gelten andere Kommandos als für
Entwicklung. Grundlage: [Prisma-6-Migrate-Grenzen](https://www.prisma.io/docs/orm/v6/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues)
und [Prisma-6-Development/Production](https://www.prisma.io/docs/orm/v6/prisma-migrate/workflows/development-and-production).
Die [Prisma-6-PostgreSQL-Dokumentation](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql)
liefert Connector-/Typdetails. Auch dort Versionsabschnitte prüfen: Prisma-7-
Beispiele nicht unverändert auf den vorhandenen Client übertragen.

## Datenvertrag: erhalten statt neu erzeugen

| Tabelle                               | Zwingend zu erhalten / prüfen                                                                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Config                                | Schlüssel und Werte exakt, inklusive vorhandener Settings/Credentials; niemals Klarwerte im Bericht                  |
| Download                              | IDs, Status, Fortschritt, BigInt-Bytewerte, Kategorie, URL, lokale Pfade, Fehler und Zeitpunkte; keine neue Queue-ID |
| GeneratedRuleset                      | IDs, Topic-Unique, Zuordnungen, Regex-/Filterstrings und Zeitpunkte; keine Regeneration als Migrationsersatz         |
| TopicCategory                         | IDs, Topic-Unique, Kategorie, TMDB-Zuordnung und cachedAt                                                            |
| TvdbSeries                            | Externe Serien-ID, Namen, Aliase, Cachezeiten und Beziehungen                                                        |
| TvdbEpisode                           | IDs, Serien-FK, Staffel/Folge, Titel, Laufzeit, Datum; bestehende IDs und nächste generierte ID korrekt              |
| \_prisma_migrations / sqlite_sequence | Nicht als Anwendungsdaten kopieren; Ziel erhält eigenes korrektes Ledger und echte PostgreSQL-Sequences              |

Keine stillschweigende Cache-Löschung. Zeitfelder können in SQLite als Text oder
Integer vorliegen: Einheiten, UTC-Konvention und Millisekunden exakt feststellen.
BigInt-Werte ohne JavaScript-Number-Rundung übertragen, einschließlich Werten
oberhalb 2^53. NULL nicht in leeren String, 0 oder now() umwandeln. Strings mit
JSON/Regex bleiben zunächst Strings; keine beiläufige Json-/UUID-Typmigration.
Prisma-UUID-/CUID-Defaults können clientseitig sein: importierte IDs explizit
setzen und spätere Inserts über den echten Client testen.

## Runner- und Operationsreferenz

Lieferergebnisse stehen in P11.3–P11.8 der
[Phasen-TODOs](../todo/proxy-retirement.md), ihre freigegebene produktive
Ausführung in P10.2–P10.5. Runner und operatorfertiges Runbook existieren
noch nicht. Gewählt ist explizit typisierter Snapshotimport, kein blinder
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
  keine neuen Anwendungsschreibvorgänge stattfanden. Niemals PG-App-Image an
  SQLite oder altes SQLite-App-Image an die neue DB anschließen. Proxy/Routing bleibt.
- **Nach neuen PostgreSQL-Schreibvorgängen:** SQLite-Snapshot ist veraltet.
  Auch automatische Cache-/Settingswrites zählen, nicht erst ein manueller Grab.
  Kein automatisches Zurückschalten mit Datenverlust. Writer stoppen, PG-Backup
  sichern, Delta-/Job-/Importbestand abstimmen. Vor Produktion entweder ein
  getesteter Rücktransfer oder ein ausdrücklich akzeptiertes RPO mit benannten
  Verlusten und Wartungsfenster; kein stilles Verwerfen von History/Downloads.
- **Spätere Proxy-Umschaltung:** Rücknahme der URL-/Host-/Mapping-Änderungen
  bleibt unabhängig; dabei grundsätzlich PostgreSQL beibehalten. Proxy- oder
  Matching-Rollback erfordert nicht automatisch einen DB-Rollback. Für P10.6 gilt
  zusätzlich das [GUID-Übergangsgate](proxy-retirement-cutover.md); es ist keine
  Betriebs- oder Deploymentfreigabe.
- Keine produktive Datenbank löschen und kein SQLite-Backup entfernen. Aufbewahrung
  und spätere Bereinigung brauchen eigene Freigabe. Dump/Backup kann Settings,
  Tokens und private Medien-URLs enthalten und gehört in geschützte Ablage.

## Pflichtabnahme und noch offene Betriebswerte

Die technische P11-Abnahme umfasst frische Installation und Bestandsmigration,
Restart, CRUD/Settings, Queue/History, Regeln/Caches, Secret-Ausfälle,
DB-Ausfall/HAProxy-Reconnect, Datenvergleich, Retry/Resume sowie beide
Rollback-Zeitpunkte gegen disposable PostgreSQL. Tests mit
SQLite allein oder nur Tabellenname-Regex sind kein PostgreSQL-Nachweis.
Die echte Betriebsabnahme bleibt zusätzlich P10 vorbehalten.

Vor produktiver Ausführung offen: tatsächliche Serverversion, Sourcepfad und
Schemafingerprint, DB-/Rollenname nach bestehender Konvention, Secretnamen,
HAProxy-Primary-/TLS-Vertrag, berechtigte Runner-Ausführung, Wartungsfenster,
Datengröße/Importdauer, Backupablage, Retention und RPO/Rücktransferentscheidung.
Diese offenen Betriebswerte machen **nicht die PostgreSQL-Entscheidung optional**.

Artefakte, Entscheidungen und Status werden nur in den Phasen-TODOs geführt.
Bis zu implementiertem Runner und geprobtem Runbook gibt es hier keine
vermeintlich fertigen Deploymentbefehle.
