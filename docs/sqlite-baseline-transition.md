# SQLite-Bestandsübergang für gemeinsame Serientopics

P07 ändert ausschließlich den Unique-Owner von `GeneratedRuleset.topic` zu
`GeneratedRuleset(tvdbId, topic)`. IDs, Regex, Filter und übrige Modelle bleiben
erhalten. `TopicCategory.topic` bleibt eindeutig. Beide Prisma-Clients bilden
dieselbe Fachstruktur ab; PostgreSQL und vollständig migriertes SQLite haben
je eine neue append-only Indexmigration. Historische Migrationen bleiben
unverändert. Normale Starts führen weiterhin weder DDL noch Import aus.

Ein historisches Container-Bootstrap hat einen inline Unique-Index und ein
leeres Ledger. Es ist nicht zulässig, dort frühere Migrationen blind als
ausgeführt zu markieren oder deren SQL über vorhandene Tabellen abzuspielen.
`scripts/sqlite-baseline.mjs` erstellt deshalb eine **neue** SQLite-Datei, führt
dort mit der gelockten Prisma-Version die tatsächliche vollständige Kette aus
und kopiert anschließend alle sechs fachlichen Modelle in einer Transaktion.
Quellledger wird nicht kopiert. Jede Spalte/NULL-/Integer-/Textdarstellung muss
zeilenweise dieselbe bleiben; Bootstrap-NULLs, die das neue Schema nicht zulässt,
brechen ab statt durch erfundene Werte ersetzt zu werden. Schema-Fingerprint,
Integrity/FK, BigInt-Präzision und historische Autoincrement-Hochwassermarken
werden berücksichtigt. Die ursprüngliche Datei bleibt unverändert.

## Ablauf nach separater Betriebsfreigabe

Writer stoppen; ursprünglichen Image-Digest, Konfiguration, Sourcepfad und
File-/Jobbestand sichern. Der schemaidentische Migrator braucht einen sichtbaren
Mount und Schreibrechte im **privaten** Zielverzeichnis (0700). Source-Backup
außerhalb Git aufbewahren. Die folgenden Variablen sind ausschließlich vom
Betreiber geprüfte absolute Pfade bzw. der Snapshot-Hash, keine Zugangsdaten:

```sh
node scripts/postgresql-snapshot.mjs "$SQLITE_SOURCE" "$NEW_PRIVATE_BACKUP_DIRECTORY"
# SHA-256 aus dem erfolgreichen Snapshotbericht übernehmen und verifizieren.
node scripts/sqlite-baseline.mjs "$SQLITE_SNAPSHOT" "$SNAPSHOT_SHA256" \
  "$NEW_SQLITE_TARGET" --confirm-writers-stopped
```

Der Snapshot verwendet SQLite Backup-API und prüft den privaten konsistenten
Stand vollständig. Die Baseline akzeptiert keine WAL/SHM-Snapshot-Sidecars,
kein unbekanntes Schema, keinen fremden bestehenden Zielbestand und keine
Quelle als Ziel. Ein privates 0600-Manifest bindet Source-/Daten-/Schemahash.
Ein identischer abgeschlossener Lauf wird lesend verglichen, nicht erneut
importiert. Ein veränderter Bestand abortiert. Bei Fehlern bleiben Quelle,
Backup, Manifest und Ziel erhalten; keine automatische Bereinigung oder
Umschaltung. Ein Fehler beim Tabellenimport rollt dessen Transaktion zurück;
vorherige Ziel-DDL ist bewusst nicht Teil dieser Atomaritätsbehauptung.

Erst nach erfolgreichem Vergleich die eigene `DATABASE_URL` auf die neue Datei
umstellen, imagegleichen Appstart im Maintenancebetrieb prüfen und Writer
bewusst freigeben. Mounts, Netzwege und Secretmanager sind installationsabhängig.
Im Container werden dieselben Einstiegsskripte unter `/app/scripts/` mit
Containerpfaden benutzt; niemals einen nicht sichtbaren Hostpfad behaupten.

## Rollback

Vor neuen Appwrites: neue App stoppen, ursprüngliches Image und unveränderte
SQLite-Datei/Konfiguration wieder auswählen. Die alte Datei und ihre Historie
bleiben vorhanden. Nach neuen Writes ist sie veraltet: keine stille Rückkehr
mit Datenverlust. Writer stoppen, neuen Bestand sichern und ein schema-
kompatibles Rollbackimage verwenden. Ein Rücktransfer/Downgrade auf das alte
globale Topic-Unique würde zwei Serien im selben Topic nicht mehr abbilden;
keine Löschung oder Zusammenführung solcher Regeln zur Herstellung eines
grünen Downgrades. Betriebsabnahme und Dateieffekte bleiben separat nötig.

Entwicklungsproben verwenden nur synthetische Quellen und neu angelegte
disposable Backends. Sie ersetzen weder eine Produktionsfreigabe noch den
Preflight der tatsächlichen Datenwerte und Mountrechte.
