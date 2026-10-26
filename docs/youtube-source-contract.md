# YouTube als zusätzliche Katalogquelle — Vertrag P17

Fachentwurf vom 25.10.2026 gegen den damaligen Main `1c9d4f9` und Upstream
`345f5ed`; Entwicklungsabnahme am 26.10.2026 auf `ea00f30`.
Nutzerauftrag: separat und über die GUI pflegbare ÖR-YouTube-Kanäle,
automatische Serien-/Film-ID-Zuordnung mit Vorbelegungen, Mediathek-nahes
JSON, KISS und Bestandsschutz. Pflichtreferenz ist KultKrimi / Der Kommissar.
P17.1–P17.5 einschließlich der Mediathek-Modulgrenzen, Registeroberfläche,
ID-Bindung und gemeinsamer Such-/Downloadconsumer sind in der Entwicklung
abgenommen. Der Auftrag zur Mainintegration und zum anschließenden Rollout
liegt vor; zusätzliche Schemaaktualisierung und echte Referenzübertragung
bleiben getrennt freizugeben. Reihenfolge, Status und Abnahme ausschließlich in
[P17](../todo/proxy-retirement.md#phase-p17--youtube-quellen-im-bestehenden-katalogvertrag).
Keine Streaming-Webseite, Impressumsinventur oder zusätzliche Medienverwaltung.

## Verbindliche Modulgrenzen für Suche und Download

Nachgeschärfter Nutzerentscheid 25.10.2026: Mediathek und YouTube erhalten
jeweils ein eigenes Such- und Downloadmodul. Die Anwendung bedient beide über
dieselben kleinen Verträge. Gemeinsam bleiben Inhaltsmodell, Metadatenmatching,
GUI-/Arr-Schnittstellen und Auftragslebenszyklus. Lokale Module innerhalb
derselben App genügen; keine neuen Dienste oder Pluginarchitektur.
Die vier Quellenmodule bleiben auch dann getrennt, wenn sie dieselbe
HTTP-/yt-dlp-/FFmpeg-Bibliothek verwenden. Werkzeugwiederverwendung ist kein
Grund, Mediathek- und YouTube-Abruf in einem Backend zusammenzufassen.

P17.1a zieht den konsumierten MVW-/ORF-/SRF-Abruf in
`src/providers/mediathek/search.ts` und den direkten/HLS-/SRF-Transfer in
`src/providers/mediathek/download.ts`. `queryContentWindow` konsumiert den
`ContentSearchAdapter`; `processOwnedDownload` konsumiert den
`SourceDownloadAdapter` über den begrenzten `source-download.ts`-Dispatch.
`getDownloadInfo` bleibt ein Informationshelper, kein zweiter Transferpfad.

| Verantwortung                                                          | Gemeinsamer Owner                                                     | Quellenspezifischer Owner                                                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Suchaufruf, Scope, Gesamtdeadline, gemeinsame Policy und Consumer      | `src/services/content-search.ts`, Verträge in `src/types/provider.ts` | `src/providers/mediathek/search.ts`; später `src/providers/youtube/search.ts`                                 |
| Abruf, Pagination, Quellbudget, Rohdatenvalidierung und Normalisierung | Derselbe Suchfenster-/Inhaltsvertrag                                  | Mediathekadapter benutzt vorhandenen MVW-/ORF-/SRF-Zugriff; YouTubeadapter den begrenzten registrierten Index |
| Programm-/Episodenbindung, Sprache, Qualität und NZB                   | Bestehende zentrale Metadaten-, Matching-, Beleg- und Releaseowner    | Adapter liefern Fakten/Identität, erteilen keine eigene Freigabe                                              |
| Transferauflösung und Medienübertragung                                | Enger Vertrag/Dispatch `src/server/source-download.ts`                | `src/providers/mediathek/download.ts`; später `src/providers/youtube/download.ts`                             |
| Queue, Lease, Receipt, Status, Fortschritt und Abbruch                 | Bestehender Downloadmanager/Worker                                    | Module melden Fortschritt/Phase und beachten das übergebene Abortsignal; keine eigenen DB-Writes oder Worker  |
| Containerkonvertierung, Pfade, Medienprüfung und Completed             | Bestehende gemeinsame FFmpeg-/Completion-/Pfadowner                   | Module liefern das Artefakt im zugewiesenen Job-Staging; kein eigener Completed-/Importpfad                   |

Die Familie `mediathek` ersetzt keine veröffentlichten Provider-IDs:
`mediathekview`, `orf` und `srf` samt Einstellungen, Abdeckung und Referenzen
bleiben erhalten. Der Familienadapter wahrt den bisher gemeinsam abgerufenen
MVW-/ORF-Kandidatenblock; keine verdoppelten Requests/Budgets durch naives
Aufrufen jeder Providerklasse. ARTE-Editionsauflösung bleibt an dieser
Quellengrenze, allgemeine Identitäts-/Sprachregeln bleiben gemeinsam.

Der Suchvertrag liefert normalisierte Inhaltszeilen plus ehrlichen
Quellenzustand, Begrenzung und Provenienz. Bestehende Query-/Optionsaufrufe
bleiben über den jetzigen Einstieg kompatibel; der Mediathekadapter übersetzt
in das MVW-JSON. YouTube muss keine MVW-HTTP-Anfrage nachbilden. Quellen liefern
ihren Konfigurations-/Index-Revisionsfingerprint zum gemeinsamen Cachekontext;
ein Registrywechsel darf keine alten Treffer oder Bindungen wiederverwenden.
Vorhandene Providertypen gezielt erweitern; kein drittes Inhaltsmodell,
zweiter Aggregator oder paralleler aktiver Suchpfad neben `queryContentWindow`.
Die Registry verwaltet Registrierung, Initialisierung und Status. Ihre
ungenutzten Suchaggregatoren wurden nach Aufrufprüfung entfernt; GUI und
Indexer verwenden weiter `queryContentWindow`. Exportierte MVW-/ORF-Suchhelper
benutzen denselben Quellenowner bei unverändertem Einzel-Seitenvertrag; der
SRF-Provider bleibt dessen bestehendes Lowlevel-API-Primitiv. Die sourceigenen
Settingskeys fließen in den gemeinsamen Cachekontext ein. Kein zweiter
Aggregator und keine Rundumerneuerung.
Die Aufrufrichtung bleibt Koordinator → Quellenadapter → Lowlevelclient;
ein Adapter ruft keine Providerfassade zurück, die wiederum an ihn delegiert.
Modulimport und Registrierung starten keine Netz-/Toolaufrufe. Eine fehlende
YouTube-Runtime darf eine deaktivierte YouTube-Quelle oder die unabhängige
Mediatheksuche nicht beim App-Import abbrechen; Prüfung erst im benannten Pfad.

Der Transfervertrag nimmt eine validierte, im Job eingefrorene Quellenreferenz,
Medienerwartungen und den kontrollierten Ausführungskontext entgegen:
zugewiesenes Staging, Abortsignal und Fortschritts-/Phasenmeldungen. Er liefert
ein vorhandenes lokales Artefakt mit ausgewähltem Ausgabesuffix oder einen
geschlossenen Fehler. Das Suffix ist kein Beweis des physischen Containers;
den tatsächlichen Container bestätigt ausschließlich die gemeinsame ffprobe-
Prüfung. Der Dispatch verlangt eine positive reguläre Datei direkt im eigenen
Staging, ohne Symlink und mit begrenztem Suffix. Gemeinsame Status- und
Dateibesitzprüfung bleibt Pflicht.
Quellenauflösung und Format-/Audiospurprüfung gehören ins jeweilige Modul;
Enqueue-Freigabe, interne v4-Prüfung und finale ffprobe-Abnahme bleiben zentral.
Der Belegpfad benutzt dieselbe Quellenauflösung wie der Transfer, keinen
zweiten YouTube-/Mediathekparser mit abweichenden Formatregeln.

Mediathek-Downloads behandeln direkte Dateien, HLS und stabile SRF-Referenzen;
YouTube-Downloads lösen Video-/Format-/Audioreferenzen auf. Beide verwenden
vorhandene HTTP-/yt-dlp-/FFmpeg-/Prozessprimitive. `yt-dlp` bedeutet nicht
automatisch YouTube: Mediathek-HLS benutzt es bereits. Quellenspezifisches
Muxing darf im Modul erfolgen; eine passende Datei wird im gemeinsamen
Containerpfad nicht nochmals konvertiert. Pfadnamen und Konvertierungspräferenz
bleiben gegenüber dem bisherigen Mediathekverhalten unverändert.

Die Containerpräferenz wird pro Job einmal bei Bedarf gelesen: Streams vor
dem Transfer, direkte MP4 vor der optionalen Konvertierung. Andere fertige
Dateiformate benötigen diese Einstellung nicht. Alle Pfade münden in genau
einen gemeinsamen Move-/Completion-Aufruf. Das Quellmodul darf diesen Gate
weder überspringen noch einen eigenen Completed-Status speichern.

Eine feste geschlossene Zuordnung im Dispatch genügt. GUI, SAB/Newznab,
Queueorchestrierung und Completion enthalten keine Quell-URLtests oder eigenen
Backendauswahlzweige. Historische Jobs ohne neue Quellenreferenz laufen über
einen engen Legacyadapter mit exakt bisheriger URLklassifikation; neue unbekannte
Versionen/Provider werden abgewiesen. Kein Wechsel zum anderen Backend bei Fehler.

P17.1a führt die Grenze zuerst mit dem tatsächlich konsumierten Mediathekpfad
ein. P17.4 ergänzt YouTube als zweite Implementierung ohne neue Kernverzweigung.
Getrennte Modultests und derselbe gemeinsame Consumer gegen beide Module sind
Pflicht: Deaktivierte Quellen lösen bei neuer Suche/Discovery keine eigenen
Netz-/Prozessabrufe aus. Bereits angenommene Jobs behalten ihren eingefrorenen
Vertrag. Fehler bleiben ihrer Quelle zugeordnet. Adapteraustausch und wirklicher
Aufruf-/Datei-/Statusreadback beweisen diese Grenzen, keine Ordner-/Source-String-Abnahme.

RundfunkArr ist historischer Ursprung und ausschließlich Vergleichsquelle.
Pingufunks Architektur, Funktionsumfang und Abnahme richten sich nach eigenen
geprüften Verträgen; Upstreamparität ist kein Ziel oder Freigabegate.
Ausgelieferte Pingufunk-/Arr-/Datenverträge bleiben geschützt. Einzelne nützliche
Quelländerungen können nach eigener Prüfung übernommen werden, ohne Bindung
an die weitere RundfunkArr-Entwicklung. Die eigenständige deutsche/englische
Produktdarstellung ist der separate P18-Pfad im bestehenden Phasen-TODO.

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

| Daten                                                                                               | Heutiger Pingufunk-Pfad                                                                                                                                                                                                 | Bewertung / Ziel P17                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `channel`, `topic`, `title`, `description`                                                          | Werden übernommen.                                                                                                                                                                                                      | Feldnamen und Bedeutung erhalten; Originaltitel bei einer kanonischen Zuordnung nicht verlieren.                                                                                                                                                 |
| `duration`, `size`                                                                                  | Sekunden und Bytes; explizit unbekannte Dauer/Größe werden zu `0` normalisiert.                                                                                                                                         | `0` bleibt unbekannt, kein positiver Laufzeit-/Größenbeleg.                                                                                                                                                                                      |
| `url_website`, `url_video`, `url_video_low`, `url_video_hd`                                         | Werden übernommen.                                                                                                                                                                                                      | Leere Slots bleiben leer; `hd` ist zunächst ein Katalogslot, kein Pixelbeweis.                                                                                                                                                                   |
| `id`                                                                                                | Optional als Quell-ID übernommen; GUI-/RSS-Identitäten haben eigene bestehende Regeln.                                                                                                                                  | Quell-ID erhalten, aber veröffentlichte IDs/GUIDs nicht durch volatile Zeilenhashes ersetzen.                                                                                                                                                    |
| `timestamp`                                                                                         | Gültige Epochsekunden werden zu `contentDates.broadcastAt`.                                                                                                                                                             | Kein Verlust des Sendetermins; nicht mit Katalogupdate, Filmjahr oder YouTube-Uploaddatum gleichsetzen.                                                                                                                                          |
| `filmlisteTimestamp`                                                                                | Legacywert bleibt erhalten; normalisierte Katalog-/Sendetermine werden unabhängig ergänzt.                                                                                                                              | Beide gültigen Datumsfakten unabhängig erhalten; Legacy-IDs, Sortierung und pubDate unverändert lassen.                                                                                                                                          |
| **`url_subtitle`**                                                                                  | Wird validiert als optionales `url_subtitle` übernommen, im Provideradapter als `subtitleUrl` und in beiden GUI-Antwortpfaden erhalten.                                                                                 | Der frühere Feldverlust ist in P17.1 behoben. Kein automatischer Untertiteldownload; ungültige optionale URLs bleiben unbekannt.                                                                                                                 |
| `queryInfo` mit Quellzählungen, `totalRelation`, `totalEntries`, Suchdauer                          | Wird nicht als Teil der einzelnen Katalogzeile weitergereicht.                                                                                                                                                          | Bewusste Trennung: Transport-/Suchstatistik ist kein Medieninhalt. Eigene Coverage aus wirklich geprüften Fenstern; fremde Counts sind keine Zahl sicher zugeordneter Folgen.                                                                    |
| Sprach-/Fassungsflags und `productionYear` zwischen internen Typen                                  | `audioLanguage`, Datum/Rechte und Audio-/Dimensionsbelege werden gezielt weitergereicht. Deklarierte Fassungsflags, explizites Produktionsjahr und validierte Datumsarten bleiben in beiden Adapterrichtungen erhalten. | Deklarierte, validierte interne Inhaltsfelder explizit erhalten, einschließlich `subtitleLanguage`, OV/AD/Gebärden-/Klarsprache und belegtem Produktionsjahr. Das ist ein Adaptervertrag, keine Zusage, dass MediathekView diese Fakten liefert. |
| Beliebige Zusatzfelder wie angebliches `audioLanguage`, Rechte oder Dimensionen in einer Rohantwort | Werden absichtlich nicht als interne Belege übernommen; kausale Tests schützen diese Grenze.                                                                                                                            | Beibehalten. Vollständige **deklarierte Inhaltsfelder** sind das Ziel, kein ungeprüftes Durchreichen eines Fremdobjekts.                                                                                                                         |

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
P17.1 erhält die benannten optionalen Felder über die bestehende Metadatenprojektion. Keine beliebigen `raw`-Objekte oder
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

## Implementierter Register- und Scanvertrag P17.2

`src/lib/youtube-catalogue.ts` ist der reine gemeinsame Schema-/Normalisierungs-
owner. `scripts/validate-data.ts` verwendet dieselbe Zod-Definition für
`data/youtube-sources.json`; keine zweite handgepflegte Schemakopie.
`src/services/youtube-catalogue.ts` besitzt Configtransaktionen, Generationen
und seriellen Scan; `src/server/ytdlp.ts::readYoutubeMetadata` nur den begrenzten
Metadatenprozess. `/settings` bietet einen eigenen YouTube-Tab mit getrennten
Kanälen, Programmzuordnungen und Inventar. Vorhandene Card-/Input-/Button-
Komponenten, Settingsantwortreihenfolge und bestätigter Datenbankreadback werden
wiederverwendet. Kein frei editierbarer JSON-Blob im Browser.

Die fünf deaktivierten Vorgaben wurden am 25.10.2026 direkt an den öffentlichen
YouTube-Kanalmetadaten und den Verlinkungen der KultKrimi-Startseite geprüft:
[KultKrimi](https://www.youtube.com/channel/UCNMj6SRjtvagiUBKYoqsW_w),
[Der Kommissar](https://www.youtube.com/channel/UCpvShrzBCVTGfyPILXJdacQ),
[Derrick](https://www.youtube.com/channel/UCbPtvkOcfOQdJLLFIGwOiuw),
[Der Alte](https://www.youtube.com/channel/UCBJSg2Gll35hMOiJhaR1JMA) und
[Ein Fall für zwei](https://www.youtube.com/channel/UCXtdewPPx-SXbCo9g6Z2k1Q).
Die Kommissar-Playlist gehört laut Playlistowner KultKrimi und ist als einzige
hier ausgelieferte Programmbindung TVDB 133771 zugeordnet. Keine weiteren IDs
geraten; keine vollständige Episodenabdeckung daraus abgeleitet.

Das lokale Register speichert `version`, eine neue UUID-Generation und die
bearbeiteten Registerzeilen. Kanäle werden über Channel-ID, Programme über
Channel-ID/Typ/Playlist- bzw. Video-ID zusammengeführt. Lokale Werte gewinnen;
neu hinzugekommene Seeds bleiben aus. Vorgaben bleiben sichtbar und lassen
sich deaktivieren, lokale Ergänzungen auch entfernen. Quell-IDs stammen aus
der URLprüfung und bleiben im Formular unverändert; Name, Ziel-ID und Aktiv-
zustand sind korrigierbar. Neue Ziel-IDs sind in P17.2 manuelle Zuordnungen;
die automatische ID-/Episodenprüfung folgt in P17.3.

Die API hat ausschließlich begrenzte Operationen:

- GET ohne Parameter: Register, Revision, Enablewert und Scanstatus; kein
  Quellabruf. GET `?page=N`: höchstens 100 normalisierte Inventarzeilen.
- POST `save`: höchstens 1 MiB vor JSON-Parsing, striktes Schema, erwartete
  Revision. Compare-and-swap und Enablewert liegen in derselben Transaktion;
  ein überholter Stand ergibt 409. Ungewisse Writes werden nicht wiederholt.
- POST `inspect`: kanonische Kanal-/Playlist-/Videoadresse oder ID lesend
  auflösen. Fremde Hosts, Credentials, Fragmente, mehrdeutige Parameter und
  beliebige Extraktorargumente sind gesperrt.
- POST `refresh`: ausdrücklich gespeicherte aktive Quellen seriell einlesen,
  Fortschritt über GET. Alle zehn Seiten gehören zum selben Versuch; nach
  dem letzten Versuch frühestens sechs Stunden erneut. Die GUI zeigt den
  frühesten nächsten Zeitpunkt. POST `cancel` beendet eigene Kindprozesse.

Alle POSTs benutzen den bestehenden Writer-Gate und einen eigenen Same-origin-
Header. Das allgemeine `/api/settings` kann den YouTube-Schalter nicht allein
ändern; unverändertes historisches Bulk-Readback bleibt ein No-op. Allgemeine
Settingsreads filtern `internal.*` bereits in der Datenbankabfrage. Der
Settingssnapshot lädt weiterhin nur seine kleinen benannten Policykeys;
ein ungültiges deaktiviertes Register stoppt die unabhängige Mediatheksuche nicht.

Der Index bleibt im vorhandenen Configmodell: `internal.youtube.catalogue.v1`
enthält ein maximal 64-KiB-Manifest, referenzierte interne Seiten enthalten je
höchstens 100 Zeilen/1 MiB. Manifest und alle Seiten zusammen bleiben unter
8 MiB. Ein vollständiger neuer Stand ersetzt den alten atomar; GUI- und
allgemeine Settingsreads materialisieren keinen mehrmegabytegroßen Gesamtindex.
Registrygeneration, Versuch und Indexgeneration werden beim Publizieren erneut
gebunden. „Vollständig“ erscheint erst nach bestätigtem Indexcommit. Ein
unterbrochener oder ungewisser Versuch ist kein leerer Erfolg; letzter
vollständiger Stand und ursprünglicher Erstfund pro Video bleiben erhalten.

Der Prozess verwendet feste Metadaten-/Simulationsargumente des bestehenden
gepinnten yt-dlp, ausschließlich YouTube-Extraktoren und die vorhandene Node-
Runtime. Kein Requestinstaller, Medienabruf, freier Plugin-/Config-/Cookiepfad,
Runtimeupdate oder Nachladen von Skripten. 30 Sekunden/8 MiB stdout, begrenzte
Pufferanzahl, keine Extraktorretries; Fehlertexte sind geschlossen und enthalten
keine Rohantworten oder Toolstderr. Abbruch wartet auf die eigene Prozessgruppe.
Der Hintergrundtimer wird nur im schreibfreigegebenen App-Lebenszyklus gestartet,
führt beim Start keine Suche aus und prüft frühestens nach sechs Stunden.
Readiness/Health startet keinen Scan. Shutdown, Abbruch und Registerwechsel
beenden den eigenen Prozess und verhindern die Publikation alter Generationen.

Normale Zeilen benötigen stabile Video-/Uploader-ID und Titel. Fremduploader,
fehlende IDs, doppelte Video-IDs und ungültige Zeilen scheitern sichtbar. Explizite
private/gelöschte Platzhalter bleiben unverfügbar, auch ohne Video-ID; keine
Episodenbindung aus Listenpositionen. Inhaltsfelder bleiben Mediathek-nah:
Sekunden, unbekannte Größe `0`, Watch-Seite nur in `url_website`, leere
Medienslots, Erstfund getrennt von Indexzeit/Uploadtag. Rohe Formate, Sprache,
Staffel-/Folgenbehauptungen oder komplette Tooldumps werden hier nicht zu
kanonischen Medienbelegen. Inventar, Programmzuordnung und Medienfreigabe
bleiben getrennt. Keine YouTube-Suchantwort, NZB oder Medienqueue in P17.2.

## Automatik am Pflichtfall Der Kommissar

Öffentlich geprüfte Serienreferenz:
[Der Kommissar, TVDB 133771](https://thetvdb.com/series/der-kommissar),
97 reguläre Episoden in der Ausstrahlungsreihenfolge. Andere Orders nicht
mit deren Staffel-/Folgenkoordinaten mischen.
Die [KultKrimi-Playlist](https://www.youtube.com/playlist?list=PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5)
zeigte beim lesenden Browserabruf am 25.10.2026 „94 Videos“ und einen Hinweis
auf ein nicht verfügbares Video. Das ist kein bewiesener 97/97-Bestand und
kein Transfer-/Mediennachweis; weitere Kanaluploads sind dadurch nicht ausgeschlossen.

Implementierte, zunächst deaktivierte Programmvorbelegung in `data/youtube-sources.json`:

```json
{
  "channelId": "UCNMj6SRjtvagiUBKYoqsW_w",
  "sourceId": "PL_H50xx0qoB_bynOI7Esvpfj6EhvxOFS5",
  "kind": "series",
  "targetId": 133771,
  "name": "Der Kommissar",
  "enabled": false,
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

## P17.3: implementierte Bindung und Bericht

`youtube-identities.ts` schlägt ausschließlich Programmidentitäten vor; die
Prüfung speichert und aktiviert nichts. Lokale ID vor Seed, danach vorhandener
Katalog, optionale Sonarr-/Radarr-Metadaten und konfiguriertes TMDB. Eindeutige
TV-Suchergebnisse erfordern TVDB-Cross-ID und Rückbindung zur gleichen TMDB-ID.
Homonyme, unvollständige Suchfenster, Jahres-/Cross-ID-Widersprüche bleiben
unklar. Ein Jahreswert im Programmtitel ist vom Uploadtag unabhängig. Eine
fehlende Integration verhindert weder einen verfügbaren Katalog noch einen
unabhängigen optionalen Provider. Die ausgewählte Identität wird nochmals
gegen konkrete kanonische Metadaten geprüft; eine Seed-ID ersetzt diese nicht.

`youtube-mapping.ts` bindet nur passende registrierte Quelle, bestätigten
Uploader und eindeutige konkrete Episodentitel. Der Standardmodus bewahrt
Koordinatenkonflikte. Nur `sourceNumbering=publisher` erlaubt die Titelübersetzung
mit geprüftem Serienpräfix. Eine gezielte Titelaliasliste gehört zur Bindung,
nicht zum globalen Parser; eine ID-Korrektur entfernt alte Ausnahmen und setzt
die Nummerierungsregel zurück. Gleiche Titel, fremde Uploader, doppelte
Video-IDs und gleichzeitig verschiedenen Programmen zugewiesene Videos werden
nicht automatisch passend gemacht. Alternativuploads bleiben getrennt erhalten.

Der minimale kanonische Bestand in `data/shows.json` enthält alle 97 regulären
Folgen von TVDB 133771 mit Titel, Koordinaten und Ausstrahlungsdatum. Laufzeit
bleibt ohne Beleg unbekannt. Die Standard-Katalogadresse gehört dem eigenen
Fork; neu gebündelte, dort noch fehlende Serienidentitäten ergänzen den
Standardabruf. Ein explizites `SHOWS_URL` bleibt autoritativ. Providerfolgen
werden durch einen Teilkatalog nicht verdrängt. Unbekannte Laufzeit-/Datumswerte
dürfen nur derselbe konkrete Titel und dieselbe eindeutige Koordinate ergänzen.

Dieser ergänzende Identitätskatalog ist kein eingefrorener Mediathekbestand.
Ohne URL-Override liest die Anwendung den eigenen Main-Katalog bei Nutzung
nach spätestens einer Stunde erneut; bei Abruffehlern bleibt der gebündelte
Fallback. Der eigentliche Mediathekbestand kommt getrennt aus aktuellen
Providerabfragen. Ein geprüftes App-Image erfordert keinen festen Commit-Pin
für diesen Katalog; der im Betrieb noch vorhandene historische Override soll
beim freigegebenen Rollout entfallen, nicht durch einen neuen Pin ersetzt werden.

Der Metadatenadapter verlangt deutsche Metadatentitel (`youtube:lang=de`);
das ist **kein** Nachweis deutscher Audiospuren. Eine vollständig feldlose
Flat-Playlistzeile erhält höchstens einen zusätzlichen exakten Videoabruf,
maximal zehn solche Abfragen je Scan. Nur eine eindeutige Nichtverfügbarkeits-
Diagnose derselben Video-ID bestätigt deren Verfügbarkeitshinweis. Timeout,
fremde ID oder Prozessfehler bleiben Fehler. Keine Episode wird aus Position
oder fehlenden Feldern abgeleitet. Frühere bestätigte Titel/Uploader werden
nur für jetzt nicht verfügbare Einträge als `lastKnown` erhalten.

`youtube-report.ts` verwendet den vollständigen gespeicherten Index, dieselben
Metadatenowner und die aktuelle Registerrevision. Ein alter Index wird nicht
auf neue IDs umgebunden. Der GET-Bericht ist ohne Scan-/Jobwrites in derselben
Settings-GUI erreichbar, mit 100 kanonischen Zeilen je Seite, Gesamtsummen und
separaten Extras. Jede Quellenbindung enthält Originaltitel, vorhandene
Quellkoordinaten und Mappingrevision. `mediaReady=false` ist ausdrücklich;
P17.4 muss erst tatsächliche Audio-/Format-/Transferbelege integrieren.

Der begrenzte öffentliche Produktabgleich am 26.10.2026 ergab 94 Einträge,
93 sicher zugeordnete Episoden und vier kanonische Folgen ohne zugeordneten
Quelleintrag. Ein explizit privater Eintrag hat keine bekannte Episodenidentität
und bleibt separat. Er könnte zu einer der vier gehören; daraus folgen weder
vier global fehlende Videos noch 97/97-Verfügbarkeit. Alle 97 kanonischen
Zeilen wurden über den tatsächlichen Produktbericht ausgegeben. Kein Downloadjob,
keine Tonspur-/Formatprüfung, kein Mediendownload. Reale Antworten und Werkzeuge
bleiben privat ignoriert; Tests verwenden generierte synthetische Videozeilen.

## P17.4: typisierte Quellen- und Mediengrenze

Der neue Quelleinstieg besteht aus `providers/youtube/search.ts`, `resolve.ts`
und `download.ts`; die Registryfassade `providers/youtube/index.ts` delegiert
nur Suche/Status. Sie startet beim Modulimport oder bei deaktivierter Quelle
keinen Extraktor. Beide Quellenmodule bedienen denselben Suchfenster- und
Transfervertrag. Queue, Lease, Pfade und Completion bleiben beim vorhandenen
Worker; kein YouTube-Downloadzweig in der GUI und kein zweiter Worker.

| Feld/Owner                 | Konsumierter Vertrag                                                                                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sourceProviderId=youtube` | Expliziter Quellenowner; alte drei Provider-IDs bleiben unverändert.                                                                                                                                                |
| `sourceRef` v1             | Video-/Kanal-/Playlistidentität, kanonische Programmkoordinaten, Originaltitel und Mappingrevision. Nach Beleg zusätzlich exakte Video-/Audioformat- und Trackidentität, Sprache, Pixel und Laufzeit.               |
| `url_website`              | Watch-URL der Video-ID. Alle drei Mediathek-Byte-Slots bleiben leer. Unversionierte YouTube-URLs gelangen nicht zum alten Dateiadapter.                                                                             |
| `sourceRenditions` intern  | Höchstens fünf belegte Auflösungen derselben Video-/Programm-/Audioidentität aus genau einem Extraktorabruf; ohne CDN-Adressen und nie als Variantenliste im persistierten Job.                                     |
| Medienvertrag v5           | Neue NZB-/SAB-/Jobdeklaration mit derselben typisierten Auswahl, unabhängigen Laufzeitreferenzen und Quellen-Audiobeleg. Kein Downgrade zu v1–v3 bei beschädigten Feldern.                                          |
| Interne v4-Freigabe        | Bleibt ausschließlich die bestehende einmalige Laufzeitausnahme. Optionale typisierte Bindung muss exakt zu Freigabe, Pixeln, Dauer und Audiobeleg passen; automatische NZB-Aufnahme akzeptiert v4 weiterhin nicht. |
| `internal.tv-delivery.v2`  | Derselbe begrenzte Discoveryowner mit typisierten Quellen. Ein unveränderter alter v1-MP4-Bestand kann übernommen werden; v1 wird nicht nachträglich als YouTube-Vertrag interpretiert oder überschrieben.          |
| Aufnahmebedingungen        | Private gelesene Register-/Enabled-/Indexwerte werden durch bedingte No-op-Updates bis zum Jobcommit gesperrt. Keine zusätzlichen öffentlichen Payloads oder DDL.                                                   |

Der Resolver ist für Belege und Transfer identisch. V1 wählt eine konkret
belegte deutsche Standard-Audiospur und belegt je unterstützter gemessener
Auflösung genau ein AVC/H.264-Videoformat. Der bestehende Releasevertrag heißt
`h264`; der Transfer kopiert die Videospur ohne Transcodierung. VP9 und AV1
werden deshalb vor Veröffentlichung ausgeschlossen, auch wenn sie höhere
Auflösungen anbieten. Fehlt AVC, bleibt diese Quelle ungeprüft; kein falsches
Codecetikett und kein stiller Formatwechsel eines angenommenen Jobs.
Derselbe begrenzte Abruf liefert beispielsweise
1080p und 720p; eine Einstellung „nur 720p“ darf nicht am höchsten Format
scheitern. Der gemeinsame Renditionowner bindet jede RSS-/UI-NZB an ihre
eigene Auswahl, Pixel und Audioidentität. Der Job enthält genau diese eine
Version, keine Alternativenliste. Fehlende Qualitäten werden nicht ersetzt;
fehlende/unklare Sprache wird nicht Deutsch. Tatsächliche Format-IDs und Track
bleiben erhalten. Ein angenommener Job darf später nur exakt diese Auswahl
frisch auflösen; geänderte Signaturen sind zulässig, fremder Uploader, andere
Formate/Tracks, Sprache, Pixel oder widersprechende Laufzeit nicht. Medien-URLs
müssen öffentliche HTTPS-`googlevideo.com`-CDN-Selektoren mit ausreichender
Restgültigkeit sein. Keine Weiterleitung, Cookies, Remote-Plugins, Toolupdates
oder automatische Installation. Der Transfer lädt die zwei frisch gebundenen
Adressen über die bestehende Transferprimitive und muxiert genau Video 0 und
Audio 0 mit dem vorhandenen FFmpeg. Der gemeinsame ffprobe-/Completiongate
bleibt zwingend; zusätzliche/foreign Audiotracks und falsche Pixel/Dauer
werden abgewiesen. Fehlende Container-Sprachtags werden nicht umgestempelt;
ein unabhängiger frischer Quellenbeleg wird getrennt protokolliert.

Der bestehende Belegworker verarbeitet beide Quelltypen seriell und fair.
YouTube hat eine eigene Grenze von zwölf Detailprozessen pro gleitender Minute,
15 Sekunden und 8 MiB pro Child ohne Extraktorretry. Das sind ausdrücklich
Prozessaufrufe, keine Behauptung über interne yt-dlp-HTTP-Requests. Erschöpfte
YouTube-Rate blockiert keine neu ankommenden Mediathek-Belege. Direkt vor einem
Hintergrundabruf wird die aktuelle Discoverybindung nochmals geprüft.
Deaktivierung/ID-Korrektur verwirft nur unangenommene YouTube-Vorarbeit;
angenommene Jobs behalten ihre eingefrorene Bindung. Ein fehlgeschlagener
frischer Beleg macht einen älteren positiven Hinweis nicht wieder gültig.
Stabile typisierte Formatbelege gelten 15 Minuten; CDN-Adressen werden dabei
nicht gespeichert. Der gehaltene Discoverybestand erneuert sie zwei Minuten
vor Ablauf, innerhalb derselben Prozessrate. Wartende gehaltene Quellen behalten
ihre begrenzte Discoveryfrist, damit auch 97 Ziele seriell vollständig werden.
Die bisherigen MP4-Fristen bleiben unverändert; jeder Transfer löst frisch auf.

Die Suchquelle liest ausschließlich den vorbereiteten vollständigen Index;
keine Playlist-Scans im Suchrequest. Höchstens 1.000 YouTube-Kandidaten pro
Fenster und 32 Programme, keine neuen globalen RSS-Budgets. Freitext sucht in
den ausdrücklich angefragten Titel-/Thema-/Sender-/Beschreibungsfeldern der
Indexinhalte; die Programmauswahl allein ist kein Trefferbeleg. Die konkreten
gebundenen Inhalte werden vor Pagination und Belegaufnahme gefiltert. Ein
kanonischer Serien-ID-Scope behält seine eigene geprüfte Identitätsgrenze.
Alle gewöhnlichen Film-/Seriensuchen verwenden ausschließlich vorhandene oder
asynchron eingereihte Medienbelege. Nur die ausdrückliche Prüfung einer
Einzelquelle darf synchron frisch auflösen. Zurückgezogene Belege können
nicht aus einem älteren Suchobjekt übernommen werden.
Eine erfolgreiche erforderliche
Basis einschließlich echtem Leerfenster bleibt bei optionalem YouTube-Fehler
nutzbar. Gesamtcoverage und Basis-Erfolg sind getrennt; ein Fehlerepoch verhindert
leeres Cachen des ausgefallenen Zusatzpfads. Expliziter YouTube-only-Ausfall
bleibt unbestätigt. Neue reine YouTube-GUIDs enthalten einen eigenen Namespace
und stabile Format-/Audioidentität statt kurzlebiger CDN-Signaturen.

Neue Aufnahme prüft die aktuelle Bindung; dieselbe bestätigte Intentquittung
quittiert dagegen den bereits angenommenen Auftrag auch nach Deaktivierung.
Ein Registrywechsel zwischen Prüfung und atomarem Insert erzeugt keinen Job.
Neuauflösung im Worker prüft die externe Quelle gegen den eingefrorenen Job,
nicht gegen eine inzwischen andere Programmzuordnung. Retry behält denselben
Quellenvertrag. Alte Images dürfen unbekannte v5-Deklarationen nicht als
Legacy behandeln; ein getesteter Rückweg muss vorhandene Payloads und
Quittungen unverändert bewahren.

Der Zuordnungsbericht zeigt frische bereits vorhandene Sprach-/Pixel-/Dauer-
belege direkt an der jeweiligen Quelle, ohne selbst einen Belegabruf auszulösen.
GUI-NZB und Einzelquellenprüfung führen jede vorhandene konkrete Auflösung
(`2160p`, `1080p`, `720p`, `576p`, `480p`) mit eigenem Auswahlwert bis zur
Quittung und zum Auftrag. Eine gemeinsame Watch-URL ist kein Auswahlkriterium.
Die bisherigen Mediathekwerte `hd`, `sd`, `low` bleiben unverändert gültig;
die GUI konsumiert denselben serverseitigen Auswahlvertrag für beide Quellen.
Auch ein vorbereiteter Medienbeleg ist keine physische Datei- oder Importabnahme.
Die synthetischen nativen und Desktopgates bleiben Voraussetzung für P17.4/5;
Produktivaktivierung und echte YouTube-Mediendownloads bleiben P17.6.

Der Rückweg dieser Quellenrevision ist der gepinnte v1–v4-fähige P17.3-Stand,
nicht eines der historischen Datenbank-Cutoverimages vor dem Medienprotokoll.
Das isolierte Gate trennt die Protokollkontrolle (gültiges v3-NZB lesend
lieferbar, v5 lesend und bei SAB-Aufnahme abgewiesen) vom Wartungsleser:
Schreibgate aus und kein Bootprocessing. Ein vorbereiteter wartender v5-Auftrag
samt Intentquittung und fünf bereits abgeschlossene synthetische Aufträge
müssen dabei einschließlich IDs, Payloads und Status erhalten bleiben. Der
Rücksprung startet in dieser Prüfung ebenfalls ohne automatischen Transfer;
er ist kein Auftrag zum erneuten Download. Ein produktiver Rückweg benötigt
den getrennten P17.6-Plan und darf keine unbekannten wartenden Verträge durch
einen älteren Worker ausführen lassen.

Das tatsächliche OCI-Image wird zusätzlich offline auf gepinntes yt-dlp,
gebündeltes EJS und ausdrücklich ausgewähltes Node 24 geprüft. Ein absichtlich
nicht unterstützter Input ohne verwendbaren Extraktor prüft die Toolfähigkeit,
keine öffentliche Quelle. Der separate reale Downloadnachweis bleibt P17.6.

Der typisierte Journalvertrag erlaubt höchstens zehn Veröffentlichungsidentitäten
pro YouTube-Eintrag (fünf gemessene Auflösungen, jeweils reguläre/Jahresform).
Der alte MP4-Vertrag bleibt bei sechs. Ein Video erzeugt weiterhin genau einen
Discoveryeintrag und einen Detailprozess; 128 Einträge, 2 MiB, zwei Stunden
Retention und alle globalen RSS-Fenster-/Versuchsgrenzen bleiben unverändert.

Am yt-dlp-Rand bleiben optionale `null`-Werte ausdrücklich unbekannt, etwa
Videodimensionen einer reinen Audiospur. Fehlende oder unbestimmte Codecs
belegen keine Video-/Audiospur; unbenutzte Storyboardformate dürfen gleichzeitig
vorhandene vollständige Medienbelege nicht verdecken. Ein ausgewähltes Format
benötigt weiter konkrete Codecs, passende Pixel oder explizite deutsche
Audiosprache. Sprache, Audio-/Videoformat und Auflösung werden weder aus
Originaltitel noch aus einer lokalisierten Metadatenantwort erfunden.

Die Entwicklungsabnahme von P17.1–P17.5 samt nativen Backend-/Arr-/Rückwegbelegen
steht im [Reviewbericht](proxy-retirement-review.md); der verbindliche Status
und die gesonderten Freigaben für echte Medien und Betrieb stehen in
[P17](../todo/proxy-retirement.md). Synthetische echte Dateien und reale
Metadatenabfragen ersetzen den optionalen echten Referenzdownload nicht.
