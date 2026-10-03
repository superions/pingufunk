# Tonsprachenbeleg pro Medienfassung

## Vertrag

Radarr übermittelt beim normalen Newznab-Filmsuchen keine gewünschte Audiosprache.
Pingufunk liefert deshalb belegte Eigenschaften der konkreten Medienfassung,
nicht die Originalsprache des Films oder die vermutete Nutzerpräferenz. Radarr
wendet danach seine eigenen Profile an. Direkte Anbindung und Prowlarr benutzen
denselben `/api/newznab`-Vertrag; es gibt keinen zweiten Sprach-Endpunkt.

`src/services/source-audio.ts` ergänzt Filme in ID-, Text- und überwachten
RSS-Suchen vor Sprachselektion, Deduplikation und Pagination:

- ARTE: strukturiertes HbbTV-JSON, ohne Account oder kopierten Token. Nur gleiche
  Programm-ID und exakt gleiche progressive Medien-URL dürfen `audioCode`
  belegen. Einzige Normalisierung beim Vergleich: API-HTTP zu HTTPS, wie im
  MediathekView-Crawler. Fremde Parameter, andere Fassungen und widersprüchliche
  Codes sind kein Beleg. Website-Locale und Sendername sind kein Tonsprachbeweis.
- ZDF: ISO-BMFF-`mdhd` ausschließlich auf Sound-Tracks vorhandener MP4-URLs der
  beiden explizit erlaubten CDN-Hosts. Höchstens zwei Bereiche mit jeweils
  1 MiB, keine vollständigen Medien, Remote-ffprobe oder Senderseiten. Nur eine
  einheitliche, bekannte Sprache aller Audiotracks gilt als Beleg. `und`,
  gemischte oder unvollständige Metadaten bleiben unbekannt.
  Große Sampletabellen werden über deklarierte Boxgrößen übersprungen, nicht
  vollständig geladen. Alle Track-/Containergrenzen und Audiotrackheader müssen
  im Zwei-Fenster-Budget geprüft werden; ein benötigtes drittes Fenster bleibt
  unbekannt. Keine Suche nach vermeintlichen Headerzeichenketten in Medienbytes.

Die drei Qualitäts-URLs einer Quellzeile werden getrennt behandelt. Deutsch in
HD beweist weder die Sprache der Standard- noch der Low-Fassung. Rohdaten aus
dem Katalogcache bleiben unverändert. Belegte deutsche Fassungen erhalten den
von Radarr parsebaren `GERMAN`-Titel; unbekannte bleiben nach der bestehenden
konfigurierbaren Politik neutral. OV mit deutschen Untertiteln ist nicht
deutscher Ton. Fassungs-GUIDs ändern sich nicht bloß durch einen besseren
Sprachbeleg; aktuelle Download-URLs bleiben erhalten.

## Grenzen und Fehler

Die Ergänzung teilt das bestehende HTTP-Budget und dessen Deadline mit Suche
und Metadaten: höchstens vier Probeidentitäten pro Anfrage, keine neuen Retries.
Ein ARTE-Programm verbraucht eine Identität; eine ZDF-URL benötigt bis zu zwei
HTTP-Versuche. Nicht untersuchte Treffer bleiben unbekannt. Das ist keine
Behauptung vollständiger Sprachabdeckung großer RSS-Fenster. HLS und andere
Sender erhalten durch diese Änderung keinen neuen Beleg. Vorhandene TV-/P07-
Verträge bleiben bestehen; der neue Owner ist zunächst an die Filmpfade gebunden.

Nicht unterstütztes MP4/Range-Verhalten und ARTE 404/410 liefern keine Evidenz.
Transport-/Deadline-/Bodylimit-Fehler sowie ungültiges ARTE-JSON brechen die
Anfrage ab; keine erfolgreiche Teilantwort oder deren Antwortcache. Redirects
sind nicht erlaubt, alle Antwortkörper sind begrenzt, Fehlermeldungen enthalten
keine Quell-URLs oder Credentials.

Die alte Katalog-Qualitätszuordnung `url_video_hd` zu 1080p wird hier nicht
repariert: eine tatsächliche 720p-Datei kann in diesem Feld liegen. Audiosprache
beweist keine Bildauflösung. Diese separate Grenze muss vor einer strengeren
Auflösungszusage berücksichtigt werden.
Die strukturierte ARTE-Schnittstelle ist kein von Pingufunk kontrollierter
Dienst mit zugesicherter Verfügbarkeit. Vertragsänderungen werden nicht durch
einen HTML-Fallback kaschiert, sondern verlangen Providerprüfung und Regression.

## Download und Speicherung

`MediaExpectations` v1 bleibt für vorhandene Jobs unverändert. Bei MP4-Sprach-
Tags wird weiterhin der strenge v1-Trackvertrag geprüft. ARTE-Providerbelege
verwenden v2: `audio` bleibt null, `sourceAudio` enthält Provider, Programm-ID,
SHA-256 der stabilen URL-Identität und Sprache. Es werden keine fehlenden
Container-Tracktags erfunden. RSS, NZB, Queue, Retry und Persistenz tragen den
versionierten Vertrag mit; keine Datenbankschemaänderung ist nötig.

Der Worker prüft die lokale Datei mit ffprobe und holt den ARTE-Beleg frisch
gegen die tatsächlich heruntergeladene URL. Andere URL, fehlende/veränderte
Sprache, fremder Programmbeleg oder bekannte widersprechende lokale Audiotracks
verhindern `Completed`. Bei belegtem Provider und unbekannten Tracktags bleibt
`audioLanguages` leer; separat steht `expectedChecks.audio=passed_provider`.
Das ist Provider-Evidenz, kein akustischer Hörtest. Dateiidentität wird auch
nach dem Providerabruf erneut geprüft.

Der frische Workerbeleg hat ein eigenes begrenztes Budget von einem Versuch
und höchstens 15 Sekunden. Ist die Fassung inzwischen ausgelistet oder der
Provider unerreichbar, darf auch eine technisch lesbare Datei mit unbekannten
Tracktags nicht als sprachgeprüft fertig gemeldet werden. Ein solcher Fehler
verlangt Diagnose/Retry; keine automatische Umgehung des Belegs.

SQLite und PostgreSQL speichern und lesen beide Versionen. Eine PostgreSQL-
Migration ist weder Voraussetzung noch Teil dieser Änderung. Datenbank-URLs,
Keys, echte Medien und echte API-Antworten gehören nicht in öffentliche Fixtures.

## Betrieb und Rollback

Vor Aufnahme von v2-Jobs das neue Image isoliert prüfen. Laufende produktive
Downloads nicht durch einen ungeprüften Imagewechsel unterbrechen.
**Ein älteres Image ohne v2-Unterstützung ist nach neuen v2-Writes kein sicherer
Rollback.** Aufnahme pausieren, Queue/History abgleichen und einen v2-kompatiblen
Rollback verwenden. Alte Sicherungen nicht über neue Jobs/History schreiben;
Erwartungen nicht entfernen oder auf v1 umetikettieren. Keine automatische
DB-Umschaltung, Migration oder Deploymentfreigabe aus diesem Dokument ableiten.

## Reproduzierbare Abnahme

Die Regressionen prüfen unter anderem genaue URL-/ID-Bindung, fremde Sprache,
OV/Untertitel, Rendition-Auswahl vor Limit, Budget/Deadline/Bodylimit, stabile
GUIDs, RSS→NZB→Parser, Worker-Neuprüfung und unveränderte v1-Jobs.
`scripts/media-expectations-runtime.test.ts` führt v1 und v2 für beide Backends
über persistierte Jobs, Queue, Neustart und Retry. PostgreSQL benötigt die
disposable Laufzeit von `npm run test:pg`, nicht eine Produktionsdatenbank.

Für tatsächliche Verbraucher auf einem separaten Docker-Testhost:

```sh
docker build --target runner -t pingufunk-source-audio-qa .
docker build --target migrator -t pingufunk-source-audio-migrator-qa .
PINGUFUNK_ARR_QA_RUNNER_IMAGE=pingufunk-source-audio-qa \
PINGUFUNK_ARR_QA_MIGRATOR_IMAGE=pingufunk-source-audio-migrator-qa \
PINGUFUNK_ARR_QA_MOVIE_CORRELATION=1 PINGUFUNK_ARR_QA_SOURCE_AUDIO=1 \
node scripts/arr-test-instances.mjs up
# Genau das vom Befehl ausgegebene QA_DIRECTORY verwenden:
node scripts/arr-test-instances.mjs bootstrap <QA_DIRECTORY>
node scripts/arr-test-instances.mjs movie-fixture <QA_DIRECTORY>
node scripts/arr-test-instances.mjs movie-search <QA_DIRECTORY>
node scripts/arr-test-instances.mjs boundaries <QA_DIRECTORY>
node scripts/arr-test-instances.mjs stop <QA_DIRECTORY>
```

Das interne Netzwerk und der Fetch-Preload blockieren externe Quellen. Der
synthetische Film hat Originalsprache Englisch, seine konkret belegte Fassung
Deutsch. Beide nativen Radarr-Wege müssen genau einen German-Release erkennen,
ohne Grab. Anlauf/Readiness kann zunächst leer sein; ein solcher Versuch ist
keine Abnahme. Eigene Testinstanzen stoppen, Konfiguration zur Diagnose erhalten.

## Primärquellen

- [Radarr 6.4.4 NewznabRequestGenerator](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs)
  und [AggregateLanguages](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/NzbDrone.Core/Download/Aggregation/Aggregators/AggregateLanguages.cs):
  Anfrage und nachgelagerter Originalsprachenfallback sind verschiedene Schritte.
- [MServer ARTE VideoLinkDeserializer](https://github.com/mediathekview/MServer/blob/master/src/main/java/mServer/crawler/sender/arte/json/ArteVideoLinkDeserializer.java)
  und [VideoTypeMapper](https://github.com/mediathekview/MServer/blob/master/src/main/java/mServer/crawler/sender/arte/ArteRestVideoTypeMapper.java):
  strukturierter Rendition-Vertrag und Sprach-/Untertitelcodes.
- [FFmpeg MOV-Demuxer](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/mov.c):
  `mov_read_mdhd`, versionierte Zeitfelder und gepacktes Sprachfeld. Implementiert
  wird ein begrenzter eigenständiger Metadatenparser, kein kopierter Demuxer.
