# Sonarr-Metadatenvertrag (P06.1)

Stand: 30.09.2026. Technische Referenz, kein zweiter Arbeitsplan.
Abnahmen ausschließlich in [proxy-retirement.md](../todo/proxy-retirement.md).
Sonarr ist optional, standardmäßig aus, zunächst eine Instanz. Keine echte
Bibliothek abgefragt; `sonarr-metadata.test.ts` enthält eigenständig entworfene
synthetische Ressourcen. Netzwerk-, Merge-, Such- und RSS-Consumer sind jetzt
implementiert und werden ausschließlich mit synthetischen Antworten geprüft;
das ist keine Live-Abnahme einer Betreiberinstanz.

## Schreibvarianten im verifizierten Metadatenmerge (P19.1)

Der gemeinsame Episoden-Titelvergleich wird erst innerhalb derselben bestätigten
TVDB-Serie und Staffel-/Folgenkoordinate angewendet. Groß-/Kleinschreibung,
Zeichensetzung, Wortbindestriche, deutsche Zahlwörter von null bis zwanzig und
ein optionaler führender deutscher Artikel dürfen die Schreibweise verändern,
ohne eine andere Episode zu behaupten. Wort-/Zahlgrenzen bleiben erhalten:
„Fall 3-1“ ist nicht „Fall 31“. Beliebige Wortauslassungen, Übersetzungen oder
ein Ähnlichkeitsscore bilden keine Titelequivalenz.

Konkrete Inhalts- und Kalenderkonflikte sperren weiterhin. Katalogtitel,
Sonarr-Metadaten, Quellkoordinaten und Releaseidentität werden nicht umgeschrieben.
Die anschließenden Identitäts-, Laufzeit-, Sprach-, Fassungs- und Qualitätsgates
bleiben nötig. Das ist keine globale Lockerung der Quellen- oder Textsuche.
Keine zusätzlichen Einzelfall-Aliasse oder Katalogfelder für Schreibvarianten.
Abnahme und Betriebsstand stehen ausschließlich im Phasen-TODO/Review.

## API und Herkunft

Primärquelle: [offizielle API-Dokumentation](https://sonarr.tv/docs/api/), geprüft
gegen [OpenAPI](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/Sonarr.Api.V3/openapi.json)
und Controller/Mapper desselben Sonarr-Commits. API v3 gehört zu Sonarr 3/4,
nicht automatisch zu jeder späteren Hauptversion. Eine optionale Integration
prüft per GET `api/v3/system/status` die `version`; vorerst ausschließlich
Major 3/4. Version und tatsächlich vorhandene Felder vor echtem Betrieb
erneut verifizieren. Fehlende/unerwartete Version ist kein erfolgreicher Lookup.

- GET `api/v3/series?tvdbId=N`: Bibliotheksserie zur externen TVDB-ID;
  GET `api/v3/series` für das gecachte RSS-Inventar. Antwort jeweils Array,
  nicht paginiertes `records`-Objekt. `id` ist instanzlokal; `tvdbId` identifiziert
  die Serie. `title` darf keine Identitätsersatzsuche auslösen. Monitoring nur
  bei explizitem `true`. Auch gefilterte Antworten erneut prüfen.
  [SeriesController](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/Sonarr.Api.V3/Series/SeriesController.cs)
- GET `api/v3/episode?seriesId=I`: komplette Episodenliste der zuvor verifizierten
  lokalen Serien-ID. Kein erfundenes `page`/`pageSize`; optionale Staffelabfrage
  erst nach Consumerprüfung verwenden. `seriesId` muss passen;
  `seasonNumber`/`episodeNumber` sind die kanonischen Koordinaten, nicht die
  alternativen Scene-Nummern. Episoden-`tvdbId` ist **keine Serien-ID**.
  Doppelte IDs/Koordinaten oder fremde Serie verwerfen den Ergänzungsbestand.
  [EpisodeController](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/Sonarr.Api.V3/Episodes/EpisodeController.cs)
- `EpisodeResource.runtime` stammt aus dem Episodenmodell; fehlend/0 bleibt
  unbekannt. Serienlaufzeit, Kalender-Endzeit und gemessene Dateilaufzeit sind
  kein Ersatz für die erwartete Einzelepisodenlaufzeit. Minuten werden einmal
  in Sekunden umgerechnet; bestehendes `TvdbEpisode.runtime` behält Minuten.
  [Episode-Mapper](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/Sonarr.Api.V3/Episodes/EpisodeResource.cs),
  [Metadatenmapping](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/NzbDrone.Core/MetadataSource/SkyHook/SkyHookProxy.cs),
  [Sonarr-Laufzeitformatierung](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/frontend/src/Utilities/Number/formatRuntime.ts).
- `airDateUtc` mit gültigem explizitem Offset/Z liefert den Zeitpunkt.
  API-Bruchteile bis sieben Stellen werden im vorhandenen Date-Vertrag auf
  Millisekunden normalisiert; keine Submillisekundenpräzision behaupten.
  `airDate` allein liefert nur einen Kalendertag: nicht still Mitternacht oder
  lokale Zeitzone für das RSS-Fenster einsetzen. Fehlender/ungültiger Zeitpunkt
  schließt diese Episode aus dem Sonarr-RSS aus, nicht aus jeder expliziten Suche.

Der P05-GET-Client erhält Basis-URL samt Unterpfad. Header-Credential ausschließlich
serverseitig, keine Querykeys/Redirects. Statusprüfung und Inventar zählen zum
gemeinsamen Requestbudget. APIantworten/Fehlertexte, Dateipfade und Schlüssel
nicht persistieren oder loggen; nur normalisierte benötigte Metadaten übernehmen.
Ein Sonarr-Key besitzt trotzdem breite Fremdsystemrechte; Pingufunks GET-only
Adapter ist kein Nachweis einer read-only Sonarr-Rolle.

## Lookup, Merge und Matching

Ergänzung vom 05.10.2026: validierte globale `alternateTitles` mit
`seasonNumber=-1` werden als Aliasse unbekannter Sprache übernommen; Staffel-
Titel nicht. Eng begrenzte Umlauttransliteration ermöglicht `ö`/`oe`, ist aber
kein Fuzzy-Alias. Ein frisch gefilterter Serienlookup darf ein im Inventarcache
noch fehlendes Element einmal im selben Budget nachladen. Falsche lokale IDs
bleiben Fehler; echte Nichtfunde werden nicht zehn Minuten negativ gecacht.

Generische Metadatentitel `Episode N`/`Folge N` und genaue Platzhalter
`TBA`/`TBD`/`To be announced`/`To be determined` dürfen bei gesicherter Serie,
explizit übereinstimmenden Quellkoordinaten und belegter positiver Solllaufzeit
zugeordnet werden. Konkrete widersprechende Episodentitel bleiben abgewiesen.
Ein ARTE-Bruchteil `(N/Gesamt)` erhält **keine** pauschale Staffel 1: nur identische
geprüfte Player-ID/-Koordinaten und ein vollständiger, eindeutiger, einzelner
Sonarr-Staffelbestand 1…Gesamt können die Staffel bestimmen. Mehrstaffel- und
unvollständige Bestände bleiben unsicher. HLS-only im Player verwirft die
bereits indexierte MP4-Fassung nicht; Tonsprachenbeleg erst über deren exakte URL.

Basislookup unverändert lokale Shows → TVDB → TMDB, soweit konfiguriert.
Der erste verfügbare konfigurierte API-Anbieter ergänzt die im lokalen Katalog
fehlenden Koordinaten; lokale Serienwerte und vorhandene Episoden behalten
ihren Vorrang. Ein Teilkatalog darf bei deaktiviertem Sonarr keine zuvor vom
API-Anbieter verfügbaren Episoden verdecken. Ohne API-Konfiguration oder bei
Anbieterausfall bleiben die unabhängig belegten lokalen Episoden nutzbar.
Danach optional Sonarr-Ergänzung. Ein früher lokaler Treffer darf diesen Schritt
nicht überspringen. Merge-Schlüssel `(Staffel, Folge)`; vorhandene IDs, Titel,
Daten und Laufzeiten bleiben unverändert. Nur ein konkreter Titelwiderspruch
auf beiden Seiten ist ein Titelkonflikt; TBA wird weder überschrieben noch als
konkreter Gegenbeweis behandelt. Eine Basis-Platzhalterepisode benötigt transient
bestätigte Sonarr-Koordinaten; RSS verwendet dann den tatsächlichen Quelltitel.
Widersprüchliche konkrete Titel/Airdate
sperrt die betreffenden Koordinaten; kein Fuzzy-„Auflösen“. Mehrere Serien zur
TVDB-ID verhindern automatische Ergänzung. Ohne Basisbestand ist ein vollständig
verifizierter Sonarr-Bestand möglich. Ein Fehler lässt unabhängige Bestandstreffer
nutzbar; ausschließlich Sonarr-abhängige Anfragen melden 503 statt Empty-Erfolg.

Metadaten begründen noch keine Medienidentität: exakte Episode, Staffel und RSS
verwenden denselben P06.3-Schlussfilter vor Dedupe/Limit/total. Serienbindung,
belegte Koordinaten/Titel/Jahr und positive endliche Quelllaufzeit nötig.
Keine Query-ID auf einen unbestätigten Suchtreffer schreiben. Vor P09 nur
progressive HTTP(S)-Renditions im Sonarr-Fallback; vorhandene unabhängige HLS-
Pfade bleiben unverändert. Sprach-/Fassungsregeln aus P03 behalten.

## Belegte Katalogergänzung vom 22.10.2026

Der bestehende `data/shows.json`-Katalog ergänzt für `Letzte Spur Berlin`
(TVDB 258535) ausschließlich zwei öffentlich belegte Episoden:

| Episode | Titel                                                                            | Erstausstrahlung | Soll-Laufzeit |
| ------- | -------------------------------------------------------------------------------- | ---------------- | ------------- |
| S07E04  | [Entgleist](https://thetvdb.com/series/letzte-spur-berlin/episodes/6555207)      | 16.03.2018       | 45 Minuten    |
| S07E06  | [Lebensretterin](https://thetvdb.com/series/letzte-spur-berlin/episodes/6555210) | 23.03.2018       | 45 Minuten    |

Dies ist ein partieller Metadatenbestand, keine Behauptung einer vollständigen
Staffel oder Serie. Die übrigen Sonarr-Episoden werden weiterhin über den
bestehenden Merge ergänzt. Dessen Titel, Dateien und lokale IDs werden nicht
verändert; ein Platzhalter `TBA` ist kein konkreter Titelwiderspruch. Die
Soll-Laufzeiten stammen aus den Episodenreferenzen, nicht aus Videolaufzeiten
oder einem Serienmittelwert. Das JSON-Schema akzeptiert das vom Loader bereits
unterstützte optionale Feld `runtime` in Minuten; ohne Wert bleibt die Dauer
unbekannt. Matching, Sprache, Toleranzen und Konfliktpolitik bleiben unverändert.

`shows-catalogue.test.ts` prüft die tatsächliche Katalogdatei über URL-Loader und
Dateifallback bis zu exakter Einzel-/Staffel-Newznab-Ausgabe und GUI-Quellenprüfung mit synthetischem
Sonarr-/Quellnetzwerk und gesperrten Writes. Titelrückbau auf `TBA` verliert die
Zuordnung; fremde Themen/Staffeln, unpassende Dauer und konkrete
anbieterübergreifende Titelkonflikte bleiben abgewiesen. Das ist kein Grab-,
Medien-, Import- oder Gesamtproduktabschluss. Eine installierte gepinnte
`SHOWS_URL` muss gesondert auf die geprüfte Datenrevision aktualisiert werden;
ein Fork-Push ändert weder diesen Pin noch den laufenden Katalogcache.

Das Integrationsreview schützt zusätzlich den Betrieb ohne Sonarr: TVDB- und
TMDB-Bestände außerhalb der zwei Katalogkoordinaten bleiben bis zur exakten
Newznab-Ausgabe erhalten, über URL-Lader und Dateifallback. Der Test scheitert
kausal am früheren sofortigen Rücksprung nach dem lokalen Treffer. Lokale
Korrekturen bleiben unverändert; ein Ausfall beider konfigurierter API-Anbieter
verwirft die unabhängig belegten Katalogepisoden nicht.

## Belegte Katalogergänzung vom 30.10.2026

`data/shows.json` verknüpft TVDB **481445** (`Forgotten – Vanished in the Moor`)
mit `Das Vergessen – Spurlos im Moor`, einschließlich der Schreibweise mit
einfachem Bindestrich. Die [ARD-Staffelübersicht](https://www.ardmediathek.de/serie/das-vergessen-spurlos-im-moor/staffel-1/Y3JpZDovL2Rhc2Vyc3RlLmRlL2Rhcy12ZXJnZXNzZW4tc3B1cmxvcy1pbS1tb29y/1)
belegt die sechs Titel und die in Minuten angegebenen Episodenlaufzeiten:

| Episode | Titel        | Laufzeit   |
| ------- | ------------ | ---------- |
| S01E01  | Vermisst     | 44 Minuten |
| S01E02  | Versunken    | 45 Minuten |
| S01E03  | Verborgen    | 46 Minuten |
| S01E04  | Verraten     | 46 Minuten |
| S01E05  | Verschwunden | 45 Minuten |
| S01E06  | Verloren     | 45 Minuten |

Die Katalogtage beziehen sich auf die [Ausstrahlung im Ersten](https://tivolifilm.tv/das-vergessen-spurlos-im-moor-feiert-tv-premiere-in-orf-1-und-im-ersten/):
24.10.2026 für Folgen 1–4, 25.10.2026 für Folgen 5–6. Das sind weder die frühere
ORF-Premiere noch die Mediathek-Verfügbarkeit. Der englische Serienname bleibt
erhalten; Sonarr-Platzhalter `TBA` überschreiben keine belegten Katalogtitel.

Der isolierte Katalogtest prüft URL-Lader und Dateifallback, tatsächlich deutsche
Suchbegriffe, alle sechs exakten Newznab-/NZB-Zuordnungen und die Staffelantwort.
Ohne deutsche Serienidentität oder konkrete Episodentitel scheitert dieselbe
Zuordnung; fremde Themen/Staffeln/Titel, unpassende Dauer und Audiodeskription
bleiben gesperrt. Medien und Sonarr-Antworten sind synthetisch, Writes gesperrt.
Katalogtitel liefern keinen Tonsprachenbeleg. Kein produktiver Katalogwechsel,
Grab oder Dateiimport wird durch diese Entwicklungsprüfung behauptet.

## Dauer und begrenztes RSS

Die genehmigten technischen Startwerte stehen im TODO; keine Sonarr-Zusagen:

- Quelllaufzeit und Sollprüfung in Sekunden. Bestehende Mindestdauer (Default
  300 s) erhalten. Bei belegter Episodenlaufzeit E > 0 zusätzlich
  `[E − Δ, E + Δ]`, mit `Δ = min(0,25 E, max(5 s, p E / 100))` prüfen.
  p: 0–25 %, Default 10 %; p=0 setzt Δ=0. Nur im identitätsgesicherten Fallback
  Mindestdauer auf `min(Mindestdauer, E − Δ)` reduzieren. Bei E=120 s/p=10
  gilt 108–132 s inklusive Grenzen. Ohne E bleibt die Sollprüfung unbekannt;
  eine Mindestdauerprüfung darf nicht als bestätigte Sollprüfung erscheinen.
- RSS nur überwachte Serien, UTC-Fenster `[jetzt − 14 Tage, jetzt]`, einstellbar
  1–90 Tage. Snapshot: maximal fünf Serien, 50 Episoden, zehn zusätzliche
  HTTP-Versuche **einschließlich Retries und Status/Inventar** und 15 s gesamte
  Deadline. Antwortbody lesen/parsen zählt zur Deadline. `HttpRequestBudget`
  zählt Status/Inventar/Episoden, Mediathek-Seiten und deren Retries gemeinsam.
  Gemischte Basissuchen zählen auch SRF-Authentifizierung/-Suche im selben Scope;
  vorhandene HLS-Basistreffer bleiben erhalten. Rein ergänzende Suchläufe sind
  vor P09 progressive-only und fragen die HLS-only-SRF-Quelle deshalb nicht ab.
- APIarrays sind ungepaginiert: lokal gefilterte Episoden begrenzen, keine
  Serverpagination vortäuschen. Parsercaps 5.000 Serien/20.000 Episoden sind
  technische Schutzgrenzen, keine Bibliothekssuche oder API-Limits. Der gemeinsame
  JSON-Reader begrenzt Arr-Antworten auf 5 MiB, Mediathek auf weiterhin 8 MiB und
  beide auf 8.192 nichtleere Chunks; prüft UTF-8 strikt und verwirft Überschreitung/
  Deadlinefehler. Diese Transportcaps sind keine fremden API-Zusagen.
  Überschreitung/Abbruch darf keinen Teilsnapshot liefern.
- Rotierender deterministischer Cursor über überwachte Serien, erst nach
  erfolgreichem Snapshot fortsetzen. Pagination liest denselben Snapshot;
  `total` ist dessen gefilterte Menge. TTL Metadaten zehn Minuten, RSS 60 s.
  Ein kalter RSS-Snapshot reserviert nach Status/Inventar je zwei Versuche für
  Episoden-/Quelllookup und wählt damit höchstens vier Serien; mit warmen
  Metadaten höchstens fünf. Zusätzliche Seiten/Retry können einen ganzen
  Snapshot scheitern lassen, aber niemals das Budget erweitern. Der Cursor
  verschiebt sich nur um tatsächlich erfolgreich untersuchte Serien.
  RSS vergleicht vorhandene lokale oder frisch im Basislookup gecachte
  Metadaten; ohne diese liest es die lokale Shows-Datei. Es startet dafür
  keine zusätzlichen TVDB-/TMDB-/Full-Library-Netzwerkabfragen.
  Änderung von Fenster/Budget/Instanz/Secret invalidiert Cache und inFlight-
  Epoche; spät eintreffende alte Antworten dürfen nicht die neue Epoche füllen.

Explizite TV-Suchen teilen seit der gesonderten Nutzerfreigabe vom 05.10.2026
maximal **32** Versuche für Sonarr, Quellen, Folgeseiten und Sprachbelege; dieselbe
15-Sekunden-Deadline. RSS bleibt beim Zehn-Versuche-Budget. Tonsprachenauswahl
folgt der Belegprüfung, vor Dedupe/Limit/total; unbekannte Belege werden nicht
zu Deutsch. Weitere Beleg-/Workergrenzen im [Tonsprachenvertrag](source-audio-contract.md).

Seit 06.10.2026 verbreitern bis zu sechs alternative Namens-/Regel-Themenabfragen
die explizite Suche; RSS nutzt dafür nur frei bleibendes Budget. Keine Erweiterung
der Deadline, keine Suchwörter als Identitätsbeweis, keine Vorabfolge im bisherigen
RSS-Datumsfenster. Details und Konfliktgrenzen im [TV-Suchvertrag](tv-search-contract.md).

## Review und verbleibende Abnahme

Upstream am 30.09.2026 erneut geprüft: `1b41ebbe6c1d988cc981675a1dd90a0e038e8400`
verbessert TVDB-/Rulesetsuche und Settingsinitialisierung, liefert aber keinen
Sonarr-Metadatenadapter. Nicht ungeprüft mergen; dessen Änderungen überlappen
bereits bearbeitete Fork-Owner.

Selbstreview trennt Serien-/Episoden-/Instanz-ID, Minuten/Sekunden, Punkt/Tag,
Metadaten/Medienbeweis, Array/Seitenvertrag und Entwicklungs-/Betriebsabnahme.
P06.1 behauptet weder fertig integrierte Suche noch Liveversionsnachweis.
P06.2/P06.3 sind nach Consumerreview, Desktopprüfung und erfolgreicher Fork-CI
im TODO abgenommen. Produktive Instanz- und Versionsprüfung bleibt separat.
Implemented: Default-off, External-Secret, zehnminütiger bounded Metadatencache,
Coalescing mit jeweils eigener Caller-Deadline, epochengerechte Invalidierung,
nicht überschreibender Merge und Konfliktmarker. Legacy-Rulesetmatching erhält
ausschließlich Basisepisoden, niemals neue Sonarr-Episoden für Fuzzy-Matching.
Exact/Staffel/RSS nutzen denselben Schlussfilter für positive endliche Dauer,
Serienbindung, Titel/Jahr/Koordinaten und Fassungsregeln. Vor P09 nur HTTP(S)-URLs
mit Dateiendung mp4/m4v/mkv/webm/mov, ohne Userinfo; HLS/DASH/Seitenreferenzen
werden nicht als progressive Medien ausgegeben. Das ist Quellevidenz, kein
vorweggenommener Inhaltsnachweis. Abweichungen muss P09 vor completed erkennen.
Unabhängig belegte Basis-Suche/RSS bleiben bei Sonarr-Ausfall verwendbar;
unbelegbare Sonarr-only-Anfragen melden 503 ohne erfolgreich leeren Cache.

Die persistierten Controls liegen unter `/settings` → Matching; Schlüssel nur
aus `PINGUFUNK_SONARR_API_KEY` oder dessen `_FILE`, nie Browser-Write.
Desktopprüfung: tatsächliches Dev-Bundle auf einer isolierten Loopbackinstanz
mit neuem SQLite-Testbestand, Matching vorher/nachher visuell geprüft. Ungültige
91 Tage sperren Speichern mit Erklärung; URL/30 Tage/0 %/Aktivierung gespeichert,
nach Reload und per API identisch. Browser-Konsole ohne Warnungen/Fehler;
Screenshots im Browser geprüft, nicht öffentlich persistiert. Keine echte
Sonarr-Abfrage, kein Download und keine produktiven Daten berührt.
