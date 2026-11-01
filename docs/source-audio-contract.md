# Tonsprachenbeleg pro Medienfassung

## Vertrag

Radarr übermittelt beim normalen Newznab-Filmsuchen keine gewünschte Audiosprache.
Pingufunk liefert deshalb belegte Eigenschaften der konkreten Medienfassung,
nicht die Originalsprache des Films oder die vermutete Nutzerpräferenz. Radarr
wendet danach seine eigenen Profile an. Direkte Anbindung und Prowlarr benutzen
denselben `/api/newznab`-Vertrag; es gibt keinen zweiten Sprach-Endpunkt.

`src/services/source-audio.ts` ergänzt Filme und TV-Treffer in ID-, Text- und
überwachten RSS-Suchen vor Sprachselektion, Deduplikation und Pagination:

- ARTE: strukturiertes HbbTV-JSON, ohne Account oder kopierten Token. Nur gleiche
  Programm-ID und exakt gleiche progressive Medien-URL dürfen `audioCode`
  belegen. Einzige Normalisierung beim Vergleich: API-HTTP zu HTTPS, wie im
  MediathekView-Crawler. Fremde Parameter, andere Fassungen und widersprüchliche
  Codes sind kein Beleg. Website-Locale und Sendername sind kein Tonsprachbeweis.
  Neben ARTE-/Akamaiized-URLs ist genau `arteptweb-a.akamaihd.net` als bestätigter
  Legacy-CDN erlaubt, nicht beliebige Hosts unter `akamaihd.net`. Derselbe
  exakte Programm-/URL-Beleg gilt für Producer und Worker.
- ARD: strukturiertes Page-Gateway-JSON für die bereits indexierte, kanonische
  CRID-Video-ID. Genau ein identischer On-Demand-Player, freie/verfügbare Rechte
  und exakt dieselbe MP4-URL in einem `main`-Stream sind nötig. Alle `audios`
  müssen Sprache und bekannten Fassungsstatus übereinstimmend deklarieren.
  `meta.ovLanguageCode` ist nur Originalsprachenkontext, kein Tonsprachbeleg.
  Fremde/unklare Auxiliary-Streams werden nicht als normale Fassung ausgegeben.
  Kein HTML, Senderseiten-Abgrasen, Login oder zusätzliches Medieninventar.
  Der gemeinsame Producer-/Worker-URL-Gate erlaubt exakt
  `ctv-videos.daserste.de` und `rbb-progressive.ard-mcdn.de` über HTTPS, ohne
  Credentials, Fremdport oder Fragment. Queryselektoren bleiben exakt gebunden.
  Keine `ard-mcdn.de`-Wildcard: Hostmitgliedschaft ist nur Eignung für den
  vorhandenen JSON-Beleg, nicht selbst Beweis. Der RBB-CDN erweitert nicht die
  separate Range-Probe-Whitelist; fehlende CRID-/URL-/Audio-/Maßdeklarationen
  bleiben unbestätigt. Neue CDNs benötigen geprüfte Verträge und Regressionen.
- MP4: ISO-BMFF-`mdhd` ausschließlich auf Sound-Tracks vorhandener MP4-URLs der
  beiden explizit erlaubten ZDF-CDN-Hosts sowie `ctv-videos.daserste.de`.
  Höchstens vier Bereiche mit jeweils
  1 MiB, keine vollständigen Medien, Remote-ffprobe oder Senderseiten. Nur eine
  einheitliche, bekannte Sprache aller Audiotracks gilt als Beleg. `und`,
  gemischte oder unvollständige Metadaten bleiben unbekannt.
  Große Sampletabellen werden über deklarierte Boxgrößen übersprungen, nicht
  vollständig geladen. Alle Track-/Containergrenzen und Audiotrackheader müssen
  im Vier-Fenster-Budget geprüft werden; ein benötigtes fünftes Fenster bleibt
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
und Metadaten: RSS/Filme höchstens vier Probeidentitäten, explizite TV-Suchen
höchstens sechzehn; keine neuen Retries. Auf ausdrückliche Nutzerfreigabe vom
05.10.2026 teilen TV-Suchen maximal 32 HTTP-Versuche, RSS/Filme weiterhin zehn.
Alle haben unverändert eine gemeinsame 15-Sekunden-Deadline. ARTE-/ARD-Programm
verbraucht eine Identität und wird innerhalb der Ergänzung wiederverwendet;
eine MP4-URL benötigt bis zu vier HTTP-Versuche. HD-Fassungen aller Kandidaten
werden vor Standard-/Low-Alternativen geprüft. Nicht untersuchte Treffer bleiben
unbekannt. Keine vollständige Sprachabdeckung großer Staffeln/RSS-Fenster oder
neuer HLS-Sprachbeleg. `best` bleibt nach dem Aufteilen eine Rendition je
Episode/Fassung, nicht versehentlich alle Qualitäts-URLs.

Nicht unterstütztes MP4/Range-Verhalten liefert keine Evidenz. ARTE 404/410
meldet getrennt `source_endpoint_missing` (unavailable); eine erfolgreich
gelesene leere Streamliste meldet `source_empty` (missing). Beide bleiben im
Producer ohne Sprach-/Maßbeleg neutral oder entsprechend der bestehenden
Sprachpolitik ausgeschlossen. Der fehlende Belegendpunkt beweist weder die
Auslistung des Films noch das Ende der ganzen API. Eine unlesbare oder
schematisch ungültige Antwort meldet `source_response_invalid`, ein HTTP-/
Transportausfall `source_failed`. Die frische Workerprüfung verwendet dieselben
Unterschiede und verweigert bei fehlendem Beleg weiterhin den Abschluss;
fremde Rendition oder widersprechende Sprache bleiben `source_evidence_mismatch`.
Transport-/Deadline-/Bodylimit-Fehler sowie ungültiges Provider-JSON brechen die
Anfrage ab; keine erfolgreiche Teilantwort oder deren Antwortcache. Redirects
sind nicht erlaubt, alle Antwortkörper sind begrenzt, Fehlermeldungen enthalten
keine Quell-URLs oder Credentials.

Audiosprache beweist keine Bildauflösung. Die getrennte Korrektur P09.3 bindet
optionale Maße aus dem bereits gelesenen strukturierten ARTE-/ARD-JSON an die exakte
URL; `url_video_hd` allein ist kein 1080p-Beleg. Ohne Maße bleibt die Auflösung
unbekannt. Umfang, historische GUIDs und Rolloutgrenzen stehen im
[Auflösungsvertrag](rendition-quality-contract.md). Die dort dokumentierte
Vier-Fenster-Grenze gilt auch nach der Abnahme von P03.4; neue unbelegte Quellen
werden dadurch nicht automatisch unterstützt.
Die strukturierten Provider-Schnittstellen sind keine von Pingufunk kontrollierten
Dienst mit zugesicherter Verfügbarkeit. Vertragsänderungen werden nicht durch
einen HTML-Fallback kaschiert, sondern verlangen Providerprüfung und Regression.

## Download und Speicherung

P12 ergänzt für neue eigene Jobs v3, siehe [Settings-/Jobvertrag](settings-contract.md).
Die folgenden v1/v2-Ausführungen dokumentieren den erhaltenen Altvertrag.
v3 behält denselben Audio-/Providerbelegschutz und trennt zusätzlich eingefrorene
Quellen- und Episodendauer. Keine neue Sprachheuristik; der Abnahmescope von
P03.4 steht im Phasenvertrag und erweitert nicht diese Quellen-/Budgetgrenzen.
P19.2 verwendet für eine explizit gebundene einzelne Mediathek-Standardfassung
v6 mit denselben unabhängigen Audio-/Dauer-/Pixelbelegen. Die Quellenbindung
selbst beweist keine Sprache und erlaubt keine AD-/OV-Umdeutung. Ohne unabhängigen exakten Quellenbefund bleiben bekannte fremde oder
gemischte Tracks vor Completed gesperrt; der genaue
[Programm-/Rückwegvertrag](tv-search-contract.md#explizite-einzelne-mediathek-programme-p192)
ersetzt keine Medienprobe. P19.2 ist nativ abgenommen und live. P19.3 erweitert
den eingefrorenen Umfang auf genau zwei bestätigte Ziele; Audio-/Pixelbelege
bleiben davon unabhängig.

## Konkreter ARTE-Befund P19.4

Der begrenzte Metadatenabruf vom 01.11.2026, 03:03 UTC, trennt für
[Misericordia](https://www.arte.tv/de/videos/128673-000-A/misericordia/)
Programm `128673-000-A` folgende Fakten: Der HbbTV-Belegendpunkt antwortet 404;
die unterstützte Player-v2-Antwort antwortet für dieselbe Programm-ID 200 und
nennt 5.885 Sekunden. Sie enthält nur ein HLS-Manifest ohne Pixelmaße mit
französischem Originalton, Untertitelvarianten und französischer AD. Deutsche
Untertitel sind kein deutscher Ton. Das deklarierte Rechteende am 13.11.2026,
04:00 UTC, steht getrennt vom konkreten Alters-/Zugangsfenster bis 01.11.2026,
05:59:59 CET. Diese eingefrorenen Metadaten behaupten keine spätere Verfügbarkeit.

Die begrenzte MediathekView-Abfrage enthält die exakte ARTE.DE-Originalversion
mit Untertiteln sowie andere Programme bzw. einen kurzen Filmtipp. Der
Playerbeleg bindet keine der indexierten progressiven MP4-URLs mitsamt Audio
und Maßen. Damit fehlt für diese konkreten Fassungen weiterhin der benötigte
strukturierte Renditionbeleg. P19.4 korrigiert die Diagnose, behauptet aber
keinen Qualitätsfix oder verfügbare deutsche Standardfassung. Kein neuer HLS-/
HTML-Fallback, Sendercrawler, Token-/Accountdienst oder Alters-/Geoblocking-Bypass.

`MediaExpectations` v1 bleibt für vorhandene Jobs unverändert. Bei MP4-Sprach-
Tags wird weiterhin der strenge v1-Trackvertrag geprüft. ARTE-/ARD-Providerbelege
verwenden v2: `audio` bleibt null, `sourceAudio` enthält Provider, Programm-ID,
SHA-256 der stabilen URL-Identität und Sprache. Ein exakt gebundener und frisch bestätigter deutscher Quellenbefund kann gemäß
P19.5 das Tag genau eines Audiotracks der neuen Auftragsdatei berichtigen. RSS, NZB, Queue, Retry und Persistenz tragen den
versionierten Vertrag mit; keine Datenbankschemaänderung ist nötig.

Der Worker prüft die lokale Datei mit ffprobe und holt den ARTE-Beleg frisch
gegen die tatsächlich heruntergeladene URL (Dispatcher für `arte_hbbtv` und
`ard_media`). Andere URL, fehlende/veränderte
Sprache oder fremder Programmbeleg verhindern `Completed`. Ein frischer deutscher
Quellenbefund erhält bei genau einem Audiotrack Vorrang vor dessen falschem oder
fehlendem Container-Tag. Bereits deutsch getaggte Dateien werden unverändert
übergeben. Bei einer Korrektur kopiert der vorhandene FFmpeg verlustfrei alle
Streams in eine private temporäre Datei und setzt ausschließlich das Audio-
Sprachtag auf `deu`. Die ursprüngliche neue Auftragsdatei bleibt bis zur erneuten
Medienprobe samt frischer Quellenprüfung erhalten; erst danach wird sie atomar
ersetzt und der Auftrag abgeschlossen. Abbruch, Remux- oder Prüfungsfehler erhalten
das Original. Mehrere widersprüchliche Tracks sowie reine MP4-Tagbelege erhalten
keine solche Freigabe.

`mediaValidation.audioLanguages` enthält danach die gemessenen Dateitags;
`audioLanguageCorrection` bewahrt die ursprünglichen Sprachwerte. Separat bleiben
`sourceAudioEvidence` und `expectedChecks.audio=passed_provider` erhalten. Das ist
Quellenbefund, keine akustische Spracherkennung. Alte Aufträge, bestehende Dateien
und Bibliothekseinträge werden nicht nachträglich geändert. Identität, Fassung,
Rechte, Laufzeit und Pixel bleiben eigenständige Prüfungen.

Jede frische Workerprüfung hat ein begrenztes Budget von einem Versuch und
höchstens 15 Sekunden. Nur eine notwendige Tagkorrektur führt zu einer zweiten
solchen Prüfung der korrigierten Datei; keine Retries oder Providerwechsel. Ist die Fassung inzwischen ausgelistet oder der
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
Rollback. Auch bisherige v2-Images ohne `ard_media` verstehen neue ARD-Jobs nicht.**
Ebenso kann ein bisheriger ARD-Worker mit ausschließlich `ctv-videos.daserste.de`
neue RBB-Erwartungen nicht revalidieren. Ein Rückfallimage muss den erweiterten
exakten ARD-URL-Gate im Worker behalten, auch wenn sein Producer noch keine neuen
RBB-Belege veröffentlicht.
Aufnahme pausieren, Queue/History abgleichen und einen provider-kompatiblen
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
- [ARD-Extractor von yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/ard.py):
  Page-Gateway, Player-/Streamstruktur und URL-gebundene Audiodeklarationen.
  Gegen tatsächliches begrenztes öffentliches JSON geprüft; dessen permissiver
  Deutsch-Default bei fehlendem Sprachfeld wird ausdrücklich **nicht** übernommen.
