# Quellenbelegte Auflösung statt Katalog-Qualität

## Ursache und Owner

`url_video_hd`, `url_video` und `url_video_low` sind Katalog-Slots, keine
Pixelmaße. Die bisherige feste Zuordnung zu 1080p/720p/480p wurde in allen drei
Newznab-Generatoren durch `src/services/rendition-quality.ts` ersetzt.
Eine konkret belegte 1280×720-Fassung im HD-Slot wird als `720p.WEB` ausgegeben.
Bildauflösung und Tonsprachenbeleg bleiben unabhängige Fakten.

`source-audio.ts` übernimmt optionale `width`/`height` aus dem ohnehin gelesenen
ARTE-HbbTV-JSON nur bei gleicher Programm-ID und exakt gleicher Medien-URL.
Die bestehende HTTP→HTTPS-Normalisierung bleibt die einzige Ausnahme. Der
TV-Fassungsowner `arte-editions.ts` übernimmt optional deklarierte Maße aus
dem bereits abgefragten Player-JSON, ebenfalls pro exakter Stream-URL.
Es gibt keine zusätzlichen Abfragen, Accountpflicht, Senderseitenparser,
Remote-ffprobe oder Voll-Downloads bei Suchen. Die HbbTV-Felder sind auch im
[MediathekView-Crawler](https://github.com/mediathekview/MServer/blob/master/src/main/java/mServer/crawler/sender/arte/json/ArteVideoLinkDeserializer.java)
dokumentiert. Die Rohantwort-Whitelist des MediathekView-Clients übernimmt
keine beliebigen Dimensionsbehauptungen aus zusätzlichen Katalogfeldern.

Alle passenden Deklarationen müssen dieselben positiven ganzzahligen Maße
bis 65536 enthalten. Fehlende, ungültige oder widersprüchliche Angaben liefern
keinen Beleg; Maße einer anderen URL oder Fassung dürfen nicht übertragen werden.
Eine API-Signaturänderung erfordert einen neuen Beleg, nicht bloß eine ähnliche URL.

## Veröffentlichung und Auswahl

Belegte Höhen 480/576/720/1080/2160 erhalten ihre entsprechende `p`-Angabe.
Andere Höhen bleiben im Titel `UNKNOWN`, obwohl vorhandene exakte Maße im
Worker-Vertrag weiterhin geprüft werden. Aus abgeschnittenem Cinemascope,
Seitenverhältnis, URL-Namen, Dateigröße, „HD“ oder Audiosprache wird kein
Standardauflösungslabel geraten. Die Herkunft enthält derzeit keine Aussage
über Progressive-/Interlaced-Codierung; der Szenenname ist ein Consumerlabel.

Ohne verwertbares Label enthält der Titel `UNKNOWN.h264`, keine zusätzliche
`WEB`-Markierung und keine SD-/HD-Unterkategorie. Der bisherige `WEB`-Zusatz
würde bei fehlender Auflösung in den nativen Arr-Parsern selbst ein SD-Label
erzeugen; siehe [Radarr QualityParser](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/NzbDrone.Core/Parser/QualityParser.cs).
Numerische Auflösungsmarker aus Quell-/Metadatentiteln werden vor dem eigenen
Suffix entfernt. Titelbestandteile sind weiterhin keine allgemeine Garantie,
dass jeder zukünftige Arr-Parser alle unbekannten Fälle neutral behandelt.
Unbekannt ist kein Auto-Grab-Verbot: die tatsächlichen Consumerprofile bleiben
maßgeblich; bei notwendiger garantierter Auflösung müssen sie unbekannte
Qualität ablehnen. Diese Änderung bearbeitet keine produktiven Profile.

`all` erhält unterschiedliche URLs. Dieselbe exakte URL wird nach der Auswahl
nur einmal angeboten. `best` bevorzugt die höchste belegte unterstützte Höhe;
ohne solche Maße bleibt die bisherige Slotreihenfolge ein deterministischer
Auswahlhinweis, kein Beweis der besten Bildqualität. Eine konkrete Einstellung
wie `720p` wählt bekannte 720p-Fassungen unabhängig vom Slot. Für unbekannte
Fassungen bleibt der bisher zugehörige Slot als Auswahlhinweis nutzbar, der
Titel bleibt aber `UNKNOWN`. Das ist kein strikter Mindestauflösungsfilter.
HLS bleibt unverändert opt-in; Größenmultiplikatoren bleiben bisherige
Katalog-Schätzungen, keine neu bewiesenen Dateigrößen.

Die Dimensionsabdeckung ist ausdrücklich begrenzt: nur bereits gelesene,
passende strukturierte ARTE-Deklarationen liefern in diesem Fix neue Maße.
Andere Sender, allgemeine TV-Suchen ohne solchen Providerbeleg, HLS und
übersprungene Probeidentitäten bleiben unbekannt. P03.4s begrenzter MP4-
Tonsprachparser wurde nicht erweitert und liefert keine Dimensionszusage.

## NZB, Worker und historische Identität

RSS und UI-NZB übertragen Maße nur für die ausgewählte exakte URL in den
bereits vorhandenen `MediaExpectations` v1/v2 mit `provider_dimensions`.
Keine Payload-Version oder DB-Schemaänderung: SQLite und PostgreSQL behalten
denselben serialisierten Vertrag über Queue, Restart und Retry.
Der Worker vergleicht die lokale ffprobe-Ausgabe mit **Breite und Höhe**;
abweichende Maße dürfen nicht zu `Completed` führen. Unbekannte Sollmaße
bleiben `expectedChecks.resolution=unknown`, nicht „bestanden“.

Die historische Slotidentität bleibt im bestehenden GUID-Hash erhalten,
auch wenn das sichtbare Label von 1080p auf 720p oder UNKNOWN korrigiert wird.
Ein `#1080p-…`-Fragment ist daher künftig ausdrücklich ein opaker Alt-Identifier,
kein Beleg der Videoauflösung. Verbesserte Dimensionsbelege allein erzeugen
keine neuen GUIDs. Bei derselben URL in mehreren Slots bleibt für `all`/`best`
der erste bisherige Slot-Identifier; weniger identische Veröffentlichungen
bedeuten keine neu erfundene Identität. Die bekannten Kontext-/Fassungs-GUID-
Übergänge aus dem Cutover-Runbook bleiben davon unabhängig.

Es werden weder Altjobs noch gespeicherte Erwartungen, Dateinamen, Importdateien,
History oder Profile umgeschrieben. Vorhandene Jobs ohne Sollmaße werden nicht
nachträglich zu dimensionsgeprüften Jobs. Der Antwortcache bekommt eine neue
Version, damit alte erfundene Titel nicht weiter ausgeliefert werden.

## Prüfung und spätere Betriebsfreigabe

Regressionen prüfen HD-Slot mit tatsächlichen 720p, vertauschte Standard-/HD-
Maße, URL-Konflikte, fehlende Maße, HLS-Opt-in, best/konkrete Auswahl,
historische GUIDs sowie RSS→NZB→Worker und UI-NZB pro URL. Der disposable
Mediengate erzeugt eine echte 720p-Datei und prüft passende sowie falsche Breite/
Höhe auf beiden Backends. Der native Arr-Gate verwendet einen unüberwachten
synthetischen Film: Radarr-Suche direkt und via Prowlarr, plus Sonarrs echter
Parser mit dem tatsächlich veröffentlichten Qualitätssuffix. Das ist kein
vollständiger Sonarr-Importnachweis. Kein produktiver oder echter Mediengrab.

```sh
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
npm run test:pg
# Nach lokalen runner/migrator-Builds und geladenen versionsgebundenen Arr-Images:
bash scripts/rendition-quality-arr-smoke.sh
bash scripts/media-container-smoke.sh
```

Der Docker-Forkworkflow führt die nativen QA-Varianten 720p, unbekannt und
widersprüchlich ohne Image-Publikation aus. Der Abnahmestatus steht ausschließlich
im P09.3-TODO; angelegte Gates sind noch kein Ausführungsnachweis.

Produktionsrollout bleibt separat freizugeben. Vorher Queue/History, neue
UNKNOWN-Titel, konkret konfigurierte Qualitätsauswahl und Consumerprofile im
installationsbezogenen Runbook prüfen. Neue Jobs erhalten strengere Sollmaße;
ein App-Rollback muss v1/v2 und die vorhandenen Dimensionschecks verstehen und
die aktuelle Datenbank behalten. Zurück zum alten Slot-Stempel wäre ein
bewusster Rückfall auf den Fehler, kein geprüfter Qualitätsrollback. Nach PG-
Writes keinen veralteten SQLite-Snapshot reaktivieren. P03.4 bleibt unabhängig.
