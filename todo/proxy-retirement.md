# Pingufunk: ausführbare Phasen-TODOs

Stand: 29.09.2026. **Offener Entwicklungsvertrag, keine Deploymentfreigabe.**
Dieser Vertrag überführt den [Analyseplan](../docs/proxy-retirement-plan.md),
dessen [Review](../docs/proxy-retirement-review.md) und die
[PostgreSQL-Fachreferenz](../docs/postgresql-migration-plan.md). Es gibt im
Ausgangsrepository keine separate Roh-TODO-Datei; die offenen Reviewbefunde
sind hier mit aufgenommen. Analyse und bestandene Bestandstests sind keine
erledigte Implementierung.

## Gemeinsame Regeln und Abnahme

- PostgreSQL ist Pflichtziel für Pingufunks eigene Datenbank, nicht erneut
  eine Servarr-main/log-Migration. Ein aktiver PostgreSQL-Client; SQLite nur
  unveränderte Quelle und begrenzter Rollbackbestand, niemals stiller Fallback.
- Bestehende Architektur/Owner nutzen, kein neuer interner HTTP/XML-Proxy.
  Shipped IDs, RSS/NZB-Identität, öffentliche Kategorien, Queue/History,
  Konfiguration und Pfade erhalten bzw. explizit kompatibel überführen.
  Ungewisse Serie/Folge/Film/Sprache nie als sicher erkannt ausgeben.
- Herkunftsnachweise, B01–B16/O01–O02 und A1–A7/R1–R9 bleiben in den Referenzen.
  Die folgenden Checkboxen sind der einzige ausführbare Arbeitsvertrag;
  Referenztexte besitzen keine zweite Implementierungsreihenfolge.
- Reihenfolge: P00 → P01 → P02 → P03 → P04 → P05 → P11 → P06 → P07 → P08
  → P09 → P10. IDs bleiben trotz der später ergänzten Pflichtphase P11 stabil.
  P11 liefert implementierte und isoliert geprobte PG-Bereitschaft. Die echte
  PG-Umstellung liegt in P10 vor und getrennt von der Proxy-Umschaltung; so
  blockiert eine ausstehende Produktionsfreigabe nicht weitere Entwicklung.
- AGENTS.md und vollständige einschlägige Skills lesen. Upstream vor dem
  betroffenen Paket prüfen; bereits gefixte Verträge erhalten statt duplizieren.
  Unautorisierter Scopewechsel bleibt unzulässig. Ungeklärte Entscheidungen
  blockieren nur ihren benannten Punkt, nicht andere unabhängige Entwicklung.
- Synthetische, unabhängig implementierte Fixtures; kein privater Proxycode,
  keine Liveantworten/Medien/Secrets im Git. Servarr/Provider/Downloads mocken,
  Dateisystem und Datenbank disposable. Bis P11 darf die UI des aktuellen
  SQLite-Runtimes gegen eine eigene wegwerfbare Testdatenbank geprüft werden;
  das ist kein PostgreSQL-Nachweis. Ab P11 sind Datenbankgates gegen disposable
  PostgreSQL zu führen. Keine mobilen Tests; UI desktop-only.
- Jeder Produktpunkt umfasst den ganzen Owner-/Consumerpfad, Review, Behebung
  und erneutes Review ohne offene Findings, eine sichere repräsentative
  Operation/Readback und kausale Regressionen. P00 darf ausdrücklich zunächst
  Charakterisierung liefern. Gates nach `package.json` und
  `pingufunk-test-gates`: relevante Tests, lint, typecheck, format und build;
  keine HTTP-200-/Tabellenname-/Source-String-Tests als alleinige Fachabnahme.
- Zwischenstände bleiben buildbar; Producer und Consumer eines geänderten
  Vertrags gemeinsam umstellen. Obsolete Zweige nur gezielt ersetzen. Wertvolle
  Tests erhalten. Vertragsdokumentation/Runbook im zugehörigen Punkt pflegen.
- Implementierung ändert nur Status und optional eine faktische Abschlussnotiz
  direkt am Punkt. Replan braucht Auftrag. Vollständige Phase vor abhängiger
  Arbeit abnehmen; neue Findings öffnen ihren Punkt wieder. Kohärente Commits
  und Pushes nur zum eigenen `codex/`-Branch, kein implizites Release/Upstream-PR.
- Keine Produktionsmigration, Diensteingriffe, realen Grabs oder Proxyentfernung
  ohne eigene ausdrückliche Freigabe. Vor jedem solchen Gate anhalten. Bestehende
  externe PG-/HAProxy-/Swarm-/Network-/Volume-/Docker-Secret-Struktur erhalten;
  Replikazahl unverändert. Backups/DBs nicht löschen, SQLitequelle nicht ändern.

## Phase P00 — Reproduzierbare Regressionen und sichere Fork-CI

Ergebnis: eine eigenständig nutzbare Testbasis für native Fixes. Keine
Voraussetzung außer dem dokumentierten Ausgangsstand; A1–A7, R8 und B16.

- [x] **P00.1 — Dauerhafte Charakterisierung mit echten Consumerfällen.** In
      `src/services/newznab.test.ts`, `mediathek.test.ts` und passenden neuen
      Tests an den jeweiligen vorhandenen Ownern A1–A6 synthetisch reproduzieren,
      A7 als positiven ID-Episodenfilter sichern. Route-/RSS-/NZB-Verknüpfung,
      Fehler, Pagination und Cachewirkung statt nur Proxyhelper testen. Fehlverhalten
      eindeutig als Charakterisierung benennen, keine blanket skips; bei den
      jeweiligen Fixpunkten in Soll-Regressionen drehen. Abnahme: sieben belegte
      Fälle ohne Netz/Live-DB reproduzierbar; bestehende Suite bleibt unverändert
      belastbar, kein Fix bereits behauptet.
      Abgenommen am 28.09.2026: A1–A6 charakterisiert, A7 positiv samt
      Ausschluss der Nachbarfolge geprüft; Newznab-Route, RSS und NZB-Parser
      synthetisch verbunden. Der Pfadtest dokumentiert die noch offene
      Producer-/Parserabweichung für P02.3.
- [x] **P00.2 — Fork-eigene, nicht publizierende Verifikation.**
      `.github/workflows/ci.yml`, `docker-build.yml`, `package.json` und
      `vitest.config.ts` gemeinsam reviewen; nutzbare eigene Runner für Test-CI
      festlegen und geerbte Blacksmith-/Image-Publish-/Schedule-Annahmen sichern.
      Vorhandene Tests/Build erhalten; kein Tag/Release oder Publikationsjob durch
      diese Arbeit aktivieren. Abnahme: Fork-CI führt die passenden npm-Gates aus,
      und Push/PR/Schedule kann ohne gesonderte Freigabe kein Image veröffentlichen.
      Abgenommen am 28.09.2026 auf `f86d1b9`: Fork-CI mit Test, Lint,
      Typecheck, Formatcheck und Build erfolgreich
      ([Run 36463365415](https://github.com/superions/pingufunk/actions/runs/36463365415));
      Docker-Build-Validierung erfolgreich ohne Publish
      ([Run 36463365408](https://github.com/superions/pingufunk/actions/runs/36463365408)).
      Die Workflows reagieren auf Push/PR, der Docker-Job setzt `push: false`,
      besitzt keine Registry-Publish-Schritte und keinen Schedule-Trigger.
      Wiedereröffnet am 28.09.2026 beim vollständigen Workflow-Review: die
      datenbezogene PR-Validierung nutzte noch Blacksmith-Runner. Korrigiert und
      erneut abgenommen am 28.09.2026 auf `0d07df7`: beide PR-Validierungsjobs
      nutzen `ubuntu-latest`; Fork-CI erfolgreich ([Run 36464806258](https://github.com/superions/pingufunk/actions/runs/36464806258))
      und Docker-Validierung ohne Publish erfolgreich ([Run 36464806375](https://github.com/superions/pingufunk/actions/runs/36464806375)).
      Der separate Schedule-Workflow pflegt ausschließlich `needs-info`-Issues;
      er baut oder veröffentlicht keine Images.

## Phase P01 — Explizite Koordinaten und unabhängige Renditions

Ergebnis: kleine, hochwirksame RSS-Fixes. Abhängigkeit P00; B03/B10, A1/A6.

- [x] **P01.1 — Staffel/Folge aus nachgewiesenen Quellkoordinaten.**
      `src/services/newznab.ts::parseEpisodeFromTitle` und alle Titel-/Attribut-/
      NZB-Consumer auf explizite `Staffel N (E/Gesamt)` sowie Season/Saison/
      Temporada/Stagione erweitern. Bestehende numerische, Daily-, Jahres->99-
      und Mehrfachfolgen-Verträge erhalten; bloßer Bruch ist kein Staffelbeweis.
      Mehrdeutiges nicht für automatisches Matching in S01 umdeuten. Abnahme:
      explizite Staffel 2 bleibt S02 in Release, Attributen und encodedTitle,
      E12E13 bleibt vollständig; positive/negative Altformate regressionsfrei.
      Abgenommen am 28.09.2026: Staffel/Season/Saison/Temporada/Stagione sowie
      `S2026/E02` und `S02/E12E13` regressionsgeprüft. Folge-only und nackter
      Bruch erzeugen keine S01-Behauptung; Daily-/Jahresausgabe bleibt erhalten.
      RSS→Fake-NZB erhält den Base64-Titel; der offene Dateinamen-Parserpfad
      bleibt wie vorgesehen bei P02.3. Prüfung: 192 Tests, Lint, Typecheck,
      Formatcheck und Build erfolgreich.
- [x] **P01.2 — Nutzbare Qualität nicht durch eine andere URL verlieren.**
      `src/services/mediathek.ts::shouldSkipItem`,
      `src/lib/stream-url.ts` und sämtliche TV/Movie/Generic-RSS-Erzeuger
      renditionweise nach URL/Streamtyp/Setting prüfen. Standard-HLS darf
      progressive HD nicht verdrängen; gesperrte HD-HLS darf nicht hinten wieder
      ins RSS gelangen. SRF-URN-Vertrag und vorhandenes ORF/HLS-Muxing erhalten.
      Abnahme: HLS an/aus, progressive+HLS und SRF liefern genau erlaubte
      Renditions; keine globale HLS-Abschaltung oder Providerregression.
      Abgenommen am 28.09.2026: gemeinsame Rendition-Schranke für gematchtes TV,
      generische TV-Feeds, TMDB-Movies und Radarr-Textsuche; HLS-Einstellung wird
      pro Anfrage konsistent an Filter/Matcher/Erzeuger gereicht und in
      Antwort-Cachekeys geführt. Regressionen decken progressive HD neben
      Standard-HLS, gesperrtes HD-HLS neben direktem Standard, HLS-Toggle ohne
      veraltete RSS-Antwort, HLS-only Movie-Matching sowie SRF-URN und ORF-Opt-in
      ab. Vollständiger Producer-/Consumer-Review ohne weitere offene Findings;
      Rohdaten-Cache wird beim Settings-Update geleert. Prüfung nach `npm ci`
      unter Node 24.21.0: 202 Tests in 20 Dateien, Lint, Typecheck,
      Formatcheck und Production-Build erfolgreich.

## Phase P02 — Exakter TV-Suchvertrag vor Pagination

Ergebnis: native, konsistente TV-Antworten. Abhängigkeit P01; B01/B02/B04, A4/A7.

- [x] **P02.1 — Ein Suchkontext für Route, ID und Text.**
      `src/app/api/newznab/route.ts`, der bestehende `/api/newznab/api`-Alias,
      `src/types/index.ts` und `mediathek.ts::{getDesiredEpisodes,
applyDesiredEpisodeFilter,fetchSearchResultsById,fetchSearchResultsByString}`
      gemeinsam umstellen: `ep`/`episode` konsistent, widersprüchliche Aliase
      ablehnen, Staffel/Folge/Daily/ID auch in Text und Fallback erhalten.
      Cachekeys um identitätsrelevante Koordinaten erweitern. Abnahme:
      identische ID-/Text-Anfragen liefern nur gewünschte Folgen, A7 bleibt grün,
      E13 trifft weder E12 noch E130/falsche Staffel; Mehrfachfolgen bleiben erlaubt.
      Abgenommen am 28.09.2026: gemeinsamer Suchkontext für beide Newznab-Routen,
      ID-/Textsuche und ID-Fehlerfallback; `ep`/`episode` werden kanonisiert,
      widersprüchliche Aliase und ungültige TVDB-IDs vor der Suche abgewiesen.
      ID-/Textregressionen decken exakte Folgen, Daily-Datum, falsche Staffel,
      E12/E130 und erlaubte Mehrfachfolgen ab; ID-gebundener generischer Fallback
      bleibt geschlossen. Cachekeys unterscheiden Query, ID, Staffel und Folge.
      Vollständiger Producer-/Consumer-Review ohne offene Findings. Node 24.21.0:
      209 Tests in 20 Dateien, Lint, Typecheck, Formatcheck und Production-Build
      erfolgreich; Fork-CI erfolgreich ([Run 36473448447](https://github.com/superions/pingufunk/actions/runs/36473448447)),
      Docker-Validierung ohne Publish erfolgreich
      ([Run 36473448319](https://github.com/superions/pingufunk/actions/runs/36473448319)).
- [x] **P02.2 — Gezielte Kandidatensuche, erst dann Ergebnisfenster.**
      `mediathek.ts::{fetchSearchResultsByString,fetchSearchResultsForRssSync}`
      von zwingendem literal `Sxx` lösen, ohne ungesicherte Serienzuordnung;
      Identität, Koordinaten, Renditions und Duplikate vor `limit`/`offset` prüfen.
      `total` zählt den gefilterten Kandidatenbestand, nicht erfundene Vollkatalog-
      Vollständigkeit bei Sourcecaps. Abnahme: Staffel-Titel werden gefunden,
      fremde Serien nie umetikettiert; Seiten sind stabil, episodenlose
      Staffelfeeds/Daily-Suche funktionieren und leere Suchergebnisse sind korrekt.
      Abgenommen am 28.09.2026: Textsuche nutzt Kandidaten ohne AND-Zwang aus
      literal `Sxx`; koordinatenbasierte S/E- und Daily-Suchen fragen passende
      Quellformate getrennt ab und filtern anschließend über Regeln/Quellkoordinaten.
      Fremdtitel behalten ihre Regeln-/TVDB-Identität, fehlende Serienregeln
      erzeugen in koordinatenbasierten Feed-Suchen keine generischen Treffer.
      Kandidaten und identische RSS-Releases werden vor Pagination dedupliziert;
      `total` zählt nur den geprüften, sourcebegrenzten Bestand, leere Seiten
      behalten den angefragten Offset. Regressionen: A4 positiv, Saisonvarianten,
      Daily-Datum inklusive `März`, unmöglicher Kalendertag, falsche Folgen/Staffel,
      fremde Titelidentität, Dubletten und Seitenfenster. Vollständiger Owner-Review
      ohne offene Findings. Node 24.21.0: 215 Tests in 20 Dateien, Lint, Typecheck,
      Formatcheck und Production-Build erfolgreich.
- [x] **P02.3 — Gemeinsame Release-Identität bis zum Download.**
      `newznab.ts::{formatTitle,generateTitle,createRssItem,createGenericRssItem,
generateFakeNzb}`, `download.ts::parseNzbContent` und vorhandene
      `fake_nzb_download`-Route auf denselben strukturierten Releasevertrag bringen.
      XML-Rewrite-/zweite Parserlogik vermeiden; Base64-Kommentare, URL-Encoding,
      Sonderzeichen und bereits ausgelieferte NZBs kompatibel halten. Abnahme:
      RSS-Name, encodedTitle, decodierter NZB-Name und Queue-Release stimmen
      über alle TV-Einstiege überein; kein neuer Titel-/Encodingbruch.
      Abgenommen am 28.09.2026: gemeinsamer `NzbRelease`-Vertrag für RSS-Links,
      NZB-Erzeugung, Parser und Queue; der Fake-Download baut XML nur noch an
      einer Stelle. Generic-TV sowie matched Standard- und Daily-Titel laufen
      als synthetischer RSS→NZB→Parser→`/api`-Queue-Roundtrip exakt durch;
      beide `addfile`-Routen reichen Titel und URL unverändert weiter.
      Sonderzeichen, Base64-Plus/URL-Encoding, URL mit `--`, ungültige Base64/
      UTF-8 und Fremdschema sind regressionsgeschützt. Früher ausgelieferte
      Base64-Kommentar-NZBs ohne Dateinamen sowie Legacy-Roh-URL, Metadaten- und
      Dateinamenformate bleiben parsebar. Vollständiger Producer-/Consumer-Review
      ohne offene Findings. Node 24.21.0: 226 Tests in 21 Dateien, Lint,
      Typecheck, Formatcheck und Production-Build erfolgreich.

## Phase P03 — Wahrheitsgemäße Sprache und stabile Varianten

Ergebnis: keine falschen GERMAN-Tags oder GUID-Zwillinge. Abhängigkeit P02;
B05/B07, A2/A3, R4.

- [x] **P03.1 — Präferenzen ausdrücklich entscheiden.** Vor Änderungen in
      `src/services/newznab.ts`, `src/services/content-search.ts` und
      `src/server/ffmpeg.ts` die Defaultpolitik für OV, deutsche Untertitel,
      Audiodeskription, Gebärde, Klare Sprache und evidenzarmen Altbestand samt
      Auswirkung auf sichtbare Treffer festhalten. **Bei offenem Default anhalten
      und Nutzerentscheidung einholen**, nicht permissiv raten. Abnahme:
      versionierter serverseitiger Entscheidungsvertrag; deutsche Domain/Locale
      allein gilt nicht als Tonsprachbeweis, unbekannt wird nicht GERMAN.
      Nutzerentscheidung vom 28.09.2026: OV und nur deutsche Untertitel zunächst
      aus; Audiodeskription/Gebärde/Klare Sprache an, aber nur als eigene Variante
      bei belegtem deutschem Ton; unbekannter Altbestand neutral sichtbar. Das
      kann Sonarr-Matching/Autoabrufe auch ohne `GERMAN` auslösen. Nur ein expliziter
      Tonsprachenbeleg darf `GERMAN` setzen; die Oberfläche lässt Sichtbarkeit
      dauerhaft ändern, nicht diese Invariante.
      Server/API-Persistenz und Regressionen sind geprüft. Noch offen bleibt die
      vorgeschriebene desktop-only Interaktion auf dem tatsächlich servierten
      Testbundle: `/settings` → Matching mit Defaultzustand, Änderung, Speichern,
      Reload und API-Readback gegen eine eigene wegwerfbare SQLite-Testdatenbank
      des aktuellen Runtimes; passende Vorher-/Nachher-Screenshots und
      Browser-Konsole prüfen. Die isolierte P03-UI-Abnahme darf nicht als
      PostgreSQL-Funktionstest ausgegeben werden; dieser bleibt P11 vorbehalten.
      Abgenommen am 30.09.2026 auf dem tatsächlich servierten lokalen
      Development-Bundle von `8ae2e20` unter `/settings` → Matching mit eigener
      wegwerfbarer SQLite-Testdatenbank: Defaultzustand visuell geprüft, OV per
      Maus geändert und gespeichert, nach Reload weiterhin aktiv und über
      `/api/settings?key=matching.languagePolicy` zurückgelesen. Ein weiterer
      Schalter ließ sich per Tastatur um- und zurückschalten. Vorher-/Nachher-
      Screenshots desselben Desktop-Zustands wurden im Codex-Browser aufgenommen
      und visuell verglichen; Browser-Konsole ohne Warnungen/Fehler. Kein
      PostgreSQL-Test und keine produktive Instanz betroffen.
- [x] **P03.2 — Varianten vor Verlust und Pagination auswählen.** In
      `content-search.ts` vor `Map(url_video)`/frühem Slice und in allen RSS-Pfaden
      Sprach-/Fassungsstatus vor Titelbereinigung ableiten; bekannte deutsche
      Variante derselben Quellidentität reihenfolgeunabhängig bevorzugen, fremde
      Einzelfassung nie Deutsch nennen. GUID stabil aus Qualität und tatsächlicher
      Fassung/Quellidentität bilden; 720/1080 bleiben verschieden. Abnahme:
      vertauschte Kandidatenreihenfolge gleichwertig, FR/OV+DE-Untertitel nicht
      GERMAN, unterschiedliche Fassungen kollidieren nicht; RSS-Wiederauftauchen/
      Dupegrab-Risiko der GUID-Umstellung im [Cutover-Runbook](../docs/proxy-retirement-cutover.md)
      dokumentiert.
      Abgenommen am 28.09.2026: Quellfassungen werden vor URL-Dedupe und Pagination
      nach versionierter Policy gewählt; Variantenreihenfolge und kollidierende
      Video-URLs regressionsgeprüft. TV-, Film-, Generic- und Validierungs-RSS
      verwenden beweisgebundene Titel und GUIDs; 720p/1080p bleiben verschieden.
      GUID-Wiederauftauchen/Doppelgrab-Gate dokumentiert; vollständige Producer-
      und Consumer-Review ohne offene Findings.
      Wiedereröffnet nach Review vom 29.09.2026: Das bloß verdoppelte
      Quell-Kandidatenfenster kann eine spätere bevorzugte Fassung abschneiden;
      die GUID enthält derzeit die vollständige Medien-URL, sodass schon ein
      wechselnder URL-Parameter eine neue Identität erzeugt. Tests setzen
      `audioLanguage` synthetisch, während dessen Herkunft in den genutzten
      Providerpfaden noch nicht belegt ist. Vor erneuter Abnahme den tatsächlichen
      Quellcap/Consumerpfad mit einer deutschen Fassung jenseits des bisherigen
      Fensters prüfen und entweder begrenzt nachladen oder Unvollständigkeit
      ausdrücklich kenntlich machen; keine Vollständigkeit behaupten. Für GUIDs
      quellspezifisch belegen, welche URL-Anteile eine echte Rendition abgrenzen:
      kurzlebige Parameter dürfen keine neue Release-Identität erzeugen,
      verschiedene Fassungen/Qualitäten aber nicht kollidieren. Herkunft und
      Weitergabe real verfügbarer Audio-/Fassungsbelege prüfen; fehlt ein
      belastbarer Beleg, bleibt der Treffer neutral statt `GERMAN`. Diese Fälle
      kausal regressionsprüfen, RSS/NZB-Consumer und Cutover-Risiko erneut reviewen;
      erst dann P03.2 wieder schließen und P04 beginnen.
      Erneut abgenommen am 29.09.2026: MediathekViewWeb begrenzt eine Seite auf
      1.000 Treffer; `content-search` liest bis zu 5.000 Kandidaten über `offset`
      nach, stoppt bei einer kurzen Seite oder am dokumentierten Fenster und
      behauptet keine Vollständigkeit des Quellkatalogs. Regression: eine belegte
      deutsche Variante jenseits des früheren 2×-Fensters und jenseits Seite 1
      gewinnt reihenfolgeunabhängig; ein Fehler späterer Quellseiten liefert kein
      scheinbar vollständiges Teilergebnis.
      Die MediathekView-`id` ist ein Hash der ganzen Rohzeile und deshalb keine
      stabile Releaseidentität. GUIDs verwenden Quell-/Fassungsidentität, Qualität,
      Medienpfad und unbekannte stabile Queryselektoren; bekannte kurzlebige
      Authentifizierungs-/Signaturparameter ändern sie nicht. Unbekannte Queryteile,
      verschiedene Fassungen und 720p/1080p bleiben unterscheidbar. RSS hält die
      aktuelle Quell-URL weiter und der echte Fake-NZB-/Parserpfad wurde mit einer
      erneuerten URL verifiziert. Das [Cutover-Runbook](../docs/proxy-retirement-cutover.md)
      beschreibt GUID-Wiederauftauchen, Dupegrab-Gate und jetzt die URL-Normalisierung.
      Herkunftsreview: die aktuellen MediathekView-/ORF-Suchergebnisse enthalten
      keinen Audiotonsprachenbeleg; SRG-SSR-Suchmetadaten befüllen ebenfalls kein
      `audioLanguage`. Die API-Grenze verwirft unbekannte Sprachproperties; SRF-
      Suchergebnis→RSS→NZB bleibt neutral. Ein fehlender Beleg erzeugt kein `GERMAN`.
      Vollständiger Provider-/Varianten-/TV-/Movie-/Generic-/RSS-/NZB-/Cache-Review
      erneut durchgeführt, ohne offene Findings. Node 24.21.0 nach `npm ci`:
      266 Tests in 25 Dateien, Lint, Typecheck, Formatcheck und Production-Build
      erfolgreich. P03 bleibt wegen der offenen desktop-only Abnahme P03.1 unvollständig;
      P04 wurde nicht begonnen.
- [x] **P03.3 — Sprachvertrag bis in die Medienspuren erhalten.**
      `src/server/ffmpeg.ts::{convertMp4ToMkv,mergeVideoAudio}` und deren
      Downloadconsumer von blindem `language=ger` befreien; nur nachgewiesene
      Tracksprachen setzen, unbekannte nicht erfinden. Abnahme: synthetische
      Fremd-/OV-/Mehrspur-/Unbekannt-Fälle haben wahrheitsgemäße Tags, vorhandene
      ORF-Audio/Video-Zusammenführung bleibt funktional.
      Abgenommen am 28.09.2026: FFmpeg remuxt alle Quell-Audiospuren ohne
      erfundene Sprachmetadaten; der HLS-Mux behält seine getrennte Video-/Audio-
      Zuordnung. Provider-Dateinamen bekommen `GERMAN` nur mit explizitem
      Sprachbeleg. FFmpeg-/Provider-/HLS-Regressionen und voller Reviewpfad grün;
      keine Tracksprach-Behauptung wird aus Titel, Kanal oder Locale abgeleitet.

## Phase P04 — Job-Isolation ohne Kategoriebruch

Ergebnis: parallele Jobs können unabhängig heruntergeladen/importiert werden.
Abhängigkeit P03; B14/B15, R5. Bestehende `Download.id` genügt, keine
Schemaänderung allein für Verzeichnisnamen.

- [x] **P04.1 — Temp und Complete gemeinsam pro Job isolieren.**
      `src/server/download-manager.ts::{processDownload,downloadFile,
moveIntoCategoryDir}`, FFmpeg-/HLS-/Sidecar-Consumer und
      `src/services/download.ts::{addToQueue,getHistory,getQueue}` auf sanitisierten
      Release+Job-ID-Owner umstellen. Öffentliche `cat`/`category` bleiben gleich,
      `storage` bezeichnet das genaue Jobverzeichnis; lokale Pfade und gemeldete
      Remote-Path-Mapping-Pfade trennen. Abnahme: zwei gleichnamige Jobs kollidieren
      weder im Temp noch Complete; Import während zweitem Download bleibt sicher,
      EXDEV-copy/unlink und Wiederanlage gelöschter Kategorieordner bleiben erhalten.
      Abgenommen am 30.09.2026: Temp und Complete verwenden denselben
      Release+Job-ID-Owner. Zwei gleichnamige synthetische Jobs und ein Import
      während des zweiten Downloads wurden mit realem Dateisystem geprüft;
      HLS/FFmpeg, EXDEV-copy/unlink, exklusive Zielanlage und das Wiederanlegen
      entfernter Kategorieordner sind regressionsgesichert. `history.storage`
      meldet das genaue Jobverzeichnis im Consumer-Mapping, während `filePath`
      lokal gespeichert bleibt; öffentliche Kategorien bleiben unverändert.
- [x] **P04.2 — Löschen/Retry sind strikt jobgebunden und legacyfähig.**
      `download.ts::{deleteHistoryItem,retryDownload}`, SAB-Route und Manager
      gegen Traversal, absolute/unzulässige Namen, Unicode-/Längenrandfälle und
      Symlink-Ausbruch sichern. Legacy-Proxy-Privatekategorien/alte `filePath`-
      Einträge weiter lesen; keine pauschale Kategorie-/Datei-Umschreibung.
      Abnahme: Queue→completed→History→Import→Remove/Retry anhand synthetischer
      FS-Jobs geprüft; ein Job kann nie Nachbar-Dateien löschen, Sonarr-Prefix-
      Mapping bleibt korrekt und alte nicht importierte History bleibt zugänglich.
      Abgenommen am 30.09.2026: Queue/History/Remove/Retry sind mit synthetischen
      FS-Jobs, alter flacher und Proxy-Privatekategorie sowie lokalem/remote
      `filePath` geprüft. Traversal, absolute und unzulässige Namen, Unicode-
      Bytegrenzen, Symlink-Ausbruch, bestehende Zielpfade und mehrfach referenzierte
      Legacy-Dateien brechen sicher ab; ein Nachbarjob bleibt erhalten. Retry
      bekommt eine neue ID und lässt bei fehlgeschlagener Erstellung den alten
      Eintrag bestehen. Die Übergangs- und Stopbedingungen stehen im
      [Cutover-Runbook](../docs/proxy-retirement-cutover.md). Auf Node 24.15.0
      bestanden 293 Tests in 29 Dateien, Lint, Typecheck, Formatcheck und Build.
      Keine produktiven Jobs oder Datenbanken wurden berührt.

## Phase P05 — Begrenzte Requests, sichere Secrets und Queue-Fortschritt

Ergebnis: belastbare gemeinsame Consumergrundlagen. Abhängigkeit P04;
B08/B11/B16/O01, R2 und API-/Cache-Gates.

- [x] **P05.1 — Endliches Anfragebudget mit ehrlichen Fehlern.**
      `src/lib/fetch-retry.ts::fetchWithRetry`, `src/lib/mediathek-client.ts`
      und ihre Suchconsumer mit Gesamtdeadline, Abort, Antwortgrößen- und Retry-
      Grenzen versehen. 401/403 nicht retryen, 429/5xx begrenzt; ungültiges JSON,
      Timeout und Schemafehler nicht als erfolgreich leer cachebar machen.
      Filmterm-Schleifen teilen dasselbe Budget. Abnahme: Fehler-/Abort-/Rate-
      Limit-Mocks beweisen maximale Laufzeit/Versuche, keine Minutenkaskade;
      API-Fehler verraten keine Secrets oder unredigierten Providerantworten.
      Abgenommen am 30.09.2026: HTTP-Header-Versuche haben ein endliches
      Gesamtbudget, Abort und begrenzte Backoffs; 401/403 werden nicht erneut
      versucht, 429/5xx höchstens begrenzt. MediathekView-JSON wird innerhalb
      derselben Deadline und bis maximal 8 MiB gelesen und schematisch geprüft.
      Pagination und parallele Filmbegriffe teilen je Anfrage eine Deadline;
      ein fehlgeschlagener Begriff oder eine Folgeseite liefert keine partiell
      erfolgreiche Newznab-Antwort. Upstreamfehler ergeben HTTP 503 ohne rohe
      URL-, Token- oder Provider-Fehlermeldung. Timeout-, Abort-, Status-,
      Größen-, JSON-/Schema- und Cache-Recovery-Regressionen bestanden. Node
      24.15.0: 305 Tests in 30 Dateien, Lint, Typecheck, Formatcheck und Build
      erfolgreich; kein produktiver Request ausgeführt.
- [x] **P05.2 — Kontextgebundene bounded Caches.**
      `src/lib/cache.ts`, `src/lib/settings.ts`, die Cache-API und Providerconsumer auf
      begrenzte Positiv-/Negativcaches, Coalescing und passende TTLs bringen.
      Identität, Instanz, Staffel/Folge/Daily, Sprache/Qualität/HLS und relevante
      Settings in Keys/Invalidierung berücksichtigen; Rotation entwertet alte
      Instanz-/Credentialkontexte, Ausfall erzeugt keinen Empty-Success-Eintrag.
      Abnahme: Contextcollision, gleichzeitige Requests, Expiry, Rotation und
      Settingswechsel synthetisch getestet; Speicher/Requests bleiben begrenzt.
      Abgenommen am 30.09.2026: Settings-Lookups haben 256 LRU-Einträge,
      kurze Negativ-TTL und Single-Flight mit generationensicherer
      Invalidierung; Such-/Metadaten-TTLs sind begrenzt und `0` deaktiviert
      Speicherung. Mediathek-RSS/API-Schlüssel binden Instanz, Provider,
      Credentials, Matching, Sprache, Qualität und HLS; identische Suchläufe
      werden nur während der Ausführung zusammengelegt. TVDB-/TMDB-Metadaten
      haben getrennte, gehashte Schlüssel aus Quelle, ID, DB-Instanz,
      Credentials und Invalidierungsgeneration, maximal 1.000 positive bzw.
      256 definitive negative Einträge und 128 gleichzeitig laufende
      Metadaten-Requests. Bestätigte Misses laufen spätestens nach fünf
      Minuten ab; 5xx, Schemafehler und unvollständige Staffeln werden nicht
      als leerer Erfolg gespeichert. Das bisherige quellübergreifende
      `TvdbSeries`/`TvdbEpisode`-Schema wird nicht mehr als aktiver Cache
      verwendet: bestehende Zeilen bleiben als historische Migrationsdaten
      erhalten, auch bei `DELETE /api/cache`. Das bedeutet bewusst keinen
      Offline-Fallback aus diesen nicht herkunftsgebundenen Altzeilen.
      Synthetische Tests prüfen Kontextkollision, Coalescing, Kapazität,
      Ablauf, Rotation, Fehlerwiederholung und Cache-API. 345 Tests,
      Lint, Typecheck, Formatcheck und Build bestanden; Cache-/System-Tab,
      Löschdialog und Erfolgsmeldung wurden gegen einen isolierten
      Baseline-Checkout desktop-visuell verglichen, Konsole ohne Fehler.
      Keine produktive Datenbank oder Laufzeit wurde verändert.
- [x] **P05.3 — Eine serverseitige Secret-/Base-URL-Grenze.**
      `src/lib/settings.ts`, `src/lib/settings-redaction.ts`, Settings-API/-UI
      einschließlich der bisherigen SRF-Maskierung,
      `src/lib/db.ts`, Entrypoint und künftige Metadataadapter so vorbereiten,
      dass neue Credentials nur aus Secretdatei/ignorierter Umgebung kommen.
      Keine Klartextwerte in Browser-Config, URL/Redirect, Logs, Fehlern, argv,
      Dateien oder Fixtures; Base-URL-Unterpfade erhalten und Auth-Redirect-
      Leaks verhindern. Sonarr-Key hat technisch breite Rechte, Adapter nur GET.
      Abnahme: leere/unlesbare/widersprüchliche Secrets fail closed, Rotation
      wirksam; bestehende gespeicherte Settings unverändert migrierbar.
      Abgenommen am 30.09.2026: TVDB, TMDB-Read-Token, SRG-SSR und die
      Streaming-Proxy-URL werden für neue Konfiguration aus ignorierter Umgebung
      oder absoluten Secretdateien gelesen; leere, widersprüchliche, fehlende und
      symlinkende Dateien brechen generisch ab. Bestehende DB-Werte bleiben
      unverändert, werden nicht mehr browserseitig bearbeitet oder im Klartext
      ausgegeben. Der alte TMDB-v3-Key bleibt gespeichert, gilt aber mangels
      sicherer Header-Authentifizierung nicht mehr als aktiv. TVDB-/SRG-Token
      rotieren mit der Secretquelle; TVDB schreibt neue Tokens nicht mehr in
      Config. Provider- und Downloadfehler sind redigiert, Auth-Redirects
      gesperrt, Prisma-/Entrypoint-URL-Logs entfernt. Der GET-only-Arr-Client
      erhält Base-URL-Unterpfade und hält den API-Key aus der URL. Proxy-URLs
      mit Userinfo werden abgelehnt, damit yt-dlp keine Credentials in argv
      trägt. Settings und Setup wurden in isolierter Desktop-Instanz gegen
      dieselben Baseline-Routen/-Zustände visuell verglichen; Screenshots wurden
      im Browser geprüft, nicht persistiert, Browser-Konsole ohne Warnungen/
      Fehler. Setup-Speichern erzeugte im disposable DB nur `download.path`;
      keinerlei produktive Settings, Jobs oder Datenbank wurden verändert.
      Die explizite Betreiberprüfung auf bisher authentifizierte Proxy-URLs
      bleibt vor einem späteren Deployment erforderlich.
- [x] **P05.4 — Queue kann nach Fehlern weiterarbeiten.**
      `download-manager.ts::{processQueue,startDownloadProcessing,markAsFailed}`
      und `download.ts::triggerDownloadProcessing` über gesamte Fehler-/Abbruch-
      pfade reviewen, `isProcessing` verlässlich zurücksetzen und Retry/Restart
      ohne verlorene/stuck Jobs schützen. Abnahme: fehlender Prozess, FFmpeg-/
      FS-/Netzfehler und anschließender Job werden korrekt persistiert/verarbeitet;
      kein Replica-/Distributed-Queue-Umbau oder unbeauftragter Betriebsrestart.
      Abgenommen am 30.09.2026: Der einzelne Worker verarbeitet Jobs erst nach
      Abschluss und Statuspersistenz des vorherigen; ein erneuter Enqueue-Weckruf
      während des letzten Polls erzwingt einen weiteren Durchlauf. Fehler setzen
      den Workerzustand im `finally` zurück. Beim Containerstart werden zuvor
      aktive `downloading`-/`converting`-Einträge als unterbrochen/fehlgeschlagen
      markiert und verbleibende Queue-Einträge wieder aufgenommen; Build und
      bloßer Development-Runtime-Start tun das nicht. Synthetische Folgejobs nach
      Netzwerk-, FFmpeg-/fehlendem Prozess- und FS-Fehlern, DB-Pollfehler sowie
      Boot-Recovery sind getestet. Node 24.15.0: 321 Tests in 32 Dateien,
      Lint, Typecheck, Formatcheck, Build und `sh -n entrypoint.sh` bestanden.
      Weiterhin ausschließlich Single-Worker; kein Replica-Umbau, kein Restart
      oder produktiver Download ausgeführt.

## Phase P11 — PostgreSQL implementieren und isoliert migrationsbereit machen

Ergebnis: einzig aktiver PG-Runtimevertrag, reproduzierbarer Importer und
bewiesener Rollback. Abhängigkeit P05; O01/R9. Alle hier genannten neuen
Runner-/Testartefakte sind **anzulegen**, nicht heute vorhandene Befehle.
Produktive Anwendung des Runbooks gehört ausschließlich P10.3–P10.5.

- [x] **P11.1 — Native Schema-/Client-Kette und kompatibler Start.**
      `prisma/schema.prisma`, historische SQLite-Migrationen, `init-db.sql`,
      `src/lib/db.ts`, `Dockerfile`, `entrypoint.sh`, `.env.example` und
      `docker-compose.yml` gemeinsam auf PostgreSQL umstellen. CLI/Client aktuell
      6.19.2 halten, Baseline in disposable Dev/Shadow-DB erzeugen und SQL prüfen;
      SQLite-SQL unverändert als Recoverygeschichte archivieren, nicht replayen.
      Exakte CLI im schema-/imagegleichen Runner; Client im Build generieren.
      Versionierte DDL kontrolliert mit `migrate deploy`, nicht App-Warmup;
      normale Starts prüfen Schema/DB ohne Import oder SQLitezugriff. Driftprüfung
      separat, kein reset/produktives migrate dev/db push. Abnahme: Fresh Install
      und Restart gegen disposable PG funktionieren, kein stiller SQLitefallback;
      Runnerkommandos im gebauten Image tatsächlich ausführbar, SQLite-Ledger nie
      ins PG-Ziel kopiert und SQL-/Client-/Schema-Versionen konsistent.
      Abgenommen am 30.09.2026 nur in isolierter Testumgebung: Prisma CLI und
      Client 6.19.2, PostgreSQL-17-Container, native DDL für sechs Modelle mit
      UTC-Zeitspalten (Millisekunden), unveränderte SQLite-SQL-Historie unter
      `prisma/legacy/sqlite/`. Ein frisches Ziel wurde vom tatsächlich gebauten
      `migrator`-Image per `migrate deploy` aufgebaut; der zweite Lauf war
      wirkungslos, Schema-Diff leer. Das getrennt gebaute App-Image startete
      gegen dieses Ziel, prüfte die vollständige erwartete PG-Ledgerkette und
      startete nach Containerrestart erneut. Ohne DB-URL brach es ab; keine
      SQLite-Datei wurde angelegt und kein Legacy-Ledger übernommen. Normale
      Starts führen kein DDL/Import aus. Produktions-Primary, PostgreSQL-
      Version, Rolle, TLS und HAProxy bleiben verpflichtende P11.3-/P10-Gates.
- [ ] **P11.2 — Secretfähiger Single-Worker und vollständiger Writer-Gate.**
      Entrypoint/DB-Owner samt `src/instrumentation.ts`, Config-/Cache-, Ruleset-,
      Queue- und Worker-Schreibpfaden auf `DATABASE_URL_FILE` vor Prozessstart und
      getesteten Maintenancebetrieb bringen. URL nur im Prozessspeicher, DEBUG-
      URL-Ausgabe entfernen; leere/konfligierende Konfiguration ablehnen.
      Readiness/Settings/History lesen ohne Cache-, Setting- oder Workerwrite;
      tatsächlichen ersten Anwendungsschreibvorgang als Rollbackgrenze erfassen.
      Pool/TLS/Timeouts an PG/HAProxy statt SQLiteparameter anpassen, kein
      unbegründetes `pgbouncer=true`; Single-Worker bleibt. Abnahme: Secretfehler,
      Netzverlust/Reconnect und alle Writeentrypoints getestet, Wartungslesechecks
      erzeugen null Writes und PG-Ausfall keinen zweiten Datenbestand.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): `DATABASE_URL_FILE`
      wird im Container vor Prisma ohne Log-/argv-Ausgabe gelesen; fehlende,
      leere, widersprüchliche, mehrzeilige, relative und symlinkende Secrets
      werden abgelehnt. Prisma-6-Pool/Connect/Query-Timeouts sind begrenzt,
      explizite TLS-Parameter bleiben erhalten und `pgbouncer=true` wird
      abgelehnt. Default ist `PINGUFUNK_WRITES_ENABLED=0`; Settings, Rulesets,
      SAB-Queue/History, Kategoriecache, Ruleset-Generierung und Worker sind
      damit gesperrt, Modellmutationen zusätzlich im Prisma-Client. Gegen
      disposable PG führte DB-Pause zu 500, Wiederaufnahme zu 200, ohne
      SQLite-Fallback oder neue Zeilen. Noch offen: sämtliche Nebenpfade auf
      stille Writes/Dateieffekte reviewen, belastbare erste PG-Schreibgrenze
      und vollständige Secret-/Wartungs-/Reconnect-Regression im finalen
      PG-Harness; echter HAProxy/TLS/Rollenvertrag bleibt P11.3/P10.
      Ergänzung 30.09.2026: Der Shell-Entrypoint überspringt im Wartungsmodus
      jetzt auch `mkdir`/rekursives `chown`/`chmod` auf dem Downloadvolume.
      Im gebauten App-Image wurde ein gemounteter Sentinel nach einem
      Maintenance-Start gegen disposable PG byte-, mode-, owner- und
      mtimegleich nachgewiesen. Die übrigen offenen Abnahmen bleiben bestehen.
      Ergänzung 30.09.2026: Der gemeinsame Prisma-Writer loggt die erste
      erfolgreiche Modellmutation pro Prozess ohne Datennutzlast als
      konservativen SQLite-Rollback-Grenzmarker. Ein späterer Transaktions-
      rollback kann ihn zu früh, aber nicht zu spät setzen; für den Betrieb
      bleibt eine durable, prozessübergreifende Grenzabnahme erforderlich.
- [ ] **P11.3 — Read-only Preflight mit explizitem Fidelityvertrag.** Einen
      versionierten Preflight unter `scripts/` mit Referenz auf alle sechs Modelle
      bauen: tatsächlicher Sourcepfad/Mount/WAL/SHM, Spalten/Indizes/Ledger/Typen,
      Bootstrap-Drift, Platz, Tool-/Imageversion und Zielidentität feststellen.
      Serverversion gegen Prisma-6-Kompatibilität/Support prüfen, Primary/TLS/
      HAProxy/-Rolle verifizieren; keine Version aus fremdem Projekt schätzen.
      Preserve/Normalize/Reject für jedes Feld festlegen: externe Serien-IDs,
      UUID/CUID/FK/Unique, NULL, UTC-/Millisekunden, BigInt >2^53, JSON-/Regex-
      Strings, Config, alle Job-/Cache-/Regeldaten. Keine erfundenen now/0/Leerwerte
      bei Bootstrapabweichung. Abnahme: bekannte Quellen typisiert erkannt,
      unbekanntes Schema/Zeiteinheit oder fremdes Ziel abort; Read-only erzeugt
      keine Quell-/Zieldatenänderung und Bericht keine geheimen Payloads.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Ein versionierter
      Preflight erkennt die sechs Modelle in den historischen Bootstrap- und
      Prisma-SQLite-Schemata, prüft Feldtypen/NULL/Int32/Int64/Zeitdarstellung
      ohne Klarwertbericht und lehnt unbekannte Tabellen, Spalten, Ledgernamen
      und mehrdeutige Zeitwerte ab. Ein WAL-Quellpfad wird vor dem SQLite-Open
      gestoppt: Selbst read-only-Open verändert sonst nachweisbar die SHM-Datei;
      für die Schema-/Wertprüfung ist ein konsistenter Snapshot nötig. PG-Primary,
      Rolle, TLS und Version sind als Read-only-Abfragen vorbereitet; die
      konfigurierte Endpoint-Adresse muss explizit der erwarteten entsprechen.
      Der disposable PostgreSQL-17-Superuser wurde korrekt zurückgewiesen. Das
      Quellinventar meldet Pfad, Dateisystem-ID, freien Platz und WAL/SHM;
      die Inhaltsprüfung läuft erst auf dem privaten Snapshot. Noch offen:
      Zieltest mit scoped Rolle, echte HAProxy-/Versionsbelege, verfügbare
      Runner-/Imageversionen und vollständige Fidelitymatrix.
- [ ] **P11.4 — Konsistenter Snapshot und eigener leerer Zielbereich.** Im
      neuen Runner SQLite-Backup-API/CLI statt Kopie einer laufenden Hauptdatei
      verwenden; Snapshot außerhalb Git mit eingeschränkten Rechten und Hash.
      `PRAGMA integrity_check` exakt `ok`, `foreign_key_check` ohne Zeilen;
      Quelle nur lesen, kein VACUUM/Checkpoint/Repair. Eigene PG-Rolle/DB/Schema
      nach Konvention vorbereiten, Runtime ohne SUPERUSER/CREATEDB/CREATEROLE,
      Runner-DDL-Rechte scoped; runtime/importer gleicher Primary. Native
      Migrationskette nur im freigegebenen eigenen Ziel, Anwendungsdaten leer.
      Abnahme: WAL-Quelle konsistent gesichert; beschädigte/FK-verletzte Quelle,
      nichtleeres/fremdes Ziel abbrechen ohne Drop/Truncate; keine Servarr-main/log
      oder fremden Grants. In dieser Phase ausschließlich disposable Umgebungen.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Der separate
      Snapshot-Runtimepfad nutzt Node-SQLite-Backup statt einer Kopie der
      laufenden Hauptdatei; ein WAL-Test beweist die zuletzt geschriebene
      Zeile im Snapshot. Nur die neue private Kopie wird auf einen einzelnen
      DELETE-Journal-Stand kanonisiert. 0700-Verzeichnis, 0600-Datei, SHA-256,
      vollständiger `integrity_check` und `foreign_key_check` sind getestet;
      erneuter Lauf auf dasselbe Ziel und ein FK-defekter Snapshot brechen ab.
      PG-Rolle/Zielidentität, leeres Zielschema und Rollengrenzen sind noch offen.
- [ ] **P11.5 — Typisierter Import und sichere Resume-Grenzen.** Den neuen
      Importer explizit auf read-only Snapshot→Prisma-PG-Schema abbilden, Eltern
      vor Kindern, IDs original. Keine blinde pgloader-Schemagenerierung;
      typisierter Import ist hier die gewählte Route. Transaktion bzw. isoliertes
      eigenes Staging mit Ziel-Lock schützt vor aktivem Teilbestand. Run-ID bindet
      finalen Sourcehash, Importer-/Schema-/Zielversion; gleicher validierter Lauf
      wird read-only geprüft, Fehlerlauf nur im eigenen unveränderten Staging
      fortgesetzt. Geänderte Quelle oder aktives/fremdes Ziel abort, kein fremdes
      upsert. Abnahme: alle sechs Tabellen einschließlich Cache/Config/History
      verlustfrei, Crash/Retry/Repeat deterministisch und fremde Daten unangetastet;
      Manifest frei von Secrets, kein pauschaler Atomaritätsanspruch für DDL/Rollen.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Die isolierte
      Feldabbildung für alle sechs Modelle ist implementiert und testet
      Original-IDs, BigInt >2^53, NULL, Regex-/JSON-Strings sowie
      Offset→UTC-Millisekunden. Ein noch nicht als CLI freigegebener Kern
      prüft Snapshot-Hash/Integrität/FK, PG-Identität/Ledger und sperrt alle
      sechs Tabellen in einer Importtransaktion; er fordert ein leeres Ziel.
      Der Import aller sechs Modelle, ein semantisch geprüfter read-only Repeat
      und die Zurückweisung einer zusätzlichen Fremdzeile wurden gegen eine
      disposable PG-17-DB mit nichtprivilegierter Rolle geprüft. Der
      vollständige Crash-/Resume-Vertrag und operatorfähige CLI fehlen.
      Ergänzung 30.09.2026: Ein privates 0600-Manifest bindet Snapshot-Hash,
      Importer-/Schemahash sowie Zielversion, DB-OID, Host und Rolle. Ein
      simulierter Absturz nach Transaktionscommit vor Manifestabschluss wurde
      durch read-only Zeilenvergleich erkannt und als derselbe Lauf finalisiert;
      fremde Identität abort. Ein injizierter Abbruch nach bereits importierten
      Eltern/Config-Zeilen rollte die ganze PG-Transaktion zurück; derselbe
      Pending-Lauf konnte danach aus dem leeren Ziel neu starten. Noch offen:
      durable Operatorabläufe/CLI und Sequenz-Resume unter Fehlern.
- [ ] **P11.6 — Reale Sequences und semantischer Verifier.** Im neuen
      Verifier PG-Katalog/Ownership für tatsächlich sequencegebundene Spalten
      verwenden; MAX, leere Tabelle, Startwert und `is_called` korrekt. Keine
      statische Liste, keine automatisch erfundenen `TvdbSeries.id`; `setval`
      rollt bei Transaktionsfehler nicht mit zurück, Resume separat schützen.
      Für alle Modelle Rowcounts, PK-Mengen, normalisierte zeilenweise Werte/
      Hashes, FK/Unique/NULL, Zeitpräzision, BigInt-Summen, Status/Kategorien und
      private Configwerte intern vergleichen. Abnahme: jeder unerklärte Verlust
      abort, Bericht redigiert; echte neue Prisma-Inserts in isoliertem Test
      kollisionsfrei, einschließlich leerem Ziel und Sequence-/Resume-Fehlerfall.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Ein rowweiser
      Vergleich prüft alle sechs Modelle, sämtliche transformierten Felder und
      Mengen ohne Payloadausgabe; der Import nutzt ihn noch vor dem Commit.
      Die Sequence-Korrektur liest Eigentümer/Spalte/Start/Inkrement aus dem
      PG-Katalog, nicht aus einer statischen Liste. Ein echter neuer Prisma-
      Episode-Insert nach Import mit expliziter Alt-ID blieb kollisionsfrei;
      ein leeres Ziel startete danach wieder bei seinem tatsächlichen
      Sequence-Startwert. Eine gleich große, aber veränderte Config-Zeile
      wurde ohne Überschreiben zurückgewiesen. Sequence-Fehler-/Resume-
      Fälle und weitere Abweichungsproben stehen noch aus.
- [ ] **P11.7 — PostgreSQL-Harness beweist Runtime und beide Rückwege.**
      `src/lib/db-schema.test.ts`, passende Ownerintegration und neue Runner-
      Tests gegen disposable PG aufnehmen; `vitest.config.ts`/npm-Gates so routen,
      dass Tests außerhalb `src/**/*.test.ts` nicht unbemerkt fehlen. Fresh Install,
      Bestandsimport aller Modelle, CRUD/Settings, Queue/History, Regeln/Caches,
      Restart, BigInt/Datum/NULL, Secret-/DB-/Reconnect-Ausfall, Retry/Resume und
      Maintenancewrite-Sperre kausal testen. Vor erstem PG-Write immutable altes
      SQLiteimage+Quelle zurück; danach gestoppte Writer+PG-Backup und getesteter
      Rücktransfer **oder vor Produktion ausdrücklich akzeptiertes RPO** mit
      benannten Verlusten. Abnahme: kein SQLite-only/Tabellenname-Regex-Ersatz,
      beide Rollbackfälle geprobt und Grenzen ehrlich dokumentiert, Daten/Backups
      bleiben erhalten; Produktions-RPO noch offen bedeutet Cutover gesperrt.
- [ ] **P11.8 — Operatorfertiges Runbook aus realen Commands.**
      `docs/postgresql-migration-plan.md` als Referenz und ein zugehöriges Runbook
      mit tatsächlich implementierter CLI/Flags, dry/read-only Preflight,
      Schreibfreigabe, Stop/Backup/Prepare/Import/Verify/Maintenancestart/Pause/
      Resume/Rollback pflegen. Exact Image-/Tool-/Schemaidentität und erforderliche
      private Betriebswerte nur als redigierte Eingaben, keine Beispielcredentials.
      Abnahme: Runbook an frischer und migrierter disposable Installation vollständig
      nachvollziehbar; keine fingierten fertigen Deploykommandos, Retention/
      Cleanup braucht separate Freigabe und Proxyrollback behält PG bei.

## Phase P06 — Sonarr als optionaler accountfreier Metadatenanbieter

Ergebnis: fehlende lokale Episoden sicher auffindbar. Abhängigkeit P11;
B08/B09. Sonarr-Key nötig, neues TVDB-/TMDB-Konto nicht.

- [ ] **P06.1 — Providervertrag und Fallbackumfang entscheiden.**
      `src/services/shows.ts::{getLocalShow,getShowInfoByTvdbId}` und neue
      `src/services/sonarr-metadata.ts` zusammen planen: optional default-off,
      zunächst eine Instanz, Providerpriorität/Refresh und Ergänzung fehlender
      Episoden statt ungeprüftem Ersetzen von shows.json/TVDB/TMDB. **Vor Adapter-
      freigabe** tatsächliche Sonarr-API-Version/`/api/v3/series` und
      `/api/v3/episode?seriesId` belegen; Dauergrenze für kurze Episoden und
      Exact-/Staffel-/RSS-Fallbackumfang explizit entscheiden. Bei Unklarheit
      Nutzerentscheidung einholen; Proxy-20-Minutenheuristik kein globaler Default.
      Abnahme: begrenzter schriftlicher Vertrag ohne Identitätsguessing, bestehende
      Feeds erhalten, kein ungefragter Mehrinstanz-/Full-RSS-Scope.
- [ ] **P06.2 — Sicherer Provider mit vollständig fehlertolerantem Consumer.**
      Neuen Sonarradapter in `shows.ts`/TV-Suchowner anschließen, P05-Secret-/
      Budget-/Cachegrundlagen nutzen, nur GET und Base-URL-Unterpfade. Serien-ID,
      Instanz und Episode verifizieren; veralteter Bestand ohne gewünschte Folge
      wird gezielt ergänzt, API-Ausfall nicht erfolgreich leer gespeichert.
      Abnahme: Missing-Episode, falsche Instanz/ID, Rotation, Timeout/401/429,
      Cacheexpiry/-coalescing und default-off mit synthetischer API getestet;
      keine APIkeys/echten Bibliotheksantworten im Browser oder Git.
- [ ] **P06.3 — Titelkandidaten auf sichere Identität begrenzen.**
      TV-Suche/`newznab.ts` mit vollständigem Episodentitel oder letztem
      Separatorsegment ≥3 Zeichen nur innerhalb gesicherter Serie, Jahr/
      Serienpräfix, Quellkoordinaten und beschlossener Dauerpolitik matchen.
      Trailer/AD/Klare Sprache nach P03-Vertrag, unsichere URLs und Konflikte
      ablehnen. Sonarr-Fallback vor P09 nur direkte progressive HTTP(S)-Renditions.
      Abnahme: synthetische Tatort-Missing-Episodes und Jahres-/Titelkonflikte
      nachgewiesen; Unbekanntes erhält nie angefragte S/E/TVDB-Identität.

## Phase P07 — Allgemeines ARTE-Matching statt Titel-Allowlist

Ergebnis: identitätsgesicherte Mehrserien-/Sprachzuordnung. Abhängigkeit P06;
B04/B05/B06, R3.

- [ ] **P07.1 — Regelquelle und Identität gemeinsam korrigieren.**
      `src/services/rulesets.ts::{loadRulesets,getRulesetsForTopicAndTvdbId}`,
      `src/services/ruleset-generator.ts` und `data/rulesets.json` prüfen:
      Remote-main wird vor lokal geladen, daher Quelle/Version/Updateweg explizit
      festlegen. Regel 109 mit generischem ARTE-Topic auf gesicherte Serienidentität
      eingrenzen statt pauschaler Occupied-Zuordnung; fehlgeschlagene Regeln dürfen
      gültige generische Kandidaten nicht endgültig entfernen. Abnahme: lokale
      Änderung tatsächlich verwendbar, Remoteausfall kompatibel, fremde Serien
      nie Occupied und keine dauerhafte All-the-Sins-/Titel-Allowlist.
- [ ] **P07.2 — Auto-Regeln für gemeinsam genutzte Topics.**
      `ruleset-generator.ts::{getGeneratedRulesetByTopic,getGeneratedRulesetByTvdbId}`,
      `GeneratedRuleset` und alle Read/Writeconsumer auf nachgewiesene kombinierte
      Serien-/Topicidentität bringen statt globalem Topic-Unique. Schlüsselumfang
      aus realen Consumers ableiten und vor Schema-Cutover festlegen; nötige
      append-only PG-Migration und Datentransition/Rollback mitliefern, keine
      TopicCategory-Unique beiläufig ändern. Abnahme: zwei Serien im selben Topic
      können Regeln laden/generieren ohne Überschreiben/Fehlzuordnung; vorhandene
      IDs/Regex/Filter bleiben erhalten und Migration auf Bestand getestet.
- [ ] **P07.3 — ARTE-Varianten über gesicherte Quelle auflösen.**
      ARTE-Kandidatensuche/Providerconsumer über Titel/Alias plus sichere Serie
      und gleiche Video-ID zur passenden DE-Fassung führen; deren Koordinaten
      und tatsächlichen Sprachstatus erneut prüfen. B04-Fallback hat weiterhin
      exakte Abschlussfilter und P05-Budget, keine Locale=Audio-Annahme.
      Abnahme: zwei Serien/gleiches Topic, fehlende DE-Fassung, OV/AD, APIausfall
      und paginierte Kandidaten fail closed; korrekte Varianten reihenfolgeunabhängig.

## Phase P08 — Sichere Filmsuche ohne neue externe Konten

Ergebnis: kanonische Filmidentität statt Topic/Ausstrahlungsjahr. Abhängigkeit
P07; B01/B11–B13, A5, R1/R2.

- [ ] **P08.1 — Accountfreien Metadatenvertrag verifizieren und entscheiden.**
      Filmowner in `src/services/mediathek.ts` und neuer Movie-Metadatenadapter:
      öffentlichen Radarr-Metadatendienst einschließlich `/v1/movie/<id>` anhand
      aktueller Primärquellen/Schema/Terms/Datenschutz/Verfügbarkeit prüfen.
      Optional/default-off, nur öffentliche Film-IDs nach außen, keine Bibliothek/
      Keys; lokale Radarr-API ist Alternative, kein zwangsweise zweiter Anbieter.
      **Unverifizierter Dienstvertrag stoppt seine Integration**. Providerwahl,
      Film-/Kurzfilm-Dauerpolitik und AD/Sprachdefaults explizit festhalten/
      Entscheidung einholen; Proxy-60-Minutenheuristik kein globaler Default.
      Abnahme: accountfreie begrenzte Strategie mit sicheren Ausfallsemantiken,
      kein garantierter fremder APIvertrag und kein neuer Kontozwang behauptet.
- [ ] **P08.2 — Ein kanonischer Filmkontext über alle Suchrouten.**
      Newznabroute, `src/services/movie-matcher.ts`, `src/services/tmdb.ts` und
      `mediathek.ts::{fetchMovieSearchResults,fetchMovieSearchByQuery}` gemeinsam
      für `t=movie`/`t=search`+Filmkat,
      q/IMDb/TMDB/Jahr und ID-only/q+ID vereinheitlichen. Metadaten-/Querykonflikte
      ablehnen, nicht Queryjahr über kanonisches Jahr setzen. Aliase/Original-/
      deutscher Titel und Produktionsjahr begründen die Releaseidentität;
      Ausstrahlungstag ist kein Filmjahr. Abnahme: alle Routeformen gleichwertig,
      falsch/fehlend identifizierte Kandidaten ohne blindes ID-Stempeln verworfen,
      bekannte sichere Fälle und generische Nichtfilmverträge regressionsfrei.
- [ ] **P08.3 — Begrenzte Kandidatenerweiterung mit strenger Schlussprüfung.**
      Film-Suchconsumer um markante Titelwörter und begrenzte Umlautvarianten
      erweitern, alle Versuche teilen P05-Gesamtbudget. Exakter Titel/Alias,
      ID/Jahr, Filmkontext, Dauer, Sprache und Qualität vor Dedupe/Pagination/
      `total` prüfen, gemeinsame P02-Release-/NZB-Identität nutzen. Keine fuzzy/
      partial-Ausgabe beliebiger Magazine, Clips, Remakes, Sequels oder AD.
      Abnahme: positive/negative synthetische Fälle inklusive fehlender Dauer,
      DE-Kanal+FR-Website und Jahreskonflikt; Providerfehler nicht als valider
      Empty-Erfolg verschleiert, Seiten/Counts konsistent und Budget eingehalten.

## Phase P09 — Tatsächlicher Medieninhalt vor completed

Ergebnis: falsche/kaputte Downloads werden nicht importierbereit gemeldet.
Abhängigkeit P08; B10/R7.

- [ ] **P09.1 — Erwartungs- und Legacyvertrag gemeinsam festlegen.**
      RSS/NZB-Producer, `download.ts::parseNzbContent`, `Download`-Modell und
      `download-manager.ts` gemeinsam auf verlässliche erwartete Medienmetadaten
      planen: optionale neue Felder benötigen eigene PG-Migration und NZB-
      Kompatibilität. **Fehlende Legacy-Erwartungswerte vor Implementierung
      ausdrücklich entscheiden**, nicht blind fail/pass. Abnahme: persistierter
      Producer/Consumervertrag mit realen Units/Evidenz, alte NZBs weiter lesbar;
      kein Voll-Download als Voraussetzung jeder Suche und kein erfundener
      Audio-/1080p-Nachweis allein aus Quelllabeln.
- [ ] **P09.2 — Fertigmeldung nur nach verifiziertem Medienabschluss.**
      Manager-/FFmpeg-/yt-dlp-Owner nach Download/Mux per lokaler Probe tatsächliche
      Dauer, Audio/Video, Sprache soweit beweisbar, Auflösung und Abschluss prüfen.
      HTTP-200-HTML, Samples, Abbruch, fehlende Audiospur und kaputte Artefakte
      erhalten failed statt completed; P03-Sprachvertrag und P04-Isolation gelten.
      Abnahme: synthetische Medien/Processmocks mit positivem Readback, negativen
      Abbruchfällen und anschließender Queuearbeit; vorhandenes ORF-/SRF-Muxing
      erhalten. Sonarr-Fallback-HLS erst nach dieser Abnahme über vorhandenes
      Setting freischaltbar; keine globale HLS-Sperre oder ungeprüfte Aktivierung.

## Phase P10 — Vollständige Parität und getrennt freigegebener Betrieb

Ergebnis: nachgewiesene Gesamtkette, produktiv PostgreSQL, danach kein Proxy.
Abhängigkeit P09 und alle vorherigen Entwicklungsabnahmen; B16/O01/O02, R6/R9.

- [ ] **P10.1 — Komplette Paritätsabnahme ohne Produktion.** Beide Newznab-
      Pfade einschließlich Caps/Validation/RSS, ID-/Text-/Staffel-/Episode-/Movie-
      Suche, Counts/Relative-Enclosure, NZB-addfile, Queue/failed/completed,
      History/Import/Remove/Retry gegen synthetische Sources und disposable PG
      zusammen prüfen. Alle B/O-Inventarpunkte Owner zuordnen; B16-Proxytransport
      entfällt ausdrücklich, dessen Endpoint-/Fehler-/Healthvertrag bleibt.
      Sonarr-/Radarr-/Prowlarr-Versionen/Parameter vor einer **separat genehmigten
      isolierten Integration** tatsächlich belegen, keine echten Auto-Grabs.
      Desktop-UI-Consumer auf `/search`, `/movies`, `/shows`, `/rulesets`,
      `/downloads`, `/settings`, `/setup` und `/logs` schützen: Suche/Qualitätswahl,
      leere/laufende/fehlgeschlagene Ergebnisse, Settingssave/Secretmaskierung,
      lokale Pfadvalidierung, Listenfilter sowie Retry/Remove nur auf synthetischen
      Jobs. Reale Buttons/Inputs mit Pointer und Tastatur im tatsächlich servierten
      Testbundle bedienen; relevante Themes, Screenshots und Konsole prüfen,
      externe APIvalidierung mocken. ORF/SRF und übrige Provider erhalten.
      Abnahme: belegte komplette Kette und
      DB-/Schema-Readiness statt nur Health-200, kein offener Ownerbefund; nicht
      genehmigte externe Integration bleibt explizites Freigabegate.
- [ ] **P10.2 — Produktionsparameter und Rollbacks vor Freigabe konkretisieren.**
      Runbooks/GitOps-Änderungsentwurf ohne Deploy an tatsächlichem Image-/Task-/
      Gitstand prüfen: PostgreSQL-Version/Primary/TLS, HAProxy-Networkpfad, eigene
      Rolle/DB/Schema, Secret-/Mount-/Pfad-/Rechtekonvention, Sourcefingerprint,
      Größe/Importzeit, Wartungsfenster, Backupablage/Retention und Homelab-
      Image-/Scanpolicy. PG-Cutoverimage mit unverändertem bisherigen Matching
      sowie spätere Feature-/Schema-Aktualisierung getrennt bestimmen: fehlt ein
      kompatibler PG-only-Checkpoint, ist Cutover gesperrt, nicht alles zugleich
      deployen. Keine privaten Werte im öffentlichen Git. Immutable
      SQLite-Rollbackimage sowie nach weiteren PG-Schemaänderungen tatsächlich
      PG-kompatibles Proxy-/Matching-Rollbackimage bestimmen. Rücktransfer oder
      akzeptiertes RPO mit benannten Verlusten **vor erster PG-Schreibfreigabe
      entscheiden**; unbekannte Werte stoppen Cutover. Abnahme: ausführbarer
      redigierter Operationsentwurf und getestete Rückwege, keine Cleanupfreigabe.
- [ ] **P10.3 — Freigegebene PG-Übernahme, Proxy unverändert.** **Hier
      anhalten bis zur ausdrücklichen Datenmigrations-/Deploymentfreigabe für
      genau diese Installation.** P11-Runbook ausführen: read-only Preflight,
      Aufnahme sperren/aktive Jobs kontrolliert auslaufen/unimportierte History
      erfassen, alle Pingufunkwriter stoppen; konsistentes Backup+Integrity/FK,
      eigener leerer PG-Zielaufbau, typisierter Import, echte Sequences und
      semantischer Vergleich. Servarrdienste/Proxy nicht pauschal stoppen,
      bei Fehler kein Appstart oder automatische Bereinigung. Abnahme: Sourcehash/
      Ziel-/Schema-/Imageversion und redigierter Vollvergleich dokumentiert,
      unveränderte SQLitequelle/Backups erhalten; danach Pause vor Appstart.
- [ ] **P10.4 — Kontrollierter PG-Start, noch keine Writers.** **Nur nach
      Validierung von P10.3 und zugehöriger Startfreigabe** neues Image/Secret im
      Maintenancegate starten; DB-/Schema-Readiness, Settings/Queue/History nur
      lesen, null Cache-/Setting-/Workerwrites nachweisen. Nicht allein Probe-200
      akzeptieren. Abnahme: korrekter PG-Bestand erreichbar, Single-Worker, kein
      SQLitefallback; Ergebnisse prüfen und erneut anhalten. Fehlerrollback vor
      tatsächlichem erstem PG-Write auf immutable SQLiteimage+Originalquelle,
      PG-Ziel erhalten; keine alten/neuen Images an falschen Provider anschließen.
- [ ] **P10.5 — PG-Schreibbetrieb separat abnehmen.** **Nur nach expliziter
      Abnahme/Schreibfreigabe von P10.4** Aufnahme/Writer öffnen; ersten echten
      PG-Write einschließlich automatischer Caches/Settings erfassen. Restart/
      Persistenz und freigegebenen isolierten synthetischen Job-/Retry-/Importfall
      prüfen, keine realen Bibliotheksgrabs ohne Auftrag. Abnahme: aktiver Betrieb
      auf PG belegt, Proxy bleibt unverändert, stabile Beobachtung statt simultanem
      Matching-/Routing-/Replicacutover. Nach neuen PG-Writes nur Writerstopp+
      PG-Backup+beschlossener Rücktransfer/RPO, niemals still auf alten Snapshot.
- [ ] **P10.6 — Indexer und SAB gleichzeitig auf native Wege umstellen.**
      **Erst nach stabiler PG-Abnahme und ausdrücklicher Routing-/Deployment-
      freigabe** geprüfte native Funktionsversion samt separat geprüften append-only
      PG-Schemaerweiterungen einführen; Indexer- **und**
      Downloadclient-URLs, Host/Key, relative NZB-URLs und Remote-Path-Mapping
      gemeinsam umstellen. Aktive/nicht importierte Jobs und Legacy-Privatekategorien
      vorher abgleichen, GUID-/Feed-Wiederauftauchen berücksichtigen; eine aktive
      RSS-/Downloadroute, keine Doppelgrabs. Abnahme: freigegebene komplette
      Consumerkette sicher, Mapping/öffentliche Kategorien korrekt. Bei Problemen
      Routing/PG-kompatibles Image zurück, PostgreSQL bleibt aktiv; DB-Rollback
      nur nach eigenem P11-Vertrag, neue Findings öffnen ihren Ownerpunkt wieder.
- [ ] **P10.7 — Proxy erst nach letzter eigener Freigabe entfernen.** Nach
      funktionaler/betrieblicher Abnahme und dokumentiertem PG-/Routing-/Jobzustand
      **anhalten und explizite Proxy-Entfernungsfreigabe abwarten**. Erst dann
      obsolete Proxyservice-/Routingkonfiguration gezielt aus GitOps nehmen,
      bestehende Networks/Secrets/Volumes anderer Consumer unangetastet lassen.
      Abnahme: native Indexer-/SAB-Verbindungen und PG-Betrieb bleiben gesund,
      Rückweg dokumentiert, kein zweiter Proxy, keine Datenbank-/Backup-Löschung.
