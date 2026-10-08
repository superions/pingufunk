# Pingufunk: vollständige Ablösung des Kompatibilitätsproxys

Historische Analysebasis vom 28.09.2026, **kein aktueller Funktions- oder
Bereitstellungsstatus**. Dieses Dokument ersetzt den damaligen groben Projektplan.
Datierte Aussagen und damalige Code-Anker unten beschreiben diese Analysebasis;
spätere Owner-Extraktionen machen sie nicht zu einer zweiten Implementierungsfolge.
Der anschließende [Reviewbericht](proxy-retirement-review.md) dokumentiert
Befunde, Korrekturen und verbleibende Unsicherheiten.
Entscheidung vom 30.09.2026: **PostgreSQL ist optional; SQLite bleibt ein
unterstützter Backendtyp und der Proxy-Ausstieg darf darauf erfolgen.** Der
optionale Datenvertrag steht in der [PostgreSQL-Fachreferenz](postgresql-migration-plan.md).
Einziger ausführbarer Arbeitsvertrag: [Phasen-TODOs](../todo/proxy-retirement.md).
Dieses Dokument bleibt Analyse, Inventar und Priorisierungsgrundlage.

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
Sie setzt **keinen PostgreSQL-Cutover** voraus. Wer PostgreSQL wählt, bekommt
eine separate, verlustbewusste Migration; SQLite bleibt ein gültiges Ziel.

## Prüfgrundlage und Grenzen

- Fork: [superions/pingufunk](https://github.com/superions/pingufunk).
- Upstream main frisch abgerufen: a3b02a6e6ad827d6483700480b9bfbcc59a5823c.
  Versionsangabe 1.3.0, Node.js mindestens 24, MIT.
- Pingufunk-Ausgangspunkt: 97b22298ff21c43b9dbe451f3300fdd66ca5f277;
  ursprüngliche Analyse auf codex/proxy-retirement-analysis;
  PostgreSQL-/Agent-Ergänzung auf codex/postgres-agent-workflow, main unverändert.
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
| O01 | SQLite/NFS, connection_limit und socket_timeout im Stack, nicht im Proxy-Code                                                   | Prisma weiterhin SQLite                                                                                                     | Optionale PostgreSQL-Migration mit Datenvertrag, Secrets und Rücktransfer; P05, P11, bei Wahl P10               |
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

| Rang | Paket                                                           | Aufwand | Mehrwert                                                           | Abhängigkeit / Gate                                                                |
| ---- | --------------------------------------------------------------- | ------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------- |
| 0    | P00: dauerhafte Regressionen und Fork-Test-CI                   | K–M     | Sehr hoch: belegbarer Fortschritt                                  | Nur Test-CI, keine Image-Publikation; Runner prüfen                                |
| 1    | P01: explizite ARTE-Staffel + URL-Rendition-Prüfung             | K       | Hoch: richtige Staffel, progressive Alternativen nicht verlieren   | Bestehende Parser-/RSS-Tests; unklare Staffel nicht erfinden                       |
| 2    | P02: exakte TV-Antworten und konsistente Release-Identität      | K–M     | Sehr hoch: keine fremden Episoden/unnötigen Feed-Mengen            | P01; Serienidentität vor breit geöffneten Suchpfaden                               |
| 3    | P03: ehrliche Sprache und sichere GUID-Deduplikation            | M       | Sehr hoch: falsche Sprache verhindern                              | Sprache vor Titelbereinigung und vor Pagination                                    |
| 4    | P04: Job-Isolation und SAB-Kategorievertrag                     | M       | Sehr hoch: Import-/Überschreibungsfehler verhindern                | Pflicht vor Download-/Import-Abnahme; keine DB-Migration zwingend voraussetzen     |
| 5    | P05: Fehler-/Cache-/Betriebsverträge, Secret-Grundlage          | M       | Hoch: robuste Integration, kein Credential-Leak                    | Pflichtgrundlage für neue API-Anbieter                                             |
| 6    | P11: optionale PostgreSQL-Migration, SQLite weiter unterstützen | G       | Backendwahl ohne Datenverlust                                      | Nach P05; kein Gate für P06–P10 auf SQLite; echter Cutover separat und optional    |
| 7    | P06: optionale Sonarr-Metadaten + sichere Titelsuche            | M       | Sehr hoch: Tatort und fehlende lokale Metadaten ohne neue Accounts | P02, P03, P05                                                                      |
| 8    | P07: allgemeine ARTE-Zuordnung/Varianten statt Allowlist        | M–G     | Hoch: ganze Seriengruppe statt Einzelfix                           | P01–P03, P05; Schemaänderung für beide Backendtypen; ggf. P06 für Metadaten        |
| 9    | P08: accountfreie Film-Metadaten und sicherer Radarr-Suchpfad   | M–G     | Sehr hoch: Filme überhaupt zuverlässig finden/zuordnen             | P03, P05; P04 für vollständigen Import                                             |
| 10   | P09: vollständige Medienprüfung und HLS-Freigabe                | M–G     | Hoch: keine Samples/stummen Dateien als completed                  | P04, Schemaänderung für beide Backendtypen; erwartete Infos aus P06/P08            |
| 11   | P10: isolierte Gesamtparität, kontrollierte Ablösung            | G       | Zielerreichung                                                     | Relevante Entwicklungsabnahmen; PG-Cutover nur bei Wahl, Proxy-Umschaltung separat |

P01 und der begrenzte P02-Fix liefern am schnellsten Nutzen. P03 bleibt
Sicherheitspriorität, ist aber keine bloße Regex-Liste. Bei der Umsetzung
unabhängige Teiländerungen früh reviewen; den Proxy erst nach P10 entfernen.
P11 behält seine Paketnummer, läuft aber unabhängig vom SQLite-Proxy-Pfad;
die bestehenden IDs bleiben als stabile Referenzen erhalten.

## Kanonischer Arbeitsvertrag

Alle Umsetzungspakete und offenen Reviewpunkte sind in den
[Phasen-TODOs](../todo/proxy-retirement.md) überführt. Abnahmen, Entscheidungen
und Freigabestopps werden ausschließlich dort geführt.

P11 liefert technische PostgreSQL-Bereitschaft und erhält SQLite-Lauffähigkeit.
Die echte Produktionsmigration samt Schreibfreigabe ist bei PG-Wahl separat
von der Proxy-Umschaltung freizugeben; beides darf unabhängig erfolgen.

## Nachweismatrix und Review der Risiken

Zusätzlich geprüft: Prisma CLI/Client 6.19.2, sechs Modelle, drei SQLite-
Migrationen und SQLite-Entrypoint. PostgreSQL-Implementierung/Serverversion
und Datenübernahme sind noch offen; P11 ist nur für eine PG-Wahl Abschlussgate.

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

## Einstieg in die Umsetzung

Beginn und Status stehen ausschließlich in den
[Phasen-TODOs](../todo/proxy-retirement.md). Der Proxy bleibt bis zur
Gesamtabnahme und gesonderten Entfernungsfreigabe bestehen.
