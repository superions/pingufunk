# Isolierte Arr-Testinstanzen

Am 01.10.2026 ausdrücklich genehmigt und lokal eingerichtet: Sonarr
**4.0.20.3014**, Radarr **6.4.4.10685**, Prowlarr **2.6.5.5623** und das
Pingufunk-Testimage des Produktstands `59f6c4e` (keine Produktänderung gegenüber
`8de3148`). Versionen aus den laufenden `/api/v3/system/status` bzw.
`/api/v1/system/status`, nicht aus `latest` geraten. ARM64-Testumgebung.

Ein eigenes `--internal` Docker-Netz, nur die vier eigenen Container und
eigene bind-gemountete Verzeichnisse unter dem ignorierten `downloads/arr-qa.*`.
Kein Host-/Produktionsnetz, keine bestehenden DBs, kein Swarm/HAProxy-Szenario.
Docker veröffentlicht auf diesem internen Netz keine nutzbaren Hostports;
Steuerung erfolgt per `docker exec` im eigenen Pingufunk-Controller.
Keine Anmeldung an TVDB/TMDB, keine realen Bibliotheken, Grabs oder Medien.
Die synthetische Katalogquelle sperrt externes Fetch; Arr-API-Zugriffe sind auf
die eigenen festen Netzaliasnamen begrenzt und verbieten Redirects. Das interne
Netz verhindert zusätzlich externe Verbindungen aus den Arr-Prozessen.

Die API-Keys sind frisch erzeugte Testsecrets in den privaten `config.xml`-
Dateien (Modus 0600; Verzeichnisse 0700), nicht im Manifest, Git, argv oder URL.
Der Controller erhält Header/Body nur über stdin. Keine Rohkonfiguration oder
Fehlerpayloads drucken. Mount, Imageidentität, Netzwerk und Ownerlabel werden vor
Status-/API-/Stopoperationen geprüft. Andere Container bleiben unangetastet.

## Aufbau und Steuerung

Node 24 verwenden. Imagequellen und Mountkonventionen stammen aus den
[Sonarr](https://docs.linuxserver.io/images/docker-sonarr/)-,
[Radarr](https://docs.linuxserver.io/images/docker-radarr/)- und
[Prowlarr](https://docs.linuxserver.io/images/docker-prowlarr/)-Image-Dokumentationen.
Laufende APIs liefern die jeweiligen tatsächlichen Schemas; keine statisch
kopierten Feldlisten für eine andere Version als Abnahme verwenden.

```sh
docker pull lscr.io/linuxserver/sonarr:latest
docker pull lscr.io/linuxserver/radarr:latest
docker pull lscr.io/linuxserver/prowlarr:latest
docker build --target runner -t pingufunk-p10-arr-qa .
docker build --target migrator -t pingufunk-p10-arr-migrator-qa .
node scripts/arr-test-instances.mjs up
```

`up` erstellt immer eine **neue** private QA-Installation und initialisiert nur
deren neue SQLite-Datei. Keine Migration existierender Daten. Image-IDs werden
im ignorierten Manifest festgehalten und für die Containerstarts verwendet;
ein später erneut gezogenes `latest` verändert laufende Instanzen nicht.
Den ausgegebenen eigenen `QA_DIRECTORY`-Pfad als `QA_DIR` setzen:

```sh
node scripts/arr-test-instances.mjs status "$QA_DIR"
node scripts/arr-test-instances.mjs schemas "$QA_DIR"
node scripts/arr-test-instances.mjs connections "$QA_DIR" sonarr
node scripts/arr-test-instances.mjs connections "$QA_DIR" prowlarr
node scripts/arr-test-instances.mjs client "$QA_DIR" radarr
node scripts/arr-test-instances.mjs connections "$QA_DIR" radarr
node scripts/arr-test-instances.mjs stop "$QA_DIR"
```

`stop` stoppt nur diese identifizierten Testcontainer und behält alle
Konfigurationen/DBs. Es löscht keine Dateien, Volumes oder Netzwerke.
Bei einem fehlgeschlagenen Aufbau bleiben eigene Artefakte erhalten;
kein globales Prune/Reset als Reparatur. Der erste Aufbau mit unnutzbaren
Hostports wurde gezielt gestoppt und bleibt als Testartefakt erhalten.
Die korrigierten vier Instanzen bleiben für weitere Integrationstests gestartet.

## Beobachtete Verbrauchergrenze

Sonarr: nativer Newznab- und SAB-Verbindungstest bestanden. Radarr: SAB-Test
bestanden. Prowlarr: Newznab-Test bestanden; das AppProfile wird aus seiner
tatsächlichen API gelesen. Es wurde kein Indexer oder Downloadclient gespeichert
und kein automatischer Such-/Grabpfad aktiviert.

Radarrs Newznab-Test ergibt **HTTP 400**, weil keine Ergebnisse in seinen
Filmkategorien geliefert werden. Der bestehende Movie-Recent-Owner liefert
ohne optionalen Filmkontext bewusst ehrlich leer. Das ist kein Netzwerk- oder
Secretproblem und wird nicht durch erfundene Validierungsfilme kaschiert.
P10.1 ist für diesen realen Verbraucherbefund wieder offen. Ein unterstützter
Setupweg und anschließend tatsächliche direkte/vermittelte Suche sowie
synthetischer Download/Import sind noch nicht nachgewiesen. Die grundlegende
Versions-/Verbindungsprobe ist kein vollständiger Interoperabilitätsnachweis.

Frühere native SQLite-/PG- und Mediengates werden unverändert wiederverwendet;
dieser Aufbau betrifft nur disposable Arr-Konfigurationen und eine neue
Pingufunk-SQLite-Testinstanz, keinen erneuten PostgreSQL-Cutover.
