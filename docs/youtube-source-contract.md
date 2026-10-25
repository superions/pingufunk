# YouTube als zusätzliche Katalogquelle — Entwurf P17

Stand: 25.10.2026, geprüft gegen Main `1c9d4f9` und Upstream `345f5ed`.
Nutzerauftrag: separat und über die GUI pflegbare ÖR-YouTube-Kanäle,
automatische Serien-/Film-ID-Zuordnung mit Vorbelegungen, Mediathek-nahes
JSON, KISS und Bestandsschutz. Pflichtreferenz ist KultKrimi / Der Kommissar.
Dies ist ein **Entwicklungsentwurf**, keine implementierte Schnittstelle oder
Betriebsfreigabe. Reihenfolge, Status und Abnahme ausschließlich in
[P17](../todo/proxy-retirement.md#phase-p17--youtube-quellen-im-bestehenden-katalogvertrag).
Keine Streaming-Webseite, Impressumsinventur oder zusätzliche Medienverwaltung.

## Tatsächlicher Mediathek-Datenvertrag und Feldverluste

`src/lib/mediathek-client.ts::queryMediathekView` liest JSON aus
`result.results` des MediathekViewWeb-Endpunkts `/api/query`. Dieser liefert
Katalogzeilen, keine allgemein verlässlichen TVDB-/TMDB-IDs oder kanonischen
Staffel-/Folgenbindungen. SRF benutzt einen eigenen API-Adapter, ORF für die
Suche ebenfalls den gemeinsamen MediathekView-Client.

Primärquelle für diesen Feldvergleich ist MediathekViewWeb-Revision
`5de3e90b53c348de2b510b8b964d7ea1a161f250`:
[FilmlisteParser](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/FilmlisteParser.ts),
[Indexerworker](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/MediathekIndexerWorker.ts),
[API-Antwort](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/app.ts)
und [Ergebnistyp](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/client/src/lib/types.ts).
Keine reale API-Antwort oder Medienadresse wird als Fixture übernommen.

| Daten                                                                                               | Heutiger Pingufunk-Pfad                                                                                                                                                                                                          | Bewertung / Ziel P17                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `channel`, `topic`, `title`, `description`                                                          | Werden übernommen.                                                                                                                                                                                                               | Feldnamen und Bedeutung erhalten; Originaltitel bei einer kanonischen Zuordnung nicht verlieren.                                                                                                                                                 |
| `duration`, `size`                                                                                  | Sekunden und Bytes; explizit unbekannte Dauer/Größe werden zu `0` normalisiert.                                                                                                                                                  | `0` bleibt unbekannt, kein positiver Laufzeit-/Größenbeleg.                                                                                                                                                                                      |
| `url_website`, `url_video`, `url_video_low`, `url_video_hd`                                         | Werden übernommen.                                                                                                                                                                                                               | Leere Slots bleiben leer; `hd` ist zunächst ein Katalogslot, kein Pixelbeweis.                                                                                                                                                                   |
| `id`                                                                                                | Optional als Quell-ID übernommen; GUI-/RSS-Identitäten haben eigene bestehende Regeln.                                                                                                                                           | Quell-ID erhalten, aber veröffentlichte IDs/GUIDs nicht durch volatile Zeilenhashes ersetzen.                                                                                                                                                    |
| `timestamp`                                                                                         | Gültige Epochsekunden werden zu `contentDates.broadcastAt`.                                                                                                                                                                      | Kein Verlust des Sendetermins; nicht mit Katalogupdate, Filmjahr oder YouTube-Uploaddatum gleichsetzen.                                                                                                                                          |
| `filmlisteTimestamp`                                                                                | Legacywert bleibt erhalten; normalisiertes `catalogueUpdatedAt` wird derzeit nur zusammen mit gültigem `timestamp` ergänzt.                                                                                                      | Beide gültigen Datumsfakten unabhängig erhalten; Legacy-IDs, Sortierung und pubDate unverändert lassen.                                                                                                                                          |
| **`url_subtitle`**                                                                                  | Wird vom MediathekView-Parser geliefert, aber durch Pingufunks Whitelist verworfen; fehlt im gemeinsamen Typ und Provideradapter.                                                                                                | **Konkreter Datenverlust.** Validiertes optionales Feld durch Typ, Adapter und GUI-Suchantwort erhalten. Noch kein automatischer Untertiteldownload.                                                                                             |
| `queryInfo` mit Quellzählungen, `totalRelation`, `totalEntries`, Suchdauer                          | Wird nicht als Teil der einzelnen Katalogzeile weitergereicht.                                                                                                                                                                   | Bewusste Trennung: Transport-/Suchstatistik ist kein Medieninhalt. Eigene Coverage aus wirklich geprüften Fenstern; fremde Counts sind keine Zahl sicher zugeordneter Folgen.                                                                    |
| Sprach-/Fassungsflags und `productionYear` zwischen internen Typen                                  | `audioLanguage`, Datum/Rechte und Audio-/Dimensionsbelege werden gezielt weitergereicht. Andere in `ApiResultItem` deklarierte Fassungsflags fehlen in `ProviderContentItem`; dessen `productionYear` fehlt wiederum im Rückweg. | Deklarierte, validierte interne Inhaltsfelder explizit erhalten, einschließlich `subtitleLanguage`, OV/AD/Gebärden-/Klarsprache und belegtem Produktionsjahr. Das ist ein Adaptervertrag, keine Zusage, dass MediathekView diese Fakten liefert. |
| Beliebige Zusatzfelder wie angebliches `audioLanguage`, Rechte oder Dimensionen in einer Rohantwort | Werden absichtlich nicht als interne Belege übernommen; kausale Tests schützen diese Grenze.                                                                                                                                     | Beibehalten. Vollständige **deklarierte Inhaltsfelder** sind das Ziel, kein ungeprüftes Durchreichen eines Fremdobjekts.                                                                                                                         |

Die ursprüngliche komprimierte Filmliste ist noch ein anderer Vertrag: deren
Parser verwirft oder normalisiert bereits Felder vor der Web-API. Solche dort
nicht gelieferten Daten kann Pingufunk aus `/api/query` nicht rekonstruieren.
Die historische Motivation für das Weglassen von `url_subtitle` ist nicht
belegt; der aktuelle Code rechtfertigt es nicht als notwendige Sicherheitsregel.
Der Transportstatus `err` wird bereits geprüft: ein Quellfehler wird kein
erfolgreicher leerer Katalog. Er gehört ebenso wenig in jede Inhaltszeile wie
die Suchstatistik. „Vollständig übernehmen“ heißt hier alle gelieferten
deklarierten Inhaltsfelder erhalten, nicht die gesamte Transporthülle kopieren.

## Ein Katalogvertrag, getrennte Konfiguration und Metadatenidentität

Die vorhandenen `ApiResultItem`-Felder bleiben die Mediathek-nahe Form der
normalisierten Inhaltsdaten. `ProviderContentItem` bleibt die bestehende
Adaptergrenze; **kein drittes paralleles YouTube-Inhaltsmodell** einführen.
P17.1 ergänzt nur benannte fehlende Felder. Keine beliebigen `raw`-Objekte oder
vollständigen yt-dlp-Dumps in Config, Browser, Logs oder NZBs speichern.

| YouTube-Fakt                                                   | Feld im bestehenden Katalogvertrag                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Geprüfte Channel-ID / registrierter Anzeigename                | `channel`, plus stabile ID in `sourceRef`; nicht pauschal `ZDF` als Kanal erfinden.                                                       |
| Gebundene Serie bzw. ungeklärter Playlistname                  | `topic`; ungeklärt bleibt ohne kanonische Programm-ID.                                                                                    |
| Videotitel / Beschreibung                                      | `title`, `description`, mit erhaltenem Originaltitel.                                                                                     |
| Laufzeit / tatsächlich bekannte Größe der ausgewählten Fassung | `duration` in Sekunden, `size` in Bytes; bei unbekannter Muxgröße `0`, keine Summe als bestätigte Dateigröße.                             |
| Watch-Seite / verfügbare Medien- und Untertiteladressen        | `url_website`, `url_video*`, optional `url_subtitle`; unbekannt leer, Watch-Seite nie als Medienadresse.                                  |
| Erster erfolgreicher Katalogfund                               | `filmlisteTimestamp` für diese neue Quelle, stabil über Refresh; `contentDates.catalogueUpdatedAt` beschreibt den aktuellen Indexstand.   |
| Expliziter yt-dlp-Zeitpunkt / nur gelieferter Uploadtag        | `contentDates.providerDate` bzw. neues optionales `contentDates.providerDay` als validierter ISO-Kalendertag; keine Mitternacht erfinden. |
| Stabile Video-/Channel-/Playlist-/Formatidentität              | Eng typisierte `sourceRef` unter `sourceProviderId=youtube`; keine dritte Kopie von Titel/Dauer/URLs.                                     |

`providerDay` ergänzt den bestehenden Datumsowner nur für einen Tag ohne
Zeitpunkt. Uploadzeit und Erstfund werden weder zu `broadcastAt` noch zu
Episoden-Airdate oder Filmproduktionsjahr. Veröffentlichte YT-GUIDs hängen
nicht von diesen veränderlichen Datumsfakten oder CDN-Signaturen ab.

Getrennt davon stehen drei kleine Strukturen:

- **Kanalregister:** stabile Channel-ID, Anzeigename, lokaler Aktivzustand.
  Handles/URLs sind Eingabehilfen; Kanalnamen sind keine Identitätsschlüssel.
- **Programmzuordnungen:** Channel-ID plus Playlist-ID für Serien, Video-ID
  für einen einzelnen Film; Ziel ist eine typisierte TVDB- bzw. TMDB-ID.
  Ein Kanal darf mehrere Programme, ein Programm mehrere Quellen besitzen.
- **Geprüfte Bindung:** Video-ID, kanonische Programm-/Episodenidentität,
  verwendete Zuordnung/Revision und Herkunft `seed`, `metadata` oder `manual`.
  Quellen-Titel/-Nummerierung bleiben nachvollziehbar erhalten. Diese Bindung
  ist weder ein Audio-/Pixelbeleg noch ein Downloadauftrag.

`data/youtube-sources.json` ist der neue, mit dem Image versionierte
Vorbelegungskatalog mit `version`, `channels` und `programMappings`.
Lokale Ergänzungen, bestätigte Korrekturen und Deaktivierungen werden separat
über den vorhandenen Config-/Settingsowner gehalten; lokale Werte gewinnen
gegenüber derselben Vorbelegung. Seedupdates aktivieren keine neuen Kanäle,
überschreiben keine Nutzerkorrekturen und regenerieren keine Medien-IDs.
Ein ungültiger lokaler Eintrag wird sichtbar abgewiesen, nicht still durch
einen Seed ersetzt. Konfliktierende Zuordnungen bleiben unbestätigt.

Registryrevision als Compare-and-swap-Grenze behandeln: ein veralteter GUI-
Read darf keine inzwischen geänderte Zuordnung überschreiben. Konflikt 409,
bestätigten Stand neu laden; kein automatischer Retry. Schema/Normalisierung
bleiben rein und clienttauglich, Netzwerk/Config-/Prozessarbeit serverseitig.
Nur kanonische YouTube-IDs/-Hosts ohne Userinfo, freie Extraktorargumente oder
fremde Redirectziele zulassen; ein Playlistinhalt muss denselben freigegebenen
Video-Uploader nachweisen. Ein beliebiger yt-dlp-unterstützter Link ist keine
zulässige Kanalquelle. Neue Settings-/Bodygrenzen nur für den benannten
Registryvertrag anpassen, nicht andere Settingslimits pauschal vergrößern.

Speicherkeys: `provider.youtube.enabled` (Default `false`),
`internal.youtube.registry.v1` (lokale Overrides samt Revision) und
`internal.youtube.catalogue.v1` (begrenzter Metadatenindex). Interne Blobs
bleiben im bereits geschützten `internal.*`-Namensraum und außerhalb des
allgemeinen Policy-Snapshots/Settings-Readbacks. Ein ungültiges YT-Register
darf keine unabhängige Mediathek-Suche beim globalen Settingslesen stoppen.
Registry und Index nur gezielt laden, nicht für jeden normalen Settingsread
den kompletten Index übertragen oder aus der DB materialisieren.

Startumfang: KultKrimi und die dort verlinkten Serienkanäle für Der Kommissar,
Derrick, Der Alte und Ein Fall für zwei als zu prüfende Seedkanäle. Vor Lieferung
jede konkrete Channel-ID/Playlistbindung validieren; der Pflichtfall mit
ausgelieferter Programm-ID ist Der Kommissar. Weitere IDs dürfen nur nach
derselben Prüfung ergänzt werden. Der Metadatenbestand bleibt bei den bestehenden
Shows-/TVDB-/TMDB-/Sonarr-/Radarr-Ownern, nicht ein zweiter Episodenkatalog in
der YouTube-Datei. Eine ID-Vorbelegung ersetzt fehlende Episodenmetadaten nicht.
Ohne verfügbare kanonische Metadaten lautet der Status `metadata_unavailable`.
Sonarr bleibt optional; unabhängig vorhandene andere Metadaten bleiben nutzbar.

Zieloberfläche ist `/settings`, eigener Abschnitt „YouTube“ mit Kanälen und
Programmzuordnungen. URL einfügen → Channel/Playlist lesend prüfen → automatische
ID/Zuordnung mit Herkunft anzeigen → speichern oder gezielt korrigieren.
Keine JSON-Bearbeitung als Pflicht. Der neue `/api/youtube/catalogue`-Owner
liefert per GET Registry/Revision oder höchstens 100 Inventarzeilen pro Seite
samt Fortschritt. POST unterscheidet `save` (Registry und Enablewert atomar,
erwartete Revision erforderlich) und `refresh` (ausdrücklicher Metadatenscan).
Vor JSON-Parsing gilt für `save` die Registry-Bodygrenze von 1 MiB.
Vorhandene Config-/Write-Gate-/Invalidierungs-/Bestätigungsowner wiederverwenden;
der bestehende `/api/settings`-Vertrag wird nicht zu einer freien Blob-API.
Bestätigten Zustand zurücklesen; bei ungewissem Commit keine Writewiederholung.
Speichern ruft keine fremden Systeme auf. Scan/Enable reiht keine Medien in
die Downloadqueue ein.

## Automatik am Pflichtfall Der Kommissar

Öffentlich geprüfte Serienreferenz:
[Der Kommissar, TVDB 133771](https://thetvdb.com/series/der-kommissar),
97 reguläre Episoden in der Ausstrahlungsreihenfolge. Andere Orders nicht
mit deren Staffel-/Folgenkoordinaten mischen.
Die [KultKrimi-Playlist](https://www.youtube.com/playlist?list=PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5)
zeigte beim lesenden Browserabruf am 25.10.2026 „94 Videos“ und einen Hinweis
auf ein nicht verfügbares Video. Das ist kein bewiesener 97/97-Bestand und
kein Transfer-/Mediennachweis; weitere Kanaluploads sind dadurch nicht ausgeschlossen.

Vorgesehene Programmvorbelegung, noch keine implementierte Konfiguration:

```json
{
  "channelId": "UCNMj6SRjtvagiUBKYoqsW_w",
  "playlistId": "PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5",
  "mediaType": "series",
  "tvdbId": 133771,
  "episodeMatching": "unique-title",
  "sourceNumbering": "publisher",
  "targetOrder": "aired"
}
```

| Konkreter Titel           | KultKrimi-Bezeichnung | Kanonisches Ziel |
| ------------------------- | --------------------- | ---------------- |
| Auf dem Stundenplan: Mord | Staffel 2, Folge 1    | S01E13           |
| Der Papierblumenmörder    | Staffel 2, Folge 3    | S02E01           |

Gegenreferenz: [TVDB-Episodenliste](https://thetvdb.com/series/der-kommissar/allseasons/official).
Diese Abweichung darf nicht durch globales Ignorieren widersprechender
Koordinaten gelöst werden. Nur eine ausdrücklich passende Playlistzuordnung
mit `sourceNumbering=publisher` erlaubt die nachgewiesene Übersetzung über
einen eindeutigen konkreten Episodentitel derselben verifizierten Serie.
Eine unbekannte Nummerierungsart oder doppelte/generische Titel bleiben ungebunden.
Nur das bekannte Serien-/Staffel-/Folgenpräfix entfernen; ein Doppelpunkt im
eigentlichen Episodentitel bleibt erhalten. Die Zielkoordinaten müssen dem
tatsächlich geladenen kanonischen Episodenbestand entsprechen. Dessen Order
nicht umstellen und keine Sonarr-Metadaten für die YouTube-Nummerierung ändern.

Priorität der automatischen Programmauflösung: lokale bestätigte Zuordnung,
geprüfter Seed, dann eindeutiger Lookup in den bestehenden Metadatenquellen.
Neue Titel werden mit Typ/Jahr/Aliassen und verfügbaren Episoden gegengeprüft;
kein KI-Dienst, kein neuer Metadatenanbieter und kein „erster Suchtreffer“.
`tmdb.ts::searchMulti` und `searchMovieByTitle` wählen derzeit einen ersten
Treffer und sind **keine unverändert geeigneten Auto-ID-Resolver**. TMDB-TV-ID ist nicht TVDB-ID;
eine bestätigte Cross-ID ist nötig. Für Filme gelten konkrete Videoquelle,
kanonische TMDB-ID und unabhängiger Titel-/Jahr-/Laufzeitvertrag.

Der Referenzbericht enthält jede der 97 kanonischen Episoden genau einmal
mit Status `mapped`, `missing`, `ambiguous` oder `unavailable`, außerdem
zusätzliche/ungeklärte Videos und Scanabdeckung. `mapped` bestätigt nur die
Identitätszuordnung. Sprach-/Format-/Abrufbereitschaft werden separat gezeigt.
Ein Video in zwei Playlists bleibt eine Video-ID; verschiedene Uploads
derselben Episode bleiben Quellenalternativen. Keine Sammelvideos automatisch
zerlegen, keine Playlistposition als Folge, keine Uploadzeit als Erstausstrahlung.

## Begrenzte Discovery ohne zusätzliche Infrastruktur

`yt-dlp` und FFmpeg sind bereits vorhanden. `src/server/ytdlp.ts` enthält
Playlist- und Detailabfragen; die bisherigen Helper übernehmen aber nicht alle
stabilen YouTube-IDs, begrenzen stdout nicht und behandeln teils Fehler als
leere Liste. Diese Grenzen für den neuen YouTube-Pfad beheben, bestehendes
ORF-/HLS-Verhalten nicht beiläufig umstellen.
[JSON-Felder und Metadatenmodus](https://github.com/yt-dlp/yt-dlp#output-template)
sind der Quellvertrag, kein garantierter Vollbestand jeder Flat-Playlistzeile.

V1-Startgrenzen: ein eigener aktiver Metadatenscan je App, 100 Videos je
Seitenbatch, höchstens zehn Batches/1.000 Videos je Playlist und Refresh,
30 Sekunden/8 MiB stdout je Prozess. Fehlende/ungültige Zeilen und Timeouts
liefern einen sichtbaren unvollständigen/fehlgeschlagenen Scan, keinen leeren
Erfolg. Bei Größen-/Zeilenlimit `limited`, nicht „alles gefunden“.
Explizite Private-/Deleted-/Unavailable-Platzhalter sind gültige
Verfügbarkeitszustände: erhalten, ohne Titel, Uploader oder Video-ID zu
erfinden. Ein unbekannter Platzhalter wird keiner kanonischen Episode anhand
seiner Playlistposition zugeteilt. Fehlende Pflichtdaten einer normalen
verfügbaren Videozeile bleiben ein Scanfehler, kein stilles Skip.
Ein erfolgreich abgeschlossener Playlistindex wird begrenzt im vorhandenen
Configspeicher gehalten (höchstens 8 MiB normalisierte Metadaten insgesamt).
Registrygrenzen: 64 Kanäle, 256 Programmzuordnungen, 1 MiB Konfiguration.
Überläufe werden erklärt und abgewiesen; keine stille Verdrängung anderer Quellen.

Initialscan vor Suchfreischaltung der betreffenden Playlist; danach manuell
und frühestens nach sechs Stunden ein serieller Hintergrundrefresh aktivierter
Playlists. Kein neuer Dienst, Redis, YouTube-API-Key oder externer Scheduler.
Fortschritt, Scanzeit und fehlende Abdeckung erscheinen in der GUI. Nur vollständige
neue Playliststände ersetzen den letzten vollständigen Index atomar; alte
Metadaten sind ausdrücklich keine aktuelle Download-/Verfügbarkeitszusage.
Config-/Mappingwechsel invalidieren alte Scan-/Bindungsgenerationen. Restart
erhält den letzten vollständigen Metadatenindex; Readiness/Health startet keinen Scan.
Pause/Disable/Shutdown beendet eigene Kindprozesse und verhindert späte Writes.

Format-/Audiometadaten werden erst für passende gebundene Videos im bestehenden
Hintergrund-Belegpfad aufgelöst, nicht pro kompletter Playlistzeile. Startwert
hier: zwölf yt-dlp-Detailaufrufe pro Minute, Parallelität eins, 15 Sekunden und
8 MiB stdout je Child, keine automatischen Extraktorretries. Zwischen diesen
Aufrufen müssen vorhandene Mediathek-Belege weiter vorankommen. Die internen
HTTP-Aufrufe eines Extraktors sind kein einzelner gezählter HTTP-Versuch des
`HttpRequestBudget`: eigenes Prozess-/Ratebudget ausdrücklich ausweisen,
keine angebliche Einhaltung fremder HTTP-Zähler durch bloßes Callzählen.

Bei der vorhandenen Node-24-Runtime beginnen; YouTube-EJS ausdrücklich aktivieren
und die im verifizierten yt-dlp-Release gebündelten Komponenten prüfen.
[EJS-Vertrag](https://github.com/yt-dlp/yt-dlp/wiki/EJS).
Kein automatisches Runtimeupdate, Nachladen beliebiger Skripte, Login-/Cookie-
Workflow oder PO-Token-Dienst. Erfordert der reale Zielabruf zusätzliche
Infrastruktur, ist das ein enger Entscheidungsstopp in P17.4/P17.6.

## Suche, Download und Bestandsschutz

Die Erweiterung geht in `content-search.ts`, Provideradapter und bestehende
TV-/Filmmatcher. `sourceProviderId=youtube` und eine kleine validierte
`sourceRef` ergänzen den vorhandenen Katalogvertrag; kein neues Indexerprodukt.
Die Referenz enthält Video-/Channel-ID, tatsächlich validierten Playlistbezug
und vor Veröffentlichung gewählte Format-/Audiospurbindung. Originaltitel
bleibt `title`; kanonische Koordinaten stehen getrennt in der geprüften Bindung.
`url_website` bleibt die Watch-Seite; diese darf nie als progressive MP4-URL
in `url_video*` erscheinen. Fehlende Medien-/Untertitel-URLs bleiben leer.
Bei gemuxten YouTube-Formaten führt die typisierte Referenz den Transport,
nicht eine scheinbar komplette einzelne Video-only-URL.

Provider-/Normalizer-, Rendition-/Sprach-/Belegowner, GUI-NZB, Newznab-NZB,
Uploadparser, persistierter Job und Worker werden für die neue Quelle **gemeinsam**
umgestellt. Das bestehende versionierte Erwartungsfeld kann eine eng definierte
neue Jobversion tragen; alle Altversionen bleiben unverändert lesbar. Unbekannte
Versionen scheitern geschlossen, kein Legacyfallback auf eine YouTube-HTML-Seite.
Keine neue Tabelle oder Migration einplanen, solange Config und bestehendes
Payloadfeld reichen. Ein belegter abweichender Bedarf wäre ein eigener Replan.

Kurzlebige CDN-URLs werden vor Transfer frisch für dieselbe Video-/Format-/
Sprachbindung aufgelöst; Rotation ändert keine Releaseidentität. Fehlendes
Format oder gewechselte Audiospur scheitert, kein stilles `best`-Downgrade.
Programm-ID, Kanalname oder deutschsprachiger Titel beweisen weder Ton noch
Pixel. Die aktuelle Sprach-/Qualitäts-/Dauerpolicy und tatsächliche lokale
ffprobe-/Dateiprüfung vor Completed bleiben maßgeblich. Unbekannte Werte bleiben
Unknown. Keine Erweiterung allgemeiner Sprachregeln aus diesem Paket.

Eine `sourceRef` aus einem hochgeladenen NZB ist zunächst eine untrusted
Deklaration: **vor Enqueue** aktuelle Registryrevision, Aktivierung, Video-
Uploader, Bindung und aktuelle Medienfakten erneut prüfen. Der angenommene Job
hält die geprüfte Quellen-/Mappingbindung und Policy unveränderlich fest.
**Vor Transfer** externe Video-/Uploader-/Format-/Sprachfakten gegen genau
diesen Snapshot prüfen, nicht einen neuen Enablewert als nachträgliche
Stornierung benutzen oder einen inzwischen geänderten Ziel-ID-Eintrag übernehmen.
Die Übersetzung wird als gesonderte geprüfte Bindung konsumiert; Originaltitel
mit Anbieternummerierung nicht ungeprüft an den allgemeinen Koordinatenparser
übergeben und dessen Widerspruchsprüfung anschließend aushebeln.
Seed-/manuelle ID-Zuordnung erteilt keine v4-Quellenfreigabe; v4 bleibt
intern und kann weiterhin nicht aus einem NZB/SAB-Upload importiert werden.

YouTube ist eine unabhängige optionale Ergänzung: erfolgreiche Mediathek-
Basistreffer behalten ihren bisherigen Pfad und ihr Budget bei YT-Ausfall.
Ist der erforderliche Basisabruf gemäß bisherigem Quellenscope insgesamt
erfolgreich, bleibt dessen gültige Antwort einschließlich Leerfenster nutzbar;
YouTube wird dabei als ausgefallene Ergänzung ausgewiesen und nicht als
erfolgreich leerer Teilkatalog oder negativer Cacheeintrag behandelt. Eine
explizit nur auf YouTube beschränkte GUI-Anfrage bzw. eine Installation ohne
unabhängig erfolgreiche Basisquelle meldet bei YT-Ausfall pending/unavailable. GUI und
geschlossene Diagnose zeigen die fehlende Ergänzung; ein Newznab-Consumer
bekommt daraus keine Zusage vollständiger YouTube-Abdeckung. GUI-Gesamtcoverage
und Erfolgsgrenze erforderlicher Indexer-Basisquellen deshalb getrennt prüfen.
Das darf den bisherigen strengen `queryContent`-Vertrag für erforderliche
Mediathek-/SRF-/ORF-Quellen nicht global lockern.
Keine YouTube-Scans innerhalb der 15-Sekunden-Suchanfrage, kein Aufweiten der
32-TV-/10-RSS-Versuche. Explizite Einzel-/Staffelsuche umfasst alte Episoden.
Kalte Medienbelege und spätere Feednachlieferung verwenden den bestehenden
`source-media-facts.ts`-/`tv-search-delivery.ts`-Owner mit entsprechend typisierten
Quellenreferenzen; der jetzige Journalpfad akzeptiert nur progressive MP4s.
Produzenten und Nachlieferconsumer gemeinsam erweitern, kein globales RSS-
Zeitfenster ändern und keine zweite manuelle Suche als Lösung voraussetzen.

Kanalaktivierung, Zuordnung und Discovery starten keine Downloads. Medien
gehen nur über bestehende explizite GUI-/Arr-Aufträge und dieselben Enqueue-
Receipts, Einzelworker-/Abbruchgrenzen, Kategorien, Pfade und Mediengates.
YouTube erhält einen eigenen stabilen Quell-/Fassungsnamespace; bestehende
GUI-/RSS-/NZB-IDs, Jobs, Dateien, History und Profile werden nicht umgeschrieben.
Deaktivieren beendet neue YouTube-Discovery und neue Veröffentlichungen,
nicht bereits angenommene Jobs. Diese behalten ihren gespeicherten Vertrag;
eine Stornierung bleibt eine eigene explizite Bedienhandlung.

## Grenzen der Abnahme

GUI-/Matching-/Backend-/native Testdaten bleiben synthetisch, öffentliche
Vorbelegungen sind kuratierte IDs statt kopierter API-Dumps. Externe Zugriffe
in Tests sind gesperrt. Der öffentliche 97-Zeilen-Metadatenabgleich ist getrennt
von einer tatsächlichen Medienübertragung und einem Bibliotheksimport.
Ein YouTube-Metadatenabruf oder ein gemockter yt-dlp-Exit beweist keinen echten
YouTube-Transfer. Die isolierte reale Medien-/Arr-Testkette muss darüber hinaus
die neue Resolver-/Job-/Workerstrecke tatsächlich ausführen.

P17.1–P17.5 liefern Entwicklungsabnahme, keine Mainintegration oder Produktion.
Ein echter YouTube-Mediendownload und späterer Rollout bleiben das separat
freizugebende optionale P17.6. Bestehende offene P03.4/P06.4/P09.5/P15.1/P15.4
und Proxyentfernung werden nicht pauschal geschlossen oder zu Vorbedingungen
für die unabhängigen Register-/Mappingarbeiten erklärt.
