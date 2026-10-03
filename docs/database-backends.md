# Datenbankbackend wählen

SQLite und PostgreSQL sind gleichwertig unterstützt, ohne fachlich bevorzugten
Standard. Ohne PostgreSQL-Konfiguration wird SQLite verwendet. Eine fehlerhafte
oder unvollständige PG-Konfiguration sowie ein Verbindungsfehler wechseln niemals
den Provider. Beide Prisma-Clients werden
mit der gepinnten Version 6.19.3 bei `npm ci` generiert. Historische SQLite-SQL
bleibt unverändert unter `prisma/legacy/sqlite/migrations/`; PostgreSQL verwendet
seine eigene Kette unter `prisma/migrations/`.

## Lokale Entwicklung mit SQLite

`.env.example` beschreibt `DATABASE_URL=file:./data/rundfunkarr.db`.
Der Provider wird ohne Schalter aus dem URL-Protokoll erkannt, auch nach
sicherem Auflösen einer `DATABASE_URL_FILE`: `file:` wählt SQLite,
`postgres:`/`postgresql:` wählen PostgreSQL. Ohne URL/Secret und ohne explizite
PG-Auswahl wird die bisherige SQLite-Datei verwendet. Der optionale
`DATABASE_PROVIDER` ist eine Konsistenzbehauptung: Widerspruch zur URL ist ein
Fehler, kein Ausweichweg. Explizites postgresql ohne URL ist ebenfalls ungültig.
Relative Dateipfade bleiben relativ
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

Seit P07 benötigt der Appstart den aktuellen kombinierten Serien-/Topicindex
und das vollständig ausgeführte Ledger. Historisches Container-Bootstrap mit
leerem Ledger wird nicht still adoptiert. Der geprüfte kopierende Übergang
steht unter [SQLite-Bestandsübergang](sqlite-baseline-transition.md).
Normale Migrationen eines bereits vollständig migrierten SQLite-Bestands
verwenden die append-only Kette; vor deren produktiver Ausführung sichern und
separat freigeben. Keine Ledger-Manipulation, `db push` oder Reset-Abkürzung.

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

### PostgreSQL mit oder ohne TLS

Der Transport wird in derselben geschützten URL für App und Migrator festgelegt:
`sslmode=require` verlangt TLS, `sslmode=disable` wählt ausdrücklich eine
unverschlüsselte Verbindung. Das funktioniert direkt oder über einen passenden
TCP-Proxy, ohne eine bestimmte Infrastruktur vorauszusetzen. Keine zusätzliche
Umgebungsvariable, kein Umschalten nach einem Verbindungsfehler.

Die Migrationsprüfung verlangt ohne Parameter weiterhin tatsächlich TLS.
`sslmode=prefer` ist für den Cutover nicht zulässig: Prisma könnte damit auf
Klartext zurückfallen. Bestehende Laufzeitkonfigurationen mit Prisma-Default
`prefer` werden nicht automatisch umgeschrieben; für einen kontrollierten
Cutover App- und Runner-Secret ausdrücklich identisch auf `require` oder
`disable` setzen. Doppelte, leere oder unbekannte Modi werden abgelehnt.
Preflight, DDL-Vorbereitung, Import/Resume, Vergleich und Sequence-Transaktion
prüfen den gewählten Transport neben Primary/Rolle/Schema. Die tatsächliche
TLS-Eigenschaft gehört zur Importidentität; ein Transportwechsel ist kein Resume.

Ohne TLS sind DB-Daten und Verbindungsverkehr nicht verschlüsselt; dies ist eine
bewusste installationsbezogene Entscheidung, kein Ersatz für Zugriffsschutz.
Secrets bleiben außerhalb Git. Grundlage:
[Prisma-6-PostgreSQL-Connector](https://www.prisma.io/docs/orm/v6/overview/databases/postgresql).

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
