# Pingufunk: vollständige Ablösung des Kompatibilitätsproxys

Stand: 28.09.2026. **Analyse und Planung, keine Funktionsänderung oder
Bereitstellung.** Dieses Dokument ersetzt den bisherigen groben Projektplan.
Der anschließende [Reviewbericht](proxy-retirement-review.md) dokumentiert
Befunde, Korrekturen und verbleibende Unsicherheiten.

## Ergebnis und Reihenfolge

Die Funktionen des Proxys lassen sich überwiegend in bestehende Pingufunk-
Komponenten integrieren. Ein zweiter HTTP/XML-Adapter in der Anwendung ist
nicht die Zielarchitektur. Noch ist **keine vollständige Funktionsparität**
nachgewiesen; grüner Bestandstest und ein funktionierender Tatort-Suchfall
reichen dafür nicht aus.

Zuerst kleine, wirksame Korrekturen: explizite ARTE-Staffeln, exakte Episoden-
antworten und korrekte Sprachkennzeichnung. Danach die Import-Isolation als
zwingendes Sicherheitsgate. Sonarr-Metadaten haben sehr hohen Nutzen, sind
wegen Konfiguration, Secrets und Cache aber kein trivialer Ein-Datei-Fix.
Filmmatching und allgemeine ARTE-Zuordnung benötigen mehr Arbeit. Die
vollständige Ablösung umfasst **Indexer und Downloadclient**, nicht nur Suche.

## Prüfgrundlage und Grenzen

- Fork: [superions/pingufunk](https://github.com/superions/pingufunk).
- Upstream main frisch abgerufen: a3b02a6e6ad827d6483700480b9bfbcc59a5823c.
  Versionsangabe 1.3.0, Node.js mindestens 24, MIT.
- Pingufunk-Ausgangspunkt: 97b22298ff21c43b9dbe451f3300fdd66ca5f277;
  Planung auf codex/proxy-retirement-analysis, main bleibt unverändert.
- Der ältere lokale Homelab-Checkout war nicht aktuell. Analysiert wurde deshalb
  ein separater, unveränderter Checkout des aktuellen Homelab-Git-Stands
  06205adb50ebbb45926d719fc8b83aaf396a6f33.
- Proxy: stacks/media/rundfunkarr-proxy.mjs, 1.388 Zeilen, Git-Blob
  53dd65749250e042da8fdc6590093e7cea97ba42; SHA-256
  b890a93fe6634df55d32c6fd05df94fa83863b97da0f4edddafca358d844bafa.
- Vollständige Proxy-Datei, Testdatei, relevanter Stack und README geprüft.
  GitOps-Sollstand bindet Proxy-Konfiguration v18 ein. **Keine neue Live-Prüfung
  des tatsächlich gestarteten Swarm-Tasks**, keine Bibliotheksabfrage.
- Private Quelltexte, Konfigurationen und reale Bibliotheksdaten werden nicht
  ins öffentliche Fork-Repository kopiert. Hier stehen nur abstrahierte
  Befunde, Funktionsnamen und reproduktionsgeeignete synthetische Fälle.
- Alle 34 Proxy-Tests und 171 Pingufunk-Tests erfolgreich. Sieben zusätzliche,
  isolierte Charakterisierungsprüfungen ohne Netzwerk/DB erfolgreich:
  sechs zeigen bestehendes Fehlverhalten, eine bestätigt den vorhandenen
  TVDB-ID-Episodenfilter. Diese temporären Audit-Prüfungen sind **keine**
  implementierten Fixes oder dauerhafte Abnahmesuite.

Belege im Fork beziehen sich auf den genannten Ausgangsstand. Vor jedem Paket
Upstream erneut prüfen; ein späterer Fix kann Umfang und Priorität reduzieren.

## Vollständiges Funktionsinventar und Übernahmeentscheidung

B = Laufzeitfunktion bzw. Vertrag, O = Betriebsrandbedingung.

| ID  | Proxy-Verhalten / Einstieg                                                                                                      | Stand in Pingufunk                                                                                                          | Entscheidung und Paket                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| B01 | formatReleaseBase, correctedItemTitle; RSS-Titel und encodedTitle synchron korrigieren                                          | Zentrale RSS-Erzeugung vorhanden; TV-/Movie-/Generic-Pfade liefern unterschiedliche Identitäten                             | Native gemeinsame Release-Identität statt XML-Rewrite; P02, P04, P08                                            |
| B02 | filterRequestedEpisodeItems; season + ep/episode, Mehrfachfolgen                                                                | ID-Pfad filtert bereits; Textpfad nimmt ep überhaupt nicht entgegen, Route liest nur ep                                     | Fehlende Pfade schließen, vorhandenen Filter erhalten; P02                                                      |
| B03 | arteEpisodeCoordinates; Staffel/Season/Saison/Temporada/Stagione vor falschem S01                                               | Generic-Parser kennt Staffel N Folge N, aber nicht Staffel N (E/Gesamt); sonst Staffel 1                                    | Explizite Koordinaten im strukturierten Parser; P01                                                             |
| B04 | buildArteFallback, buildEpisodeFallbackTarget; breite Suchwiederholung bei leerer Staffelsuche                                  | Textsuche verlangt literal Sxx im Quelltitel; ARTE-Titel können das nicht erfüllen                                          | Gezielte Kandidatensuche, danach Identitäts- und Koordinatenfilter; P02, P07                                    |
| B05 | isGermanArteItem, matchingArteVideoCoordinates, buildDirectArteFallback; dieselbe Video-ID in deutscher Quelle finden           | GERMAN wird ohne Sprachprüfung angehängt; kein entsprechender Locale-/Variantenausgleich gefunden                           | Sprachstatus vor RSS bilden, deutsche Variante über Quellidentität auflösen; P03, P07                           |
| B06 | directArteFallbackQueries; All-the-Sins-Allowlist gegen Occupied-Topic-Regel                                                    | Regel 109 bindet generisches ARTE-Topic an TVDB 299964; Auto-Regeln haben ein global eindeutiges Topic                      | Identitätsgesicherte Regeln und allgemeiner Titelpfad; keine Dauer-Allowlist; P07                               |
| B07 | filterForeignLanguageGuidDuplicates; fremdsprachigen GUID-Zwilling entfernen                                                    | GUID aus Website + Qualität; unterschiedliche Fassungen können kollidieren                                                  | Sprachauswahl und stabile Fassungsidentität vor Pagination; P03                                                 |
| B08 | fetchSonarrEpisodeMetadata; vorhandene lokale Metadaten, Secret-Datei, 10-Minuten-Cache                                         | shows.ts bietet shows.json, TVDB und TMDB, keinen Sonarr-Anbieter                                                           | Optionaler Metadatenanbieter, ohne externes Konto; P06                                                          |
| B09 | sonarrEpisodeTitleCandidates, isSafeSonarrEpisodeItem; Volltitel/letztes Segment, Topicbindung, Jahr/Serienpräfix, Mindestdauer | Kein äquivalenter accountfreier Fallback; Regeln vorausgesetzt                                                              | Eindeutiger Titelabgleich auf Anforderungsidentität, Laufzeit-/Variantenprüfung; P06                            |
| B10 | isDirectSonarrMediaUrl; HTTP(S), im Sonarr-Fallback HLS gesperrt                                                                | HLS unterstützt und optional; TV-Skip prüft nur Standard-URL, RSS kann weitere URLs ausgeben                                | Pro Rendition prüfen; vorhandenen HLS-Fix behalten; Sperre erst nach P09-Abnahme lockern; P01, P09              |
| B11 | movieMetadataContext, fetchRadarrMovieMetadata; deutsche Titel/Jahr via öffentlichem Radarr-Metadatendienst, 6h-Cache           | ID-Suche via TMDB; Textsuche findet optional TMDB, validiert damit aber nicht die ausgegebenen Kandidaten                   | Accountfreien bestehenden Weg optional integrieren; lokale Radarr-API ist Alternative, keine Voraussetzung; P08 |
| B12 | movieFallbackSearchTerms; markante Wörter und begrenzte Umlautvarianten                                                         | Primär vollständiger Suchstring                                                                                             | Gemeinsame begrenzte Kandidatensuche, exakte Schlussprüfung; P08                                                |
| B13 | buildDirectMovieFallback, isSafeDirectMovieItem; GET mit Filmkategorie nutzt immer direkten Pfad, sonst leere Antwort           | Textpfad liefert alle Ergebnisse oberhalb Mindestdauer, benennt Topic + Ausstrahlungsjahr; ID-Matcher erlaubt fuzzy/partial | Sicherer Film-Suchvertrag und kanonische Metadaten; P08                                                         |
| B14 | extractNzbReleaseName, privateDownloadDirectory, scopeDownloadRequest; eigener Ordner pro Job                                   | Kategorieordner für alle Jobs; Tempdatei ebenfalls nur nach Release-Titel                                                   | Native Isolation in Temp und Complete, parsbarer Name + Job-ID; P04                                             |
| B15 | rewriteDownloadApiResponse; öffentliche cat/category erhalten, storage job-spezifisch lassen                                    | Kategorie wird unverändert zurückgegeben; storage ist dirname(filePath)                                                     | Kategorie und Speicherlayout entkoppeln, Legacy-Einträge erhalten; P04                                          |
| B16 | HTTP-Weiterleitung, Hop-by-Hop-Header, Response-Länge, /healthz                                                                 | Direkte Next-Routen; /api/newznab/api bereits Alias                                                                         | Transport entfällt, funktionale Health-/Endpoint-/Fehlerverträge prüfen; P05, P10                               |
| O01 | SQLite/NFS, connection_limit und socket_timeout im Stack, nicht im Proxy-Code                                                   | Prisma weiterhin SQLite                                                                                                     | Betriebsanforderung separat validieren; keine vorschnelle PostgreSQL-Migration; P05, P10                        |
| O02 | Indexer-/SAB-URLs, relative NZB-URLs, Remote Path Mapping, Kategorien und Secrets                                               | Direkte Endpunkte vorhanden, Integration noch nicht geprüft                                                                 | Beide Verbraucherpfade und GitOps-Umschaltung abnehmen; P10                                                     |

### Was bereits vorhanden ist und nicht dupliziert werden soll

- getDesiredEpisodes/applyDesiredEpisodeFilter in mediathek.ts funktionieren im
  TVDB-ID-Pfad; isoliert mit zwei Folgen gegen die gewünschte Folge bestätigt.
- [Upstream PR #40](https://github.com/rundfunkarr/rundfunkarr/pull/40) ist im
  aktuellen Stand enthalten: HLS-Video/Audio getrennt laden, muxen und Temp-
  sidecars aufräumen. Das ist nicht automatisch die Lösung für jedes frühere
  Sample-Problem, macht eine permanente pauschale HLS-Sperre aber unnötig.
- SAB-Zeitformat, Transfer-Stall-Timeout, Wiederanlage gelöschter Kategorie-
  ordner, Base64-NZB-Kommentare, konfigurierbare Mindestdauer, Quality-Auswahl
  und gemeinsamer Content-Client existieren bereits. Erhalten und gezielt testen.
- Remote Path Mapping bleibt Konfiguration. Es ersetzt keine Job-Isolation.
- Kategorien-/Validierungsantworten besitzen Tests. Nicht durch einen neuen
  Proxy-Health-200-Test als vollständig abgenommen deklarieren.

## Priorisierung: klein und wirksam, dann vollständige Parität

Aufwand ist relativ inkl. Regressionstests, kein Zeitversprechen:
K = lokal begrenzt, M = mehrere Komponenten, G = Integrations-/Architekturpaket.
Paketgrößen bei der Umsetzung in kleine PRs aufteilen. Hoher Nutzen bedeutet
nicht automatisch, dass ein Paket ohne seine Sicherheitsabhängigkeiten startet.

| Umsetzung | Paket                                                         | Aufwand | Mehrwert                                                           | Abhängigkeit / Gate                                                            |
| --------- | ------------------------------------------------------------- | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 0         | P00: dauerhafte Regressionen und Fork-Test-CI                 | K–M     | Sehr hoch: belegbarer Fortschritt                                  | Nur Test-CI, keine Image-Publikation; Runner prüfen                            |
| 1         | P01: explizite ARTE-Staffel + URL-Rendition-Prüfung           | K       | Hoch: richtige Staffel, progressive Alternativen nicht verlieren   | Bestehende Parser-/RSS-Tests; unklare Staffel nicht erfinden                   |
| 2         | P02: exakte TV-Antworten und konsistente Release-Identität    | K–M     | Sehr hoch: keine fremden Episoden/unnötigen Feed-Mengen            | P01; Serienidentität vor breit geöffneten Suchpfaden                           |
| 3         | P03: ehrliche Sprache und sichere GUID-Deduplikation          | M       | Sehr hoch: falsche Sprache verhindern                              | Sprache vor Titelbereinigung und vor Pagination                                |
| 4         | P04: Job-Isolation und SAB-Kategorievertrag                   | M       | Sehr hoch: Import-/Überschreibungsfehler verhindern                | Pflicht vor Download-/Import-Abnahme; keine DB-Migration zwingend voraussetzen |
| 5         | P05: Fehler-/Cache-/Betriebsverträge, Secret-Grundlage        | M       | Hoch: robuste Integration, kein Credential-Leak                    | Pflichtgrundlage für neue API-Anbieter                                         |
| 6         | P06: optionale Sonarr-Metadaten + sichere Titelsuche          | M       | Sehr hoch: Tatort und fehlende lokale Metadaten ohne neue Accounts | P02, P03, P05                                                                  |
| 7         | P07: allgemeine ARTE-Zuordnung/Varianten statt Allowlist      | M–G     | Hoch: ganze Seriengruppe statt Einzelfix                           | P01–P03, P05; ggf. P06 für Metadaten                                           |
| 8         | P08: accountfreie Film-Metadaten und sicherer Radarr-Suchpfad | M–G     | Sehr hoch: Filme überhaupt zuverlässig finden/zuordnen             | P03, P05; P04 für vollständigen Import                                         |
| 9         | P09: vollständige Medienprüfung und HLS-Freigabe              | M–G     | Hoch: keine Samples/stummen Dateien als completed                  | P04, erwartete Identitäts-/Laufzeitinformationen aus P06/P08                   |
| 10        | P10: isolierte Gesamtparität, kontrollierte Ablösung          | G       | Zielerreichung                                                     | Alle B-/O-Zeilen mit Nachweis schließen; separate Deployment-Freigabe          |

P01 und der begrenzte P02-Fix liefern am schnellsten Nutzen. P03 bleibt
Sicherheitspriorität, ist aber keine bloße Regex-Liste. Bei der Umsetzung
unabhängige Teiländerungen früh reviewen; den Proxy erst nach P10 entfernen.

## Konkrete Umsetzungspakete und Abnahmekriterien

### P00 — Regressionen und verlässliche Testbasis

Zielorte: vorhandene \*.test.ts, neue shows-/rulesets-/SAB-Route-Tests und
.github/workflows/ci.yml. Fork-Testworkflow auf tatsächlich verfügbare Runner
anpassen; kein pauschales Aktivieren der upstream Container-/Schedule-Workflows.

Die 34 Proxy-Tests sind Fallinventar, keine Lizenz zum Kopieren des privaten
Adapters. Synthetische Fixtures mit gleichen Verträgen schreiben. Zusätzlich
HTTP-Orchestrierung, API-Fehler, Pagination, Cache und Dateisystem testen:
Die Proxy-Suite prüft überwiegend reine Hilfsfunktionen, nicht die ganze Kette.

**Abnahme:** Jeder Inventareintrag hat einen Testbesitzer und einen messbaren
Sollzustand; keine realen Grabs, Netzwerkzugriffe oder Produktions-DBs.
Charakterisierung des Fehlers von einer später invertierten Regression trennen.
Bestand: 171 Tests grün; keine Garantie für noch ungetestete Proxy-Funktionen.

### P01 — Koordinaten und einzelne Quellrenditions

Zielorte: newznab.ts, stream-url.ts, mediathek.ts; Parser in ein gemeinsames
Modul extrahieren, wenn sonst zweite Implementierungen entstünden.

Explizite Staffel N (E/Gesamt), inklusive der im Proxy verwendeten lokalisierten
Staffelbezeichnungen erkennen. Numerische, Jahres- und bestehende daily-
Formate erhalten. Ein (E/Gesamt)-Fragment allein belegt keine Staffel:
bisheriges S01-Default als Kompatibilitätsentscheidung behandeln, nicht als
gesicherte ARTE-Identität. Für automatisches Matching eindeutige Quelle verlangen.
Pro Qualität HTTP(S), Streamtyp und Aktivierung prüfen, nicht nur url_video.

**Abnahme:** Staffel 2 liefert S02, Attribute und decoded encodedTitle stimmen
überein; Jahr >99 und Mehrfachfolgen ungekürzt; fehlende/missverständliche
Koordinaten fail closed. Standard-HLS + progressive-HD liefert bei HLS=false
nur die zulässige HD-Rendition. Nicht-ARTE-Verhalten bleibt kompatibel.

### P02 — Suchvertrag vor RSS/Pagination

Zielorte: app/api/newznab/route.ts, mediathek.ts, newznab.ts, types/index.ts.
Route und Service führen einen strukturierten Suchkontext mit q, TVDB-ID,
Staffel, Episode und ggf. daily-Datum. ep ist Standard, episode kompatibler Alias;
widersprüchliche Angaben ablehnen. ID-Kriterien nicht bei Fallbacks vergessen.

Bei Textsuche ep durchreichen und im Cache-Key berücksichtigen. Enge Suche darf
breitere Kandidatensuche auslösen, aber erst nach Serienbindung und Koordinaten-
prüfung veröffentlichen. Der literal Sxx-Queryfilter kann nicht allgemein für
ARTE/Jahresstaffeln erzwungen werden. Filterung und Deduplikation passieren
**vor** limit/offset; total bezeichnet die gesamte gefilterte Ergebnismenge.
Quelllimits sind davon getrennt: Falls die Kandidatenmenge begrenzt ist,
darf total keine Vollständigkeit des gesamten Quellkatalogs versprechen.

**Abnahme:** S07E13 nicht E12/E130/S08E13; S07E12E13 für beide enthaltenen Folgen;
Staffelsuche ohne ep vollständig; unbekannte Titel nicht als angefragte Serie
umbenennen; ID-Pfad weiterhin exakt. Bestehende daily-Formate und Sonderfolgen
separat testen. RSS-Titel, NZB-Identität und Downloadtitel identisch.

### P03 — Sprache, Varianten und Downloadidentität

Zielorte: content-search.ts, mediathek.ts, newznab.ts, types/index.ts,
server/ffmpeg.ts. Variantsprache vor dem Entfernen von Titelsuffixen erfassen.
ARTE.DE plus korrekter Host/de-Locale ist Evidenz, **kein Audio-Beweis**:
Originalfassung mit deutschen Untertiteln bleibt Originalfassung.

Minimal sichere Erständerung: explizit fremdsprachige Titel nie als GERMAN
ausgeben; bei gleicher Quellidentität nachgewiesene deutsche Hauptfassung
bevorzugen. Unbekannt darf nicht stillschweigend Deutsch werden. Qualität,
Sprache/Fassung und Quelle berücksichtigen; gleiches Website-Linkfragment
allein ist keine vollständige Downloadidentität. GUIDs stabil halten, aber
unterschiedliche Fassungen nicht kollidieren lassen.

**Abnahme:** Foreign-first/Deutsch-first ergeben dieselbe sichere Auswahl;
ungepaarte OV nicht deutsch relabeln; 1080/720 bleiben getrennt; AD, Gebärden,
klare Sprache und Untertitel anhand konfigurierbarer Fassungsregeln behandeln.
Sprachmarker und Container-Metadaten stimmen: convertMp4ToMkv setzt derzeit
language=ger blind und muss im Spracharbeitspaket mit berücksichtigt werden.
GUID-Wechsel und erneute RSS-Funde als Umstellungsrisiko dokumentieren.
Auch die frühe Map-Deduplikation nach url_video und das abschließende slice
in content-search.ts prüfen: dort verlorene Fassungen lassen sich im RSS-
Generator nicht wiederherstellen. Quellseitige Limits mit begrenztem Paging
oder einem dokumentierten Kandidatenbudget berücksichtigen.

### P04 — Eigene Job-Verzeichnisse, stabile öffentliche Kategorien

Zielorte: services/download.ts, server/download-manager.ts, SAB-Routen und
Dateisystemtests. Öffentliche Kategorie von internen Verzeichnissen entkoppeln.
Job-ID bereits vorhanden: defaultmäßig ohne Schemaänderung ableitbare
Release-Name-plus-ID-Unterordner nutzen; alle Temp-/Konvertierungsdateien
ebenfalls job-spezifisch. Kategorien nicht als beliebigen relativen Pfad nutzen.

**Abnahme:** Zwei gleiche Release-Titel gleichzeitig überschreiben weder Temp-
noch Zieldateien; auch EXDEV-Move, Import während weiterer Downloads und Retry
testen. Queue cat und History category bleiben öffentlich, storage zeigt genau
den Job-Ordner; Sonarr/Radarr-Prefixmapping funktioniert. Path Traversal, absolute
Pfade, Länge/Unicode und vorhandene symlink-Ausbruchspfade abweisen.
Legacy-Proxy-Kategorien samt bestehender History dürfen weiter lesbar sein.
Bei neuem Layout keine produktiven Dateien verschieben oder Kategorien
nachträglich umschreiben. Delete/Retry dürfen nur den jeweiligen Job betreffen;
gemappter Berichtspfad ist nicht automatisch der reale lokale Löschpfad.

### P05 — Robuste Grundlagen statt Proxy-Fehlermuster

Zielorte: mediathek-client.ts, fetch-retry.ts, cache.ts, settings-redaction.ts,
app/api/settings/route.ts und API-/Queue-Tests.

- Ein gemeinsames Request-Zeitbudget inkl. Retry, Responsegrößen und Abbruch;
  die Serie der Movie-Term-Anfragen nicht zu minutenlangen Suchen machen.
- Providerfehler, ungültiges Schema und echte leere Treffer unterscheiden;
  kein Ausfall als erfolgreiche leere Suchantwort lang cachen.
- Cache-Key umfasst Anbieter/Instanz/Identität, Suchkontext, Sprache, Qualität,
  HLS/Matching-Einstellungen. Konfigurations-/Secretwechsel invalidieren passende
  Metadaten- und Suchcaches. TTL begrenzen, LRU und Request-Coalescing verwenden.
- Neue Sonarr-/Radarr-Schlüssel serverseitig über Secret-Datei bzw. ignorierte
  Umgebung; kein Schlüssel in URL, Logs, Browserantworten oder Testfixtures.
  settings-redaction.ts maskiert derzeit nur SRF-Credentials, nicht beliebige
  Config-Einträge. Neue Credentials nicht einfach in Config ablegen und ausgeben.
- Sonarr-Key hat technisch weitere Rechte: unser Adapter nutzt ausschließlich
  GET-Metadaten-Endpunkte; keine angeblich read-only privilegierte Rolle behaupten.
  Base-URL-Unterpfade, Redirects und Auth-Headerverlust/-weitergabe testen.
- SQLite/NFS-Workaround als bestehende Betriebsbedingung behandeln.
  Queue-Stress, restart/retry und verlorene Verarbeitung separat prüfen.
  Ein DB-Poolparameter heilt nicht alle Queue-/Dateisystem-Races.

**Abnahme:** 401/403 ohne sinnlose Retry; 429/5xx mit Budget; Timeout/defektes JSON
klar diagnostizierbar; keine Credential-Ausgabe. Cache-Ausfalltests und
Konfigurationsänderungen durchlaufen. Kein unnötiger live DB- oder Secret-Zugriff.

### P06 — Sonarr-Metadaten und Titelabgleich

Zielorte: shows.ts, neues services/sonarr-metadata.ts, mediathek.ts,
Konfigurations-/Mocktests. Metadatenanbieter von Content-Providern trennen.

Optional und standardmäßig deaktiviert. Bestehende shows.json/TVDB/TMDB-Wege
bleiben. Der Provider darf bei fehlender **gewünschter Episode** ergänzen:
nur bei fehlender ganzen Serie zu greifen lässt veraltete lokale Metadaten
weiter blockieren. Vorrang/Refresh dokumentieren, Quellen nicht blind mischen.

GET /api/v3/series und /api/v3/episode?seriesId=... über konfigurierten
URL-Unterpfad. TVDB-ID und reale Staffel/Folge prüfen, Konflikte verschiedener
Instanzen ablehnen; v1 darf ausdrücklich eine Instanz unterstützen, muss aber
entsprechend instanzbezogene Cache-Keys haben. Der lokale API-Key ist nötig,
ein zusätzliches persönliches TVDB-/TMDB-Konto nicht.

**Abnahme:** synthetischer Tatort-Jahresstaffelfall ohne externe Tokens; Volltitel
und letzter Titelteil nur bei gesicherter Serienbindung; bekannte Jahres- und
Serienpräfixe erlaubt, Trailer/AD/klare Sprache nicht. Fehlende/NaN-Laufzeit
ablehnen; 20 Minuten sind bisherige Proxy-Heuristik, künftig serien-/runtime-
bezogen konfigurierbar, damit Kurzserien nicht global verloren gehen.
Serien-/Episodenabweichung, leeres Secret, Rotation, Base-URL und negative Cache-
Antworten testen. Staffel-/RSS-Sync ergänzen, wenn sie zum Abnahmescope gehören;
der bisherige Proxy unterstützt hier nur exakte ID+Staffel+Episode-Fallbacks.

### P07 — ARTE ohne titelbezogene Ausnahmen

Zielorte: rulesets.ts, ruleset-generator.ts, data/rulesets.json, mediathek.ts,
ggf. prisma/schema.prisma. Zuerst begrenzter Guard der breit greifenden Regel 109
durch Titel-/Identitätsscope; **keine ungeprüfte Löschung aller Topic-Regeln**.

Danach allgemeiner ARTE-Titelparser und Alias-/ID-Resolver. Generisches Topic
ist keine Serie. Vor Regelanwendung Quelltitel, Metadaten und Serienidentität
prüfen; eine fremde Regel darf einen sicheren generischen Kandidaten nicht
unwiederbringlich aus unmatchedItems entfernen. Auto-Regeln dürfen bei
Sammel-Topics nicht ausschließlich über einen global eindeutigen Topic-Key
modelliert werden; DB-Änderung nur wenn nötig mit eigener Migration/Rollback.

Der aktuelle Loader holt **GitHub main vor lokaler Datei**: reine Änderungen
an data/rulesets.json im Fork sind damit im Betrieb nicht zuverlässig wirksam.
Quellenwahl/Versionierung und Rückfall explizit gestalten, statt still auf die
änderbare Upstream-Regeldatei zu vertrauen.

**Abnahme:** zwei unterschiedliche Serien im selben ARTE-Topic; keine
Occupied-Fehlzuordnung und kein All-the-Sins-Spezialschalter. Deutsche Quelle
durch gleiche stabile Video-ID verknüpfen, Staffel/Folge erneut prüfen,
de/fr/OV/AD und Untertitelpräferenzen testen. API-Ausfall, Pagination der
Kandidatensuche und fehlende deutsche Fassung fail closed.

### P08 — Filmsuche ohne neue Konten, ohne erfundene Identität

Zielorte: neue movie-metadata-Schnittstelle, movie-matcher.ts, mediathek.ts,
newznab.ts und Newznab-Route. Ein gemeinsamer Movie-Suchkontext für
t=movie und t=search mit Filmkategorie; TMDB-/IMDb-only und q+ID gleich behandeln.

Der Proxy verwendet bereits einen öffentlichen Radarr-Metadatendienst ohne
User-Token. Dies kann optional der kleinste accountfreie Erweiterungsweg sein;
Verfügbarkeit, API-Schema und Nutzungsbedingungen sind noch kein zugesicherter
Vertrag. Lokale Radarr-API ist eine konfigurierbare Alternative, kein neuer
Zwangs-Key. Externe Abfrage übermittelt Film-ID; lokale Bibliotheksdaten oder
API-Keys niemals an diesen Dienst weitergeben.

Deutsche Übersetzung, passendes deutsches Original und kanonisches Jahr
validieren; bei Widerspruch von query/year/ID/Metadaten keine ID oder Jahreszahl
erfinden. Markante Wörter und begrenzte Umlautvarianten nur zur Kandidatensuche
nutzen. Schlussentscheidung: exakter Titel/Alias + Filmkontext + belastbare
Metadaten, Laufzeit, Sprach-/Fassungsprüfung; Remakes mit gleichem Titel nicht
allein über vom Request übernommenes Jahr unterscheiden.

**Abnahme:** deutscher Film trotz englischem Suchnamen, Umlaut-/ASCII-Variante,
historischer Film trotz aktuellem Ausstrahlungsjahr; kein Magazinclip,
falsches Remake, fremde ID, Sequel oder AD. Bei fehlenden Daten kein blindes
fuzzy/partial-Publishing mit angefragter TMDB-ID. 60-Minuten-Proxy-Grenze nicht
global hardcoden: konfigurierbare Laufzeitpolitik erhält legitime kurze Filme
und Dokumentarfilme. Grenzwerte, ID-only, API-Ausfall, Qualitätsvarianten,
Quelllimit, limit/offset/total und Budget testen.

### P09 — Medieninhalt vor completed

Zielorte: server/download-manager.ts, ytdlp.ts, ffmpeg.ts und ggf. optionale
Download-Metadaten. Vorhandenes HLS-Video-/Audio-Muxing wiederverwenden.
Optionale persistierte Erwartungswerte benötigen einen eigenen Schema-/NZB-
Kompatibilitätsplan; nicht beiläufig Schemafelder voraussetzen.

**Abnahme:** progressive und HLS, getrennte/zusammengeführte Audio-Tracks,
fehlendes Audio, kurze Samples, HTTP200-HTML und unterbrochene Transfers mit
lokalen Testmedien/Mock-Prozessen prüfen. Laufzeit/Streamprüfung vor completed,
ungeklärtes oder unvollständiges Medium als failed. Größenschätzungen,
Release-1080p und .mp4-Suffix sind keine Inhaltsbeweise. Quellseitige Qualitäts-
evidenz beim RSS-Erzeugen verwenden; die tatsächlich geladene Auflösung vor
completed dagegen prüfen. Keine vollständigen Vorab-Downloads aller Such-
treffer voraussetzen. HLS bleibt per vorhandener Einstellung
steuerbar; erst nach diesem Gate Sonarr-Fallbacks für HLS freigeben.
Keine blind gesetzten deutschen Container-Tags.

### P10 — Nachweis der vollständigen Ablösung und Rollback

1. Alle B01–B16/O01–O02 mit Test, Ergebnis, verantwortlichem Paket und Reststatus
   belegen. Nicht relevante reine HTTP-Adapterteile ausdrücklich als
   „entfällt bei direkter Verbindung“ schließen; keine Funktion still auslassen.
2. Separat freigegebener isolierter Integrationsbetrieb: eigene Daten/Downloads,
   keine automatische Produktionssuche oder Grabs. Indexer und SAB-Client
   getrennt prüfen, inklusive Prowlarr-Sync zu Sonarr/Radarr.
3. Beide Newznab-Pfade, caps, validation/RSS-Sync, ID-/Text-/Staffel-/Episode-
   Suche, Paging und relative enclosure-URLs testen. NZB → addfile → Queue →
   completed/failed → History → Import → gezieltes Remove/Retry vollständig.
4. UI-/Mediathek-Contentpfade und vorhandene SRF/ORF-Provider bleiben funktionsfähig;
   Desktop-only UI-Prüfung, keine Mobiltests. Health prüft sinnvolle Bereitschaft
   und relevante API-Verträge, nicht nur einen immergrünen /healthz-String.
5. Vor produktiver Freigabe: aktueller Live-Task/Image-Digest und GitOps-Stand,
   Kategorien, Verbindungskonfigurationen, Path Mapping, Berechtigungen und
   Secret-Mounts erneut erfassen. Image-Scan gemäß Homelab-Richtlinie, festes
   Digest statt ungeprüfter latest-Referenz; Bestands-DB gesichert.
6. Aktiv laufende und noch zu importierende Jobs vor Umschaltung kontrolliert
   beenden. Alte Proxy-private History-Kategorien oder geänderte GUIDs dürfen
   nicht zu verlorenen/erneuten Imports führen. Keine zweite aktive
   RSS-/Downloadroute, die doppelte Grabs verursachen könnte.
7. **Erst nach ausdrücklicher Nutzerfreigabe** Indexer-URL und SAB-Client-Host
   direkt auf Pingufunk umstellen; Verbindungen und Imports erneut validieren.
   Der Host-Schlüssel im Servarr Remote Path Mapping muss zum neuen
   Downloadclient-Host passen; nicht nur lokale/entfernte Pfadpräfixe prüfen.
   Unbeteiligte Bibliotheks-/Mediapfade bleiben unverändert.
   Architektur, Networks, Volumes, Secrets und Deploymentstruktur erhalten.
8. Bei Fehlern altes Image/Routing und Proxy wieder aktivieren; neue Jobs
   kontrolliert anhalten, bevor alte Komponenten übernehmen. Ohne Schemaänderung
   ist Routing-Rollback einfacher; mit Schemaänderung eigener Backup-/Restore-
   und Datenverlustplan, niemals alte Binary blind auf neuer DB starten.
9. Proxy erst nach dokumentierter erfolgreicher Abnahme und gesonderter
   Entfernungsfreigabe aus dem Stack entfernen.

## Nachweismatrix und Review der Risiken

| Prüfung                   | Nachweis heute                                                                                                         | Noch erforderliche Abnahme                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ARTE Staffel N (E/Gesamt) | Audit A1: S01E02 trotz expliziter Staffel 2                                                                            | P01 positiv/negativ + Release/Attribute/NZB           |
| Fremdsprache und GUID     | A2: ARTE.FR als GERMAN; A3: zwei Fassungen gleiche GUID                                                                | P03 Reihenfolge, Sprachbeweis und Varianten           |
| Saison-Textsuche          | A4: literal S02 führt bei Staffel-Titel zu leerer Antwort                                                              | P02/P07 gezielter Fallback mit Identitätsprüfung      |
| Filmtextsuche             | A5: fremder Langbeitrag wird als Film mit Ausstrahlungsjahr publiziert                                                 | P08 Exact/ID/Jahr/Filmkontext                         |
| Einzelne Quellrenditions  | A6: HLS-Standard verdrängt vorhandene progressive HD                                                                   | P01 pro URL, P09 Content                              |
| TVDB-ID-Episode           | A7: E2 gefiltert, E1 nicht ausgegeben                                                                                  | P02 regressionsfrei erhalten                          |
| Sonarr-Metadaten          | Quellcode + Proxy-Hilfsfunktionstests; kein native Anbieter                                                            | P05/P06 API/Secret/Cache/fehlende Episode             |
| Import-Isolation          | Code zeigt gemeinsame Kategorie- und Titel-Temp-Pfade                                                                  | P04 echte isolierte Dateisystemtests mit zwei Jobs    |
| Filmsicherheit im Proxy   | Isolierte Probes: fehlende Dauer akzeptiert; DE-Kanal + fr-Website akzeptiert; Queryjahr gewinnt bei Metadatenkonflikt | P08 stärker als Proxy, keine Heuristik 1:1 übernehmen |
| Betrieb/Health/GitOps     | Git-Sollstand gelesen, kein neuer Runtime-Abgleich                                                                     | P10 erst mit Freigabe                                 |

Restunsicherheiten: reale Quellvarianten ändern sich; Video-ID/Locale sind
keine vollständigen Audio-/Identitätsnachweise. Der externe Radarr-Dienst ist
nicht als stabiler offizieller API-Vertrag verifiziert. Umfang bei mehreren
Servarr-Instanzen, kurzen Filmen und AD/Untertitelpräferenzen braucht explizite
Defaults, keine permissiven Annahmen. Codebegründete Queue-/Temp-Races sind
noch nicht live reproduziert. Dies sind Paketabnahmen, kein Anlass für ein
jetziges Deployment.

## Nächster konkreter Schritt

P00: die sieben Audit-Befunde als dauerhafte, synthetische Regressionen in den
jeweiligen Testmodulen aufbauen. Anschließend **P01 zuerst implementieren**:
explizite ARTE-Staffeln und unabhängige URL-Qualitätsprüfung, in kleinen
reviewbaren Commits. Der Proxy bleibt bis zur gesamten Abnahme bestehen.
