# Sonarr-Metadatenvertrag (P06.1)

Stand: 30.09.2026. Technische Referenz, kein zweiter Arbeitsplan.
Abnahmen ausschließlich in [proxy-retirement.md](../todo/proxy-retirement.md).
Sonarr ist optional, standardmäßig aus, zunächst eine Instanz. Keine echte
Bibliothek abgefragt; `sonarr-metadata.test.ts` enthält eigenständig entworfene
synthetische Ressourcen. Netzwerk-, Merge-, Such- und RSS-Consumer sind jetzt
implementiert und werden ausschließlich mit synthetischen Antworten geprüft;
das ist keine Live-Abnahme einer Betreiberinstanz.

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

Basislookup unverändert lokale Shows → TVDB → TMDB, soweit konfiguriert.
Danach optional Sonarr-Ergänzung. Ein früher lokaler Treffer darf diesen Schritt
nicht überspringen. Merge-Schlüssel `(Staffel, Folge)`; vorhandene IDs, Titel,
Daten und Laufzeiten bleiben unverändert. Widersprüchlicher Titel/Airdate
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

## Review und verbleibende Abnahme

Upstream am 30.09.2026 erneut geprüft: `1b41ebbe6c1d988cc981675a1dd90a0e038e8400`
verbessert TVDB-/Rulesetsuche und Settingsinitialisierung, liefert aber keinen
Sonarr-Metadatenadapter. Nicht ungeprüft mergen; dessen Änderungen überlappen
bereits bearbeitete Fork-Owner.

Selbstreview trennt Serien-/Episoden-/Instanz-ID, Minuten/Sekunden, Punkt/Tag,
Metadaten/Medienbeweis, Array/Seitenvertrag und Entwicklungs-/Betriebsabnahme.
P06.1 behauptet weder fertig integrierte Suche noch Liveversionsnachweis.
P06.2/P06.3 bleiben bis zur finalen Entwicklungsabnahme im TODO offen.
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
