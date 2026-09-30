# Pingufunk PostgreSQL: Migrations-Runbook (Entwicklungsstand)

Stand: 30.09.2026. Dies ist ein **noch nicht produktiv freigegebenes** Runbook
für P11.3–P11.8. Die Befehle für Snapshot, Import, Verifikation und Sequences
entsprechen den implementierten CLI-Einstiegen im `migrator`-Image. Sie wurden
mit synthetischen Daten gegen disposable PostgreSQL 17 erprobt, aber **nicht**
gegen eine konkrete produktive Netz-/DB-Topologie. P10.2 muss bei PG-Wahl die
unten benannten Betriebswerte, Image-Digests, Rolle und Rollbacks konkret
einsetzen; P10.3–P10.7
brauchen jeweils ihre eigene Freigabe. Bis dahin: kein Deployment, keine echte
SQLite-Quelle öffnen und keine produktive PostgreSQL-Datenbank beschreiben.

## Haltelinien vor jeder Ausführung

1. Tatsächliche Quelle, Dateisystem, Journal-/WAL-/SHM-Status, Tabellenstand,
   Datenmenge, SQLite-Image-Digest und Backupablage belegen. Quell-DB nicht
   kopieren, reparieren, checkpointen oder löschen. Die Backup-API darf bei WAL
   kurzzeitig SHM-Lockbytes verändern; die Hauptdatei bleibt unverändert.
2. Bestehenden Proxy/Routing unverändert lassen. App-Writer und Worker vor der
   Aufnahme stoppen; SQLite-Quellkonfiguration und altes Image unveränderlich
   für Rollback aufbewahren. Keine zwei App-Writer parallel zulassen.
3. Eigene Pingufunk-DB und Rollen nach privater Namenskonvention vorbereiten.
   Laufzeit-/Importrolle ohne SUPERUSER, CREATEDB und CREATEROLE; DDL-Runner
   separat auf die eigene DB begrenzen. Nicht Servarr-main/log oder andere
   Anwendungsschemata verwenden. Tatsächliche PostgreSQL-Version, Primary,
   gewählten Endpunkt, Transport/TLS, Network und Secret-Mount read-only prüfen.
   Weder HAProxy noch ein anderer Zugriffsweg ist vorgegeben. Für die
   eigene leere DB die gepinnte Prisma-6.19.2-Kette mit `migrate deploy`
   anwenden; Appstarts führen das nicht aus.
4. Secretdateien und Snapshots liegen außerhalb Git mit privaten Rechten.
   `DATABASE_URL_FILE` wird vor dem Drop auf den unprivilegierten User gelesen;
   weder URL noch Passwort in Argumenten, Debug-Ausgaben oder Run-Reports.
   DDL- und Runtime-/Importrollen erhalten getrennte Secretdateien. Die
   CLI-Argumente unten enthalten bewusst nur nichtgeheime Identitäten.
   Die Runtime-Rolle braucht zusätzlich INSERT/SELECT auf der eigenen
   `MigrationCheckpoint`-Tabelle; fehlen diese Rechte, bleiben App-Writes
   gesperrt. Der Import-/Sequence-Runner benötigt dort SELECT.
5. Ein naive SQLite-Zeittext (`YYYY-MM-DD HH:MM:SS`) wird zurzeit abgelehnt,
   selbst wenn eine Spalte `CURRENT_TIMESTAMP` als Default hat. Herkunft und
   Zeitzone müssen vor einer freigegebenen Normalisierung belegt sein. Keine
   geratenen Zeiteinheiten oder Ersatzwerte.

## Befehlsfolge für eine disposable Probe

Der vollständig synthetische Containerpfad (direktes TLS zu kurzlebigem
PostgreSQL ohne vorgeschalteten Proxy) ist aus diesem Checkout reproduzierbar:

```sh
docker build --target migrator -t pingufunk-p11-migrator-qa .
docker build --target runner -t pingufunk-p11-runtime-qa .
bash scripts/postgresql-container-smoke.sh
```

Das Skript verwendet ein eigenes Docker-Netz und nur ignorierte temporäre
Dateien unter `downloads/`; sein Exit-Trap entfernt die selbst erzeugten
Container, das Netz und die synthetischen Dateien. Es benutzt keine private
SQLite-Datei und keinen bestehenden PostgreSQL-Endpunkt. Im Smoke laufen
Snapshot und Import mit derselben Host-UID, damit das private `0700`-Backup
unter Linux tatsächlich lesbar ist. Der produktive Runner bleibt bei seiner
festen Image-UID; sein Backup-Mount muss separat auf genau diese UID geprüft
werden, bevor reale Daten geöffnet werden.

Alle Platzhalter stammen aus dem isolierten Testlauf bzw. müssen für den
konkreten **privaten** Betrieb separat belegt werden. Die folgenden Variablen
sind Pfade/Identitäten, keine URLs oder Passwörter. `IMAGE` ist das lokal
gebaute, per Digest festgehaltene `migrator`-Image aus genau demselben Commit
wie das spätere App-Image. `PG_SECRET_FILE` enthält die vollständige URL
mit den Parametern des geprüften Transports und bleibt außerhalb Git. Der
Operator setzt zusätzlich
den konkreten, geprüften Container-Networkpfad zum gewählten PostgreSQL-
Endpunkt ein; eine besondere Proxy- oder Swarm-Topologie wird nicht erfunden.

```sh
# Eingaben lokal und geschützt festlegen; hier absichtlich keine Beispielwerte.
# IMAGE=… SOURCE_DIR=… SQLITE_NAME=… BACKUP_PARENT=… RUN_NAME=…
# DDL_SECRET_FILE=… PG_SECRET_FILE=… PG_NETWORK=… PG_DATABASE=…
# PG_ROLE=… PG_ENDPOINT_HOST=…

# 1. Konsistenter SQLite-Snapshot in einem NEUEN privaten Unterverzeichnis.
#    BACKUP_PARENT muss für UID/GID 1000:1000 privat beschreibbar sein;
#    die nur lesend gemountete Quelle für denselben User lesbar.
docker run --rm --user 1000:1000 --entrypoint node \
  --mount "type=bind,src=${SOURCE_DIR},dst=/source,readonly" \
  --mount "type=bind,src=${BACKUP_PARENT},dst=/backup" \
  "${IMAGE}" /app/scripts/postgresql-snapshot.mjs \
  "/source/${SQLITE_NAME}" "/backup/${RUN_NAME}"

# 2. Separat mit DDL-Rolle und gleicher Image-/Schema-Version: migrate deploy.
docker run --rm --network "${PG_NETWORK}" \
  --mount "type=bind,src=${DDL_SECRET_FILE},dst=/run/secrets/pingufunk_pg,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/pingufunk_pg "${IMAGE}"

# 3. Ab hier Runtime-/Importrollen-Secret verwenden. Read-only Preflight;
#    PG muss Primary, versionstauglich und gemäß gewähltem Transport geschützt sein.
docker run --rm --network "${PG_NETWORK}" \
  --mount "type=bind,src=${BACKUP_PARENT},dst=/backup,readonly" \
  --mount "type=bind,src=${PG_SECRET_FILE},dst=/run/secrets/pingufunk_pg,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/pingufunk_pg "${IMAGE}" \
  node /app/scripts/postgresql-preflight.mjs \
  "/backup/${RUN_NAME}/source.sqlite" "${PG_DATABASE}" "${PG_ROLE}" "${PG_ENDPOINT_HOST}"

# 4. Ausschließlich nach bewiesener Writer-Pause: Import. SHA256 ist der
#    Wert aus dem Snapshot-Report, nicht der Hash einer laufenden Hauptdatei.
docker run --rm --network "${PG_NETWORK}" \
  --mount "type=bind,src=${BACKUP_PARENT},dst=/backup" \
  --mount "type=bind,src=${PG_SECRET_FILE},dst=/run/secrets/pingufunk_pg,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/pingufunk_pg "${IMAGE}" \
  node /app/scripts/postgresql-migration-cli.mjs import \
  --snapshot "/backup/${RUN_NAME}/source.sqlite" --sha256 "${SNAPSHOT_SHA256}" \
  --database "${PG_DATABASE}" --role "${PG_ROLE}" --host "${PG_ENDPOINT_HOST}" \
  --confirm-writers-stopped

# 5. Erneut lesend vergleichen; ein fremdes/geändertes Ziel stoppt.
docker run --rm --network "${PG_NETWORK}" \
  --mount "type=bind,src=${BACKUP_PARENT},dst=/backup,readonly" \
  --mount "type=bind,src=${PG_SECRET_FILE},dst=/run/secrets/pingufunk_pg,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/pingufunk_pg "${IMAGE}" \
  node /app/scripts/postgresql-migration-cli.mjs verify \
  --snapshot "/backup/${RUN_NAME}/source.sqlite" --sha256 "${SNAPSHOT_SHA256}" \
  --database "${PG_DATABASE}" --role "${PG_ROLE}" --host "${PG_ENDPOINT_HOST}"

# 6. Weiterhin ohne Writer: nur die im PG-Katalog tatsächlich zugeordneten
#    Sequences korrigieren. setval ist NICHT transaktional; bei Fehler bleibt
#    der Writer gestoppt und derselbe validierte Lauf wird erneut geprüft.
#    Nach JEDEM App-Write ist dieser Schritt gesperrt, selbst wenn Tabellen
#    inzwischen wieder leer aussehen.
docker run --rm --network "${PG_NETWORK}" \
  --mount "type=bind,src=${BACKUP_PARENT},dst=/backup,readonly" \
  --mount "type=bind,src=${PG_SECRET_FILE},dst=/run/secrets/pingufunk_pg,readonly" \
  -e DATABASE_URL_FILE=/run/secrets/pingufunk_pg "${IMAGE}" \
  node /app/scripts/postgresql-migration-cli.mjs sequences \
  --snapshot "/backup/${RUN_NAME}/source.sqlite" --sha256 "${SNAPSHOT_SHA256}" \
  --database "${PG_DATABASE}" --role "${PG_ROLE}" --host "${PG_ENDPOINT_HOST}" \
  --confirm-writers-stopped --confirm-no-app-writes-since-import
```

Die Shell-Platzhalter sind **kein** fertiger Produktions-Deploybefehl. Vor
Benutzung jeden expandierten Pfad und Netzwerk-/Rollenbezug per read-only
Kontrolle prüfen; `SOURCE_DIR` darf nicht breit auf ein fremdes Volume zeigen.
Der Snapshot-Report enthält seinen finalen Hash und Zählungen, aber keine
Config-/URL-Inhalte. `import-manifest.json` ist 0600 und bleibt beim Snapshot.
Ein fremdes Ziel ohne passendes Manifest wird nicht adoptiert. Ein Abbruch
innerhalb der Importtransaktion lässt die Anwendungsdaten leer; der identische
Pending-Lauf kann nach Ursachenbehebung wiederholt werden. Nach Commit, aber
vor Manifestabschluss wird zuerst jede Zeile lesend geprüft und erst dann
dieselbe Run-ID als validiert markiert. Veränderte Quelle, Image-/Schemahashes
oder Zielidentität stoppen. Keine Truncate-/Drop-/Reset-/Upsert-Abkürzung.

## Start, Pausen und Rückwege

Der neue App-Container startet standardmäßig mit
`PINGUFUNK_WRITES_ENABLED=0`; er prüft die PG-Migrationskette, führt aber
kein DDL und keinen Import aus. Erst eine separat freigegebene
Schreibfreigabe setzt `PINGUFUNK_WRITES_ENABLED=1` bei genau einem Worker.
Readiness, Settings und History ohne Seiteneffekt prüfen; dann tatsächliche
Queue-/History-/Regel-/Cachewrites in der Probe validieren. Vor dem ersten
Prisma-Modellwrite wird `MigrationCheckpoint` unabhängig und dauerhaft
geschrieben; falls dies fehlschlägt, unterbleibt der Fachwrite. Der Marker
kann bei einem später gescheiterten Fachwrite konservativ zu früh gesetzt
sein. Ein zusätzlicher Logeintrag meldet den ersten erfolgreichen Modellwrite
pro Prozess, ist aber keine Rollback-Entscheidungsgrundlage.

- **Vor dem ersten neuen PG-Anwendungswrite und bei leerem Checkpoint:** Neue App/Writer stoppen,
  PG-Ziel/Manifest/Backups erhalten, ursprüngliches SQLite-Image mit
  unveränderter Quelle/Konfiguration wiederherstellen. Proxy und Routing
  bleiben. Niemals ein PG-Image mit SQLite oder umgekehrt verbinden.
- **Nach einem neuen PG-Anwendungswrite:** Altes SQLite ist veraltet.
  Writer stoppen, PG-Backup sichern und Jobs, Settings, Cache, Regeln und
  Dateieffekte abgleichen. Ein semantisch verlustfreier PG→SQLite-Rücktransfer
  in eine neue Datei ist noch nicht implementiert oder abgenommen; daher
  **keine automatische SQLite-Rückschaltung**. Vor produktiver PG-
  Schreibfreigabe muss stattdessen ein PG-kompatibles Rollbackimage mit
  unverändertem PG-Datenstand getestet sein. Der SQLite-Proxy-Ausstieg bleibt
  davon unabhängig.
- **Nach späterer Proxy-Umschaltung:** Nur Proxy-/Indexer-/SAB-Routen
  zurücksetzen und den gewählten Datenbankprovider beibehalten. GUID-Doppelgrab-
  Risiko und Freigabegrenzen stehen im Proxy-Cutover-Runbook.

SQLite-Dateien, PG-Backups, Manifest und Images bleiben erhalten; eine
spätere Löschung/Retention erfordert separate Freigabe. Bei jedem Fehler
anhalten, Writer nicht automatisch starten und Ursache plus redigierten
Zustandsbericht prüfen. Dieses Runbook ist erst nach dem vollständigen P11.7-
Harness und P10.2-Parameterabgleich operatorfertig.
