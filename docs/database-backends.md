# Datenbankbackend wählen

SQLite ist der Standard; PostgreSQL ist eine ausdrückliche Option. Ein
Verbindungsfehler wechselt niemals den Provider. Beide Prisma-Clients werden
mit der gelockten Version 6.19.2 bei `npm ci` generiert. Historische SQLite-SQL
bleibt unverändert unter `prisma/legacy/sqlite/migrations/`; PostgreSQL verwendet
seine eigene Kette unter `prisma/migrations/`.

## Lokale Entwicklung mit SQLite

`.env.example` beschreibt `DATABASE_PROVIDER=sqlite` und
`DATABASE_URL=file:./data/rundfunkarr.db`. Relative Dateipfade bleiben relativ
zum ursprünglichen `prisma/`-Verzeichnis, nicht zum neuen Schema-Unterordner.
Vor einer **neuen disposable Entwicklungsinstallation** das Elternverzeichnis
anlegen und den ausdrücklich ausgewählten Migrator ausführen:

```sh
npm ci
mkdir -p prisma/data
npm run db:migrate
npm run dev
```

`db:migrate` erstellt nötigenfalls exklusiv eine leere SQLite-Datei und führt
die versionierte SQL-Kette aus. Normale Starts erstellen keine Datei und
wenden weder DDL noch einen Import an. Ein fehlendes, unbekanntes oder
inkonsistentes Schema stoppt den Start. Bestehende Datenbanken zuerst sichern;
die obige Fresh-Install-Folge ist **keine** Bestandsmigrationsanleitung.

Historisches Container-Bootstrap mit vollständigen Tabellen und leerem
Prisma-Ledger wird beim Start rein lesend geprüft und nicht umgeschrieben.
`migrate deploy` adoptiert diesen Bestand nicht automatisch; keine Ledger-
Manipulation, `db push` oder Reset-Abkürzung verwenden. Eine spätere SQLite-
Schemaerweiterung benötigt dafür einen explizit getesteten Baselineübergang.

## Container und PostgreSQL-Option

`docker-compose.yml` behält den SQLite-Datenmount. Ein Fresh Install braucht
vorher einen schema-/imagegleichen One-shot-Migrator und korrekte Schreibrechte
für den gewählten UID/GID; der Runner verändert SQLite-Dateirechte nicht.

`docker-compose.postgresql.yml` ist ein optionaler Override. Es setzt
`DATABASE_PROVIDER=postgresql`, entfernt die SQLite-URL und mountet eine
private Secretdatei. `PINGUFUNK_DATABASE_URL_SECRET_FILE` enthält **nur deren
absoluten lokalen Pfad**, niemals die URL. Datei außerhalb Git, URL gemäß dem
tatsächlich gewählten Transport; keine bestimmte Proxy-/Swarm-Topologie.

```sh
# Nur Konfiguration prüfen, kein Deployment:
docker compose -f docker-compose.yml -f docker-compose.postgresql.yml config --quiet
```

Bei PostgreSQL sind `DATABASE_URL` und `DATABASE_URL_FILE` alternativ; gleichzeitig,
leer oder mit unpassendem Provider wird abgebrochen. Auch die lokalen Start-/
Migrationswrapper laden Nexts `.env`-Reihenfolge und lösen Secretdateien auf.
Aufgelöste URLs werden weder geloggt noch als Prozessargument weitergegeben.
PostgreSQL startet standardmäßig im Schreibstopp (`PINGUFUNK_WRITES_ENABLED=0`),
SQLite regulär schreibend. Der Schalter ist explizit überschreibbar; niemals
zwei Worker auf denselben Datenbestand starten.

Produktiver PG-Cutover bleibt separat freigabepflichtig. Siehe
[Migrations-Runbook](postgresql-migration-runbook.md) für Snapshot, Zielidentität,
Import, Vergleich, Sequences und die Rollbackgrenze nach dem ersten PG-Write.

## Reproduzierbare Entwicklungsprüfung

```sh
npm test
npm run test:pg
docker build --target migrator -t pingufunk-p11-migrator-qa .
docker build --target runner -t pingufunk-p11-runtime-qa .
bash scripts/sqlite-container-smoke.sh
bash scripts/postgresql-container-smoke.sh
```

Nur eigene kurzlebige Testressourcen und synthetische Daten; keine produktiven
Endpunkte, Bibliotheksabfragen oder Downloads. Der SQLite-Container läuft ohne
Netzzugang. Beide Smoke-Skripte räumen ihre eigenen Fixtures/Container auf.
