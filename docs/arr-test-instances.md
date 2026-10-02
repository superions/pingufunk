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
Testinstanzen nach der Abnahme mit `stop` beenden. Artefakte bleiben erhalten;
ein angehaltener Docker-Daemon ist kein bestätigter Container-Stopnachweis.

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

## Unterstützter Setupweg ohne erfundene Filme

Die vorstehende erste Beobachtung ist historisch. Der anschließende Test hat
Radarrs tatsächlich implementierten Einrichtungsvertrag belegt: eine Newznab-
Definition zunächst mit `enableRss`, `enableAutomaticSearch` und
`enableInteractiveSearch` jeweils `false` anlegen. Danach die bestehende
Definition über `PUT /api/v3/indexer/{id}?forceSave=true` gezielt für interaktive
Suche aktivieren. Die Feldvalidierung bleibt bestehen; nur die erneute
Remoteprobe wird beim Update ausgelassen. `forceSave` bei einer **aktivierten
Neuanlage** umgeht den leeren Feed dagegen nicht. Der separate Test bleibt mit
der präzisen No-Results-Ursache HTTP 400, nicht grün umetikettiert.
Siehe den versionsgebundenen
[Radarr-Controller](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/ProviderControllerBase.cs).

Direkt: `baseUrl` bezeichnet Pingufunk, `apiPath` ist `/api/newznab`.
Via Prowlarr: dort dieselbe Pingufunk-Adresse als Newznab-Quelle speichern;
in Arr `baseUrl` auf Prowlarr mit der **tatsächlichen Indexer-ID** setzen,
`apiPath` auf `/api` und den lokalen Prowlarr-Key verwenden. Dies ist
Prowlarrs Weiterleitungsweg, kein zweiter Pingufunk-Endpunkt. Die tatsächlich
versorgten Kategorien für Radarr/ Sonarr sind 2000/5000. Eine automatische
Prowlarr-Application-Synchronisierung wurde nicht getestet und darf daraus
nicht abgeleitet werden; Prowlarrs
[Radarr-Proxy](https://github.com/Prowlarr/Prowlarr/blob/v2.6.5.5623/src/NzbDrone.Core/Applications/Radarr/RadarrV3Proxy.cs)
unterscheidet ebenfalls Add und Update mit `forceSave`.

Dies ist ein API-Einrichtungsvertrag, keine behauptete zusätzliche GUI-Schaltfläche.
Für spätere reale Einrichtung Schemas aus der gewählten Instanz lesen und
Credentials aus privaten Secretdateien übernehmen, keine Payloads mit Keys
in die Shellhistory oder Dokumentation schreiben. Der QA-CLI akzeptiert
absichtlich **keine** beliebigen produktiven Ziele.

## Reproduzierbare vollständige Verbraucherprobe

Zusätzlich zu den Verbindungsproben:

```sh
node scripts/arr-test-instances.mjs bootstrap "$QA_DIR"
node scripts/arr-test-instances.mjs movie-fixture "$QA_DIR"
node scripts/arr-test-instances.mjs series-fixture "$QA_DIR"
node scripts/arr-test-instances.mjs movie-search "$QA_DIR"
node scripts/arr-test-instances.mjs episode-search "$QA_DIR"
node scripts/arr-test-instances.mjs forwarded-search "$QA_DIR"
node scripts/arr-test-instances.mjs boundaries "$QA_DIR"
node scripts/arr-test-instances.mjs movie-download "$QA_DIR" direct
node scripts/arr-test-instances.mjs movie-import "$QA_DIR"
node scripts/arr-test-instances.mjs episode-download "$QA_DIR" direct
node scripts/arr-test-instances.mjs episode-import "$QA_DIR"
node scripts/arr-test-instances.mjs stop "$QA_DIR"
```

Für die komplette Prowlarr-Kette mit `up` einen **frischen** Satz erzeugen,
dort Bootstrap/Fixtures wiederholen und bei beiden Downloadcommands
`forwarded` statt `direct` wählen. Nicht zwei identische GUIDs aus gleichzeitig
aktiven Indexern als zwei erwartete Suchergebnisse zählen: die reale
Verbraucherentscheidung dedupliziert sie. Die Probe aktiviert jeweils genau
einen eigenen Suchweg und stellt die bisherigen Flags im `finally` wieder her.
RSS-/Auto-Suche bleiben abgeschaltet, es gibt keine realen Auto-Grabs.

Die Fixtures sind unüberwachte synthetische Filme/Serien/Episoden ohne echte
externe Identität. Weil Arr beim regulären Hinzufügen externe Metadaten lädt,
wird ausschließlich seine **gestoppte disposable Datenbank** nach API-
Versionsprüfung, Integritycheck und privatem Backup transaktional vorbereitet.
Die bekannten Versionen sind bewusst fest begrenzt; andere Versionen brechen
ab. Vorhandene synthetische Zeilen bleiben bei erneuter Vorbereitung erhalten.
Dies ist keine unterstützte Methode zur Manipulation realer Arr-Bibliotheken.

`bootstrap` und Fixturevorbereitung sind wiederholbar; `up` erzeugt immer neu.
Ein Downloadcommand erstellt absichtlich eine **neue** manuelle Testaufnahme,
ist also keine idempotente Mutation. Vor dem eigenen Controller-Restart muss
die Queue leer sein. FFmpeg erzeugt lokal zehn Minuten Schwarzbild mit Testton,
keine heruntergeladenen Programme. Die Katalogfixture liefert getrennte,
suchbegriffsabhängige Film-/Episodenkandidaten und ehrliche leere Fremdsuchen.

Arr übernimmt den echten Release, lädt sein NZB und sendet selbst SAB-addfile.
Nach Completed samt Kategorieprüfung wird ausschließlich das eigene
Jobverzeichnis in ein privates Arr-Testvolume kopiert. Ein nur dort geltendes
Remote-Path-Mapping ermöglicht Arrs natives Completed-Download-Handling.
Importabnahme verlangt passende Grab-/Import-History, native Dateiidentität,
konfinierten Bibliothekspfad und physische Dateigröße, nicht nur `hasFile`.
Die abschließende native Historyentfernung muss den importierten Film/die
Episode erhalten; nur eigene synthetische Quelljobs dürfen entfernt werden.
Kein bestimmtes produktives Volume-/HAProxy-/Swarm-Szenario wird vorausgesetzt.

Falsche API-Keys müssen 401 ergeben und richtige weiterhin funktionieren;
der externe Fetch-Negativfall muss am eigenen Preload scheitern. Weder
Testsecrets noch Backups, reale APIantworten, Medien oder lokale Hostpfade
gehören ins Git. Alle Rohartefakte verbleiben unter dem ignorierten `downloads/`.

Die ersten direkten/vermittelten Importproben liefen auf ARM64. Nach der
Unterbrechung war die lokale Colima-Laufzeit gestoppt; ihre Zustände werden
nicht als erneute Abnahme ausgegeben. Ein eigener Archivcheckout auf dem
bekannten Entwicklungsrechner lieferte am 02.10.2026 die erfolgreiche frische
Wiederholung einschließlich vermittelter Downloads, nativer Imports und
Historyentfernung. Host-CLI: Node 26.10.0; Runner-/Migrator-Build mit Node 24
und frischem `npm ci`. Alle vier eigenen Instanzen wurden anschließend
gezielt gestoppt; Konfigurationen, Backups und Testdateien bleiben erhalten.
Bestehende Checkouts und fremde Dienste blieben unverändert. Live-Zugriff
wird nicht verlangt. Die dabei sichtbaren Securitybefunde bleiben separat
unter P10.2 offen und verhindern eine Releasefreigabe.
