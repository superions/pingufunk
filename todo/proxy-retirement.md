# Pingufunk: ausführbare Phasen-TODOs

Stand: 08.10.2026. **P12–P15 sind implementiert und einschließlich ihrer Backend-/Fork-/Containerketten sowie zutreffenden Desktopgates abgenommen. P16.1 bleibt bis zu seiner letzten Extraktion und Abnahme offen. Frühere Entwicklungs- und Betriebsabnahmen bleiben historische Evidenz, keine pauschale Vollabnahme. Historische Freigabestopps sind keine Aussage gegen später ausdrücklich autorisierte Operationen.**
Dieser Vertrag überführt den [Analyseplan](../docs/proxy-retirement-plan.md),
dessen [Review](../docs/proxy-retirement-review.md) und die
[PostgreSQL-Fachreferenz](../docs/postgresql-migration-plan.md). Es gibt im
Ausgangsrepository keine separate Roh-TODO-Datei; die offenen Reviewbefunde
sind hier mit aufgenommen. Analyse und bestandene Bestandstests sind keine
erledigte Implementierung.

## Gemeinsame Regeln und Abnahme

- PostgreSQL ist für Pingufunks eigene Datenbank optional, nicht erneut eine
  Servarr-main/log-Migration. SQLite und PostgreSQL sind gleichwertig unterstützte
  Backends; es gibt keinen fachlich bevorzugten Datenbankstandard. Ohne
  PostgreSQL-Konfiguration wird SQLite verwendet. Pro Installation genau einen
  Provider verwenden; unvollständige/widersprüchliche PostgreSQL-Konfiguration
  und Verbindungsfehler brechen ab, statt still auf SQLite zu wechseln.
- Bestehende Architektur/Owner nutzen, kein neuer interner HTTP/XML-Proxy.
  Shipped IDs, RSS/NZB-Identität, öffentliche Kategorien, Queue/History,
  Konfiguration und Pfade erhalten bzw. explizit kompatibel überführen.
  Ungewisse Serie/Folge/Film/Sprache nie als sicher erkannt ausgeben.
- Herkunftsnachweise, B01–B16/O01–O02 und A1–A7/R1–R10 bleiben in den Referenzen.
  Die folgenden Checkboxen sind der einzige ausführbare Arbeitsvertrag;
  Referenztexte besitzen keine zweite Implementierungsreihenfolge.
- P11.1–P11.8 und die bisherigen Entwicklungscheckboxen sind gemäß ihren
  datierten Einzelabnahmen geprüft, **nicht pauschal sämtliche Phasen**.
  P03.4 bleibt für die allgemeine Sprachabdeckung offen. Der Review vom
  06.10.2026 öffnet P05.2, P09.2 und P10.1 für eng benannte neue Befunde
  wieder; ihre historischen positiven Nachweise werden nicht gelöscht.
  P10.2–P10.5 sind für die separat freigegebene Installation abgeschlossen;
  ihre privaten Betriebswerte sind kein Produktdefault und keine Freigabe
  für eine andere Installation. P10.6/P10.7 bleiben mit ihren eigenen
  Beobachtungs-/Entfernungsgates offen. P11.9 ist optional zurückgestellt.
  P11.2–P11.8 sichern die PostgreSQL-Option und müssen vor deren Betriebsfreigabe
  abgenommen sein; sie blockieren unabhängige Proxy-Arbeit auf SQLite nicht.
  PostgreSQL-Unterstützung gehört zum Entwicklungsumfang, ihre Nutzung und
  jede echte Datenmigration bleiben optional. P11.9 ist ein optionaler Ausbau.
  Bestehende IDs bleiben stabil; Schemaänderungen ab P07/P09 liefern geprüfte
  Migrationen für beide Provider.
- Bei SQLite-Wahl sind P10.3–P10.5 nicht anwendbare PG-Betriebsschritte;
  sie werden nicht als ausgeführt markiert und blockieren P10.6–P10.7 nicht.
  Ein späterer PG-Wunsch aktiviert sie erst nach P11.1–P11.8 und eigener Freigabe.
- AGENTS.md und vollständige einschlägige Skills lesen. Upstream vor dem
  betroffenen Paket prüfen; bereits gefixte Verträge erhalten statt duplizieren.
  Unautorisierter Scopewechsel bleibt unzulässig. Ungeklärte Entscheidungen
  blockieren nur ihren benannten Punkt, nicht andere unabhängige Entwicklung.
- Synthetische, unabhängig implementierte Fixtures; kein privater Proxycode,
  keine Liveantworten/Medien/Secrets im Git. Servarr/Provider/Downloads mocken,
  Dateisystem und Datenbank disposable. SQLite-Runtime gegen eigene wegwerfbare
  SQLite-DB prüfen; PostgreSQL-Runtime separat gegen disposable PG. Kein Backend-
  Test ersetzt den anderen. Keine mobilen Tests; UI desktop-only.
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
  direkt am Punkt. Replan braucht Auftrag. Die ausdrücklich genannten
  Abhängigkeiten vor abhängiger Arbeit abnehmen; unabhängige offene Punkte
  sind keine pauschale Phasensperre. Neue Findings öffnen ihren Punkt wieder.
  Kohärente Commits und Pushes nur zum eigenen `codex/`-Branch, kein implizites
  Release/Upstream-PR.
- Keine Produktionsmigration, Diensteingriffe, realen Grabs oder Proxyentfernung
  ohne eigene ausdrückliche Freigabe. Vor jedem solchen Gate anhalten. Bestehende
  gewählte Network-/Volume-/Secret-Struktur erhalten; keinen bestimmten PG-
  Zugriffsweg voraussetzen oder im öffentlichen Git festlegen;
  Replikazahl unverändert. Backups/DBs nicht löschen, SQLitequelle nicht ändern.

### Arbeitsweg des Architektur-Folgeauftrags vom 06.10.2026

Der [codegestützte Architekturreview](../docs/proxy-retirement-review.md#architektur-folgeauftrag-06102026)
begründet P12–P16. Start bei **P12.1**, danach P12.2/P12.3; P12.4 ist ein
unabhängiger kleiner Integrationsausbau. P13.1 schafft den Diagnosevertrag vor
P13.2 und P14.2. P14.1 kann nach P12.1 unabhängig davon begonnen werden;
P15.1/P15.2/P15.3 benötigen keine vollständige allgemeine Sprachabdeckung.
P16 folgt erst den konkret genannten Ownerabnahmen, kein vorgezogener Rewrite.
P03.4 bleibt der einzige Owner für die offene allgemeine Tonsprachenabdeckung;
P11.9/P10.7 sind keine Startblocker dieses Entwicklungsauftrags. P05.2 wird
durch P12.1, P09.2 durch P12.2 und P10.1 durch P14.1 erneut abgenommen,
jeweils nur nach Behebung ihres neuen Befunds und Schutz der früheren Verträge.
Keine dieser Planergänzungen aktiviert Downloads oder ändert Produktion.

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

- [ ] **P03.4 — Konkrete Filmrendition statt Originalsprachen-Fallback belegen.**
      Ergänzung unter Nutzerauftrag vom 03.10.2026, vor weiterer Sprachabnahme:
      `source-audio.ts`, `mp4-audio-language.ts`, bestehende ARTE-/Sprachowner,
      Film-ID-/Text-/RSS-Consumer, RSS→NZB→Queue/Restart/Retry sowie Medienprobe
      gemeinsam erweitern. Kein Sprachwunsch wird aus Radarr-Originalsprache,
      Prowlarr, Locale, Sender oder übersetztem Titel abgeleitet. Jede geprüfte
      progressive Rendition erhält nur ihren eigenen Beleg: ARTE-Streamdaten
      mit identischer Video-ID und exakter Medien-URL/Audiocode; bekannte MP4-
      Quellen über begrenzte ISO-BMFF-Audiotrack-Metadaten, ohne Voll-Download
      oder Netzwerk-ffprobe in Suchanfragen. Kein HTML-/Flight-Scraping, keine
      Accounts, kopierten Tokens oder Secrets. Gemeinsames P05-Budget und feste
      Body-/Probegrenzen; außerhalb des belegten Fensters bleibt Sprache unbekannt.
      Sprachwahl vor Dedupe/Pagination, quellbasierte GUIDs trotz zusätzlicher
      Belege erhalten. Provider-Audiobeleg getrennt von Container-Tracktags
      versionieren: Legacy/v1 unverändert lesen, neue Fassung im Worker frisch
      an die tatsächlich geladene URL binden, widersprüchliche Tracktags und
      fehlgeschlagene Belegprüfung ablehnen; `und` nie als deutschen Track speichern.
      Beide DB-Provider erhalten Payloads exakt durch Aufnahme/Restart/Retry;
      kein Schema-/DB-Cutover. Alte Images können den neuen Vertrag nicht lesen:
      Rollback vor neuen Jobs oder queuefähiges kompatibles Image verlangen.
      Abnahme: synthetische DE/FR/OV/Untertitel/AD/Unknown-, gemischte Rendition-,
      exakte URL-/ID-/Signaturkonflikt-, Body-/Range-/Timeout-/Budgetfälle,
      RSS→NZB→persistierter Job→Worker positiv und negativ, gleiches Verhalten
      direkt und über Prowlarr an echter disposable Radarr-/Prowlarr-Instanz ohne
      Grab; SQLite-/PostgreSQL-Roundtrip, vollständige Test-Gates und Ownerreview.
      Quellen-/Beweisgrenzen und Rollback in `docs/source-audio-contract.md`,
      Review und Cutover-Runbook dokumentieren. Produktion bleibt gesondert;
      laufende echte Downloads nicht für einen Testdeploy unterbrechen.
      Entwicklungsabnahme am 03.10.2026 auf Produktstand `1f9f18e`:
      Rendition-Owner und versionierter Workervertrag sind implementiert und
      erneut selbstreviewt. 906 reguläre Tests grün, 13 bedingte PG-Gates in der
      Vollsuite separat; `npm ci`, Audit ohne Befunde, Lint, Typecheck, Formatcheck,
      Produktionsbuild und Diffcheck bestanden. Reale v1-/v2-Persistenz über
      SQLite und PostgreSQL samt Queue, Restart und Retry zusätzlich ausgeführt.
      [Fork-CI](https://github.com/superions/pingufunk/actions/runs/37142390426)
      und [Docker-Abnahme](https://github.com/superions/pingufunk/actions/runs/37142390422)
      mit beiden Backends/Migration/Medien/Recovery erfolgreich, ohne Publikation.
      Isolierte native Radarr 6.4.4.10685 und Prowlarr 2.6.5.5623 auf dem aus
      diesem Produktstand gebauten Runner erkennen direkt sowie vermittelt
      genau eine German-Fassung trotz Originalsprache Englisch und jahrloser
      Quelle; korrekte native Film-ID/TMDB-ID/Jahr und keine Parseablehnung.
      Frühere leere Anlaufversuche wurden nicht als Erfolg gewertet; nur der
      spätere vollständig bestandene native Suchlauf zählt. Kein Grab ausgelöst,
      Credentials/Netzwerkgrenzen geprüft, eigene Instanzen gestoppt und deren
      Konfiguration erhalten. Fremde Runtimes und Produktion unverändert.
      Kein pauschaler Sprachabdeckungs-, Auflösungs- oder Deploymentnachweis;
      gesonderter Qualitätsbefund P09.3 bleibt offen.
      Nachprüfung am 03.10.2026 zwischenzeitlich erneut offen: große MP4-
      Sampletabellen verhinderten einen im Zwei-Range-Budget erreichbaren Beleg.
      Korrektur `00b2ce3` liest deklarierte Containergrenzen statt vollständigem
      `moov`: alle Audiotracks, Mischsprachen, beschädigte Grenzen, notwendiges
      drittes Fenster und finale Decodierungsdeadline kausal getestet. Body-/
      Versuchs-/Deadlinegrenzen unverändert. 917 reguläre Tests, Lint, Typecheck,
      Formatcheck, Produktionsbuild und Diffcheck bestanden; anfänglicher
      Testfixture-Typfehler behoben und Gates danach erneut grün. Aktuelle
      [CI](https://github.com/superions/pingufunk/actions/runs/37146674348) sowie
      [Docker-/Backend-Abnahme](https://github.com/superions/pingufunk/actions/runs/37146674264)
      erfolgreich ohne Publikation. Derselbe geprüfte Runner besteht native
      direkte/vermittelte Radarr-Tonsprachensuche und Auth-/Netzwerkgrenzen in
      isolierter QA; ein vorheriger API-Readinessfehler zählt nicht als Abnahme.
      Eigene QA gestoppt, Zustand erhalten; keine neue Schema-/Payloadversion.
      Erneut offen nach realer Quellenprüfung am 03.10.2026: voneinander
      entfernte Track-Trailer können zusätzliche Headerfenster erfordern,
      selbst wenn `mdhd` und `hdlr` erreichbar sind. Die vorhandene sichere
      Unknown-Ausgabe ist korrekt, aber der konkrete automatische Consumerpfad
      bleibt damit unbelegt. Owner `mp4-audio-language.ts`/`source-audio.ts`:
      synthetische Video- und Audio-Tracks mit großen Sampletabellen und
      nachgelagerten `trgr`-Boxen regressionsprüfen; bounded Leseplanung verbessern
      oder die nachgewiesene Abdeckungsgrenze ausdrücklich als offene
      Produktlücke beibehalten. Keine ausgelassenen Track-/Containerprüfungen,
      erfundenen Sprachlabels oder heimlich erhöhten Body-/Request-/Zeitlimits.
      Danach echte direkte und Prowlarr-vermittelte Arr-Verbraucher erneut
      prüfen; operatorseitige Einzelquellenprüfung ist keine automatische
      Produktabnahme. Frühere grüne Entwicklungs-Gates bleiben gültige Evidenz
      ihres beschriebenen Scopes, schließen diese neue Lücke aber nicht.
      Ergänzung unter ausdrücklicher Nutzerfreigabe 05.10.2026: MP4-Proben
      maximal vier 1-MiB-Fenster statt zwei, ohne ausgelassene Track-/Grenzprüfung;
      fünftes Fenster bleibt Unknown. Explizite TV-Suchen maximal 32 Versuche
      bei unveränderter 15s-Deadline; RSS und Filme weiterhin zehn. Gemeinsamen
      Tonsprachenowner auf TV-ID/Text/RSS erweitern; vorhandene strukturierte
      ARD-Player-Audiodeklarationen nur für identische CRID und exakte indexierte
      MP4-URL verwenden. Kein HTML-Scraping, Account oder Sprachdefault.
      Neue v2-Providerkennung `ard_media` benötigt kompatiblen Worker/Rollback.
      Staffelfixtures, negative Quellenbindung, SQLite-/PG-Persistenz und
      Worker-Neuprüfung implementiert. Frische native Consumer-/Imageabnahme
      und getrennte produktive Prüfung bleiben offen; keine Vollabnahme.

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
      Wieder geöffnet 06.10.2026, enger Folgeauftrag in P12.1:
      parallele Settings-Upserts können teilweise committen, während bei einem
      späteren Fehler die Consumerinvalidierung ausbleibt. Atomaren Commit,
      kanonischen Readback und Cachegeneration nach Erfolg/Fehler kausal prüfen;
      frühere Kapazitäts-/TTL-/Kontextnachweise bleiben erhalten.
      Engen Folgeauftrag erneut abgenommen 08.10.2026 mit P12.1:
      atomare Batches auf beiden realen disposable Backends, kein Teilstand
      nach Fehler beim zweiten Write; kanonischer Readback, verlorener
      Commit-Ack, späte GETs sowie generationensichere Consumerinvalidierung
      nach Erfolg/ungewissem Fehler kausal geschützt. Finale CI 37704788531
      und Containerkette 37704788439 auf `4dc280c` bestanden.
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

## Phase P11 — Backendwahl herstellen und PostgreSQL-Unterstützung absichern

Ergebnis: gleichwertiger SQLite-/PostgreSQL-Support; ohne PG-Konfiguration SQLite,
reproduzierbarer Importer und geprüfte App-Rollbacks. Abhängigkeit P05;
O01/R9/R10. P11.1 ist der gemeinsame Kompatibilitäts-Schritt vor P06;
P11.2–P11.8 sind Abnahmegates für die PG-Option, P11.9 bleibt optional.
Offene Runner-/Testartefakte sind zu vervollständigen, nicht als bereits
einsatzbereite Produktionsbefehle zu behandeln.
Produktive Anwendung des PG-Runbooks ist optional und gehört bei PG-Wahl
ausschließlich P10.3–P10.5.

- [x] **P11.1 — Beide Schema-/Client-Ketten und kompatibler Start.**
      `prisma/schema.prisma`, historische SQLite-Migrationen,
      `prisma/legacy/sqlite/init-db.sql`,
      `src/lib/db.ts`, `Dockerfile`, `entrypoint.sh`, `.env.example` und
      `docker-compose.yml` samt `scripts/resolve-database-url.mjs` und
      `scripts/check-postgresql-schema.mjs` für ausdrückliche Providerwahl
      überarbeiten. SQLite ohne PG-URL, PG-Secret oder laufenden PG-Server
      betreibbar halten; PostgreSQL nur nach bewusster Auswahl verwenden.
      Auswahl und URL müssen zusammenpassen; Widerspruch oder Verbindungsfehler
      brechen ab, statt Daten in einem anderen Backend anzulegen.
      CLI/Client aktuell 6.19.2 halten, Baseline in disposable Dev/Shadow-DB
      erzeugen und SQL prüfen;
      SQLite-SQL unverändert als weiterhin ausführbare eigene Kette erhalten,
      nicht gegen PostgreSQL replayen. Zwei passende generierte Clients und
      providergetrennte Migrationspfade ohne impliziten Backendwechsel liefern.
      Exakte CLI im schema-/imagegleichen Runner; Client im Build generieren.
      Versionierte DDL kontrolliert mit `migrate deploy`, nicht App-Warmup;
      normale Starts prüfen das gewählte Schema/DB ohne Import. Driftprüfung
      separat, kein reset/produktives migrate dev/db push. Abnahme: Fresh Install
      und Restart im gebauten Image gegen disposable SQLite **und** PG
      funktionieren; bestehender SQLite-Bestand erhält IDs/Settings/History,
      SQLite-Start benötigt keinen PG-Zugriff, beide Fehlstarts erzeugen keinen
      zweiten Datenbestand. Kein stiller Fallback in beide Richtungen;
      Runnerkommandos im gebauten Image tatsächlich ausführbar, SQLite-Ledger
      nie ins PG-Ziel kopiert und SQL-/Client-/Schema-Versionen konsistent.
      Historischer PG-only-Zwischenstand vom 30.09.2026, wegen neuer
      Dual-Backend-Abnahme wieder geöffnet: Prisma CLI und Client 6.19.2,
      PostgreSQL-17-Container, native DDL für sechs Modelle mit
      UTC-Zeitspalten (Millisekunden), unveränderte SQLite-SQL-Historie unter
      `prisma/legacy/sqlite/`. Ein frisches Ziel wurde vom tatsächlich gebauten
      `migrator`-Image per `migrate deploy` aufgebaut; der zweite Lauf war
      wirkungslos, Schema-Diff leer. Das getrennt gebaute App-Image startete
      gegen dieses Ziel, prüfte die vollständige erwartete PG-Ledgerkette und
      startete nach Containerrestart erneut. Ohne DB-URL brach es ab; keine
      SQLite-Datei wurde angelegt und kein Legacy-Ledger übernommen. Normale
      Starts führen kein DDL/Import aus. Produktions-Primary, PostgreSQL-
      Version, Rolle und gewählter Transport/TLS bleiben für einen PG-Cutover
      P11.3-/P10-Gates; HAProxy ist keine Vorgabe.
      Dual-Backend-Abnahme 30.09.2026: SQLite ohne PG-Konfiguration, konfiguriertes
      PostgreSQL; beide generierten Prisma-6.19.2-Clients. Gemeinsamer Resolver,
      lokale Start-/Migrationswrapper und providergetrennte Schema-Readiness;
      kein automatischer Import/DDL/Fallback. Historisches SQLite-Bootstrap
      mit leerem Ledger bleibt lesend akzeptiert und unverändert. Eigene
      Runtimeproben erhalten alle sechs Modelle, IDs/FK, Settings/History,
      NULL, Millisekunden und BigInt >2^53; HMR verweigert geänderte DB-Auswahl.
      `npm ci`, 398 reguläre Tests, acht separat ausgeführte PG-Gates, lint,
      typecheck, format und Build grün. Tatsächlich gebaute Runner-/Migrator-
      Images bestehen isolierte SQLite-Fresh-/Bootstrap-Starts mit Writes,
      Persistenz/Restart sowie PG-TLS-Snapshot/Import/Start/Writeprobe.
      Fehlstart bei fehlender SQLite-Datei, Providerwiderspruch und unerreichbarer
      PG-DB erzeugt keinen Ersatzbestand. SQL-Historien unverändert; Compose-
      Standard und optionaler PG-Override validiert. Bedienung unter
      `docs/database-backends.md`. Keine produktiven Dienste/Daten berührt.
      Reopen nach Vertragsreview 30.09.2026, ausschließlich für Backendauswahl:
      `scripts/database-config.mjs::resolveDatabaseConfig` setzt ohne
      `DATABASE_PROVIDER` derzeit sqlite, selbst bei gültiger PG-URL. Den
      bestätigten Vertrag zentral umsetzen: ohne Selektor und ohne URL-/Secret-
      Konfiguration SQLite; ohne Selektor bei gültiger `postgres:`-/
      `postgresql:`-URL PostgreSQL, bei gültiger `file:`-URL SQLite. Secretdatei
      erst sicher auflösen, dann deren Protokoll auswerten. Expliziter Selektor
      bleibt unterstützt, darf aber der URL nicht widersprechen. Leer, unbekannt,
      unlesbar, doppelt oder unvollständig konfiguriert ist ein Fehler, nicht
      „PG fehlt“. Ein explizites postgresql ohne URL bricht ab. Gewählter Provider
      bleibt bei Auth-/Netz-/Schemafehler unverändert. Shell-/lokale Entrypoints
      dürfen den zentralen Entscheid nicht durch vorzeitiges sqlite-Export
      überschreiben; App, CLI/Migrator und Compose derselben Auswahl folgen.
      Abnahme zusätzlich zur weiterhin gültigen Dual-Backend-Evidenz: direkte
      PG-URL und PG-Secret ohne Selektor wählen PG; file-URL/SQLite-Secret und
      fehlende Konfiguration wählen SQLite; beide expliziten Provider funktionieren;
      alle Widerspruchs-/Secret-/PG-Ausfallfälle abort ohne Ersatzdatei. URL nie
      loggen. Tests für Resolver, beide Startwrapper und gebaute Images erweitern;
      `docs/database-backends.md`/`.env.example` entsprechend angleichen. Historische
      Produktgates nicht als Nachweis dieser noch fehlenden Auswahl ausgeben.
      Auswahlkorrektur abgenommen 30.09.2026: Der gemeinsame Resolver inferiert
      den Provider aus direkter URL oder sicher aufgelöster Secretdatei; fehlende
      Konfiguration bleibt SQLite. Explizite Provider sind optionale Assertions.
      Shell-Entrypoints exportieren keinen vorzeitigen SQLite-Default; lokale
      Start-/DDL-Wrapper verwenden dieselbe Entscheidung. PG startet auch ohne
      Selektor im Maintenancebetrieb. 408 reguläre Tests und acht separate
      disposable PG-Tests bestanden, einschließlich echter lokaler Startwrapper.
      Neu gebaute Runner-/Migrator-Images bestehen die isolierten SQLite-
      Fresh-/Bootstrap-/Restartproben und PG-TLS-Import-/Secret-/Writeproben
      ohne Selektor. Unerreichbares PG erzeugt keine SQLite-Ersatzdatei.
      Lint, Typecheck, Format, Container-Produktionsbuild, Shellsyntax,
      Compose-Standard und Diffprüfung grün. Keine Produktionsausführung.
- [x] **P11.2 — Secretfähiger Single-Worker und vollständiger Writer-Gate.**
      Entrypoint/DB-Owner samt `src/instrumentation.ts`, Config-/Cache-, Ruleset-,
      Queue- und Worker-Schreibpfaden auf `DATABASE_URL_FILE` vor Prozessstart und
      getesteten Maintenancebetrieb bringen. URL nur im Prozessspeicher, DEBUG-
      URL-Ausgabe entfernen; leere/konfligierende Konfiguration ablehnen.
      Readiness/Settings/History lesen ohne Cache-, Setting- oder Workerwrite;
      tatsächlichen ersten Anwendungsschreibvorgang als Rollbackgrenze erfassen.
      Pool/TLS/Timeouts für den gewählten Provider/Transport anpassen, kein
      unbegründetes `pgbouncer=true`; Single-Worker bleibt. Abnahme: Secretfehler,
      Netzverlust/Reconnect und alle Writeentrypoints getestet, Wartungslesechecks
      erzeugen null Writes und PG-Ausfall keinen zweiten Datenbestand.
      Secretauflösung und Fehlerredaktion mit beiden ausgewählten Providern
      prüfen; weder URL, Passwort noch Integrationstoken in Logs, CLI-Argumenten,
      Fixtures, CI-Artefakten oder staged Git-Diff. Nur ignorierte lokale
      Konfiguration bzw. gemountete Secretdateien verwenden. Keine konkrete
      Host-, Proxy-, Swarm- oder Secretmanager-Topologie voraussetzen.
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
      PG-Harness; echter Transport-/TLS-/Rollenvertrag bleibt bei PG-Wahl P11.3/P10.
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
      Ergänzung 30.09.2026: Bei fehlenden Hilfsbinaries installiert weder
      ein Wartungs-GET noch eine ORF-Suche yt-dlp/FFmpeg nebenbei; der
      Proxy-Netzwerktest-POST ist im Wartungsmodus gesperrt. Kausale Tests
      sichern den unterbliebenen Fetch und Dateischreibversuch. Andere
      Nebenpfade und die dauerhafte Grenzmarkierung bleiben zu prüfen.
      Nachtrag: Die zweite native PG-Migration ergänzt den ausschließlich
      zielseitigen `MigrationCheckpoint`. Vor dem ersten Fachwrite wird er
      in einer unabhängigen Transaktion dauerhaft gesetzt; ein verweigerter
      Checkpoint-Insert verhindert den Fachwrite. Disposable PG-Tests prüfen
      Maintenance ohne Marker, den ersten Write mit Marker sowie ein
      eingeschränktes Rollenprofil ohne Insert-Recht. Der Marker kann
      konservativ zu früh entstehen; externe Writer und das endgültige
      Rollbackverfahren bleiben Betriebs-Gates.
      Abschließendes Pfadreview 30.09.2026: Alle aktuellen App-Modellwrites
      in Settings/Config, Regeln/Kategoriecache, Queue/Retry/History und Worker
      sind am Prisma-Owner geschützt; App-Raw-SQL dient derzeit ausschließlich
      lesenden Größenabfragen. Zusätzlich schützen `$executeRaw` und
      `$executeRawUnsafe` nun Maintenance und durable PG-Checkpoint; beide
      gesperrten Raw-Writeformen werden gegen SQLite und PG geprobt.
      Unbekannte zukünftige `$queryRaw`-Schreibfunktionen werden nicht als
      sicher behauptet; neue Owner müssen weiterhin als Ganzes reviewt werden.
      Persistierter Reconnectgate im PG-Harness: Nach den parallelen Owner-
      Suiten nur den eigenen Loopback-Container pausieren, System-API 500
      ohne Fallback/Dateiänderung prüfen, unpause und API 200 plus gleiche
      Configmenge/leeren Maintenance-Checkpoint lesen. Socket-/Pool-/Connect-
      Budgets sind im Test begrenzt. Containername UND publizierter Port müssen
      zur disposable URL passen; finally und Harness-EXIT lösen eine eigene
      Pause vor Cleanup. Elf PG-Gates lokal erfolgreich; kein fremder
      Dockercontainer oder produktiver Endpunkt betroffen.
      Aktuelle Entwicklungsprüfung: Sämtliche heutigen Modellmutationen,
      Transaktions- und Raw-Execute-Formen sowie Queue-/History-/Worker-
      Eingänge im Wartungsmodus geprüft; alle sechs Mengen und der durable
      Checkpoint bleiben unverändert. Zwölf gesonderte PG-Gates grün,
      einschließlich begrenztem Netzverlust/Reconnect ohne SQLite-Fallback.
      Entwicklungsabnahme: 584 reguläre Tests, zwölf separate PG-Gates,
      Lint/Typecheck/Format und Build grün. Fork-CI `36779944035` und Docker-
      Validierung `36779943995` für `811b621` erfolgreich. Der erste Docker-
      Lauf fand einen --rm-/Namensreuse-Race des Testharness, nicht des Produkts;
      eigener Stop+Remove wird jetzt vor Wiederverwendung vollständig abgewartet.
      Der SQLite-Smoke und TLS-PG-Smoke mit immutable Post-write-Rollback wurden
      lokal erneut erfolgreich ausgeführt. Keine Produktionsfreigabe.
- [x] **P11.3 — Read-only Preflight mit explizitem Fidelityvertrag.** Einen
      versionierten Preflight unter `scripts/` mit Referenz auf alle sechs Modelle
      bauen: tatsächlicher Sourcepfad/Mount/WAL/SHM, Spalten/Indizes/Ledger/Typen,
      Bootstrap-Drift, Platz, Tool-/Imageversion und Zielidentität feststellen.
      Serverversion gegen Prisma-6-Kompatibilität/Support prüfen, Primary/TLS/
      gewählte Route/Rolle verifizieren; keine Version aus fremdem Projekt schätzen.
      Preserve/Normalize/Reject für jedes Feld festlegen: externe Serien-IDs,
      UUID/CUID/FK/Unique, NULL, UTC-/Millisekunden, BigInt >2^53, JSON-/Regex-
      Strings, Config, alle Job-/Cache-/Regeldaten. Keine erfundenen now/0/Leerwerte
      bei Bootstrapabweichung. Abnahme: bekannte Quellen typisiert erkannt,
      unbekanntes Schema/Zeiteinheit oder fremdes Ziel abort; Read-only erzeugt
      keine Quell-/Zieldatenänderung und Bericht keine geheimen Payloads.
      Entwicklungsabnahme gegen synthetische Quellen und disposable PG;
      konkrete Produktionsversion/-route/-rolle erst bei gewähltem Cutover in
      P10.2 prüfen. Direkte PG-Verbindung ist ein gültiger Testfall; ein Proxy
      darf nicht Voraussetzung der CLI, des Images oder der Abnahme sein.
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
      die Inhaltsprüfung läuft erst auf dem privaten Snapshot. Ein Zieltest
      mit scoped Rolle gegen disposable PG 17 bestand ohne TLS-Ausnahme im
      Testharness; die feldweise Fidelitymatrix steht im Migrationsplan.
      Produktionsbelege für Transport/TLS/Version, Runner/Image und echte Quelle
      bleiben bei einem gewählten Cutover P10.2 vorbehalten; ihre Abwesenheit
      blockiert keine rein disposable Entwicklungsabnahme.
      Reviewkorrektur 30.09.2026: Der Preflight sperrt abgekündigte PG-Majors
      sowie nach ihrem datierten Supportende auslaufende Majors; explizite
      Prisma-6-Matrix statt aktueller Major-Doku. Nichtleere SQLite-Ledger müssen
      zur erkannten Kontur passen und vollständige Originalchecksums tragen.
      Nach DDL wird das echte PG-Katalogschema read-only gegen den generierten
      Client/Schema geprüft, einschließlich Defaults, Indizes/FK und unerlaubter
      zusätzlicher Relationen/RLS/Trigger. Richtige Ledgernamen allein reichen
      nicht; veränderte Checksums oder offene Fehlversuche brechen ab. Negative
      disposable Katalog-/Ledgerproben ergänzen die bisherigen Eingangsprüfungen.
      Zusätzlich erkannte SQLite-Drift: Teilindizes und abweichende Collations
      wurden zuvor nicht in der Kontur verglichen. Der Schemaowner berücksichtigt
      nun Partialstatus/Schlüsselrichtung/Collation; kausale Negativfälle und
      explizite verwaiste Episodenprüfung brechen vor jedem PG-Fachwrite ab.
      Der eigenständige Preflight-Report v2 nennt Node-/Prisma-Clientversion,
      schemaName/schemaOid und Zielkontur ohne Nutzlast. Ein Wechsel des
      Schemas derselben DB ist kein identischer Importlauf; ein anderer
      Transaktionsserver/-namespace wird vor Import/Verify/Sequences abgelehnt.
      Entwicklungsabnahme mit `19951c5`/`811b621`, denselben grün ausgeführten
      regulären/PG-/Container- und Fork-Gates wie P11.2. Alle sechs Feldverträge,
      historische/aktuelle Konturen und negative Identitäts-/Ledger-/Katalog-
      Fälle geprüft. Echte Produktionswerte bleiben ausdrücklich P10.2.
- [x] **P11.4 — Konsistenter Snapshot und eigener leerer Zielbereich.** Im
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
      Aktueller Guard: `prepare` prüft den privaten, integren Snapshot und
      das echte Ziel VOR DDL. Scoped DDL-Rolle, bereits provisioniertes Schema,
      keine administrativen Rollen-/DB-Anlagen. Fremde Tabellen/Sequences,
      nicht existierender Namespace, aktive Zeilen oder Checkpoint abort;
      vollständig vorbereiteter leerer Stand ist noop. Synthetische beschädigte
      Quelle bleibt unrepariert, WAL-Hauptdatei und WAL-Bytes unverändert.
      Realer nativer DDL-Lauf plus Wiederholung in eigener disposable Kontur
      und derselbe CLI-Ablauf zweimal im TLS-Container-Smoke erfolgreich.
      Entwicklungsabnahme mit den P11.2-Gates: gültiger WAL-Snapshot,
      beschädigte/FK-verletzte Quelle, fremde/eigene nichtleere Ziele,
      scoped DDL-Rolle und idempotente native Vorbereitung geprüft.
      Keine SQLite-Quelle repariert und keine fremden Daten/Grants verändert.
- [x] **P11.5 — Typisierter Import und sichere Resume-Grenzen.** Den neuen
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
      vollständige Crash-/Resume-Vertrag und operatorfähige Sequenz-/Abnahme-
      CLI fehlen.
      Ergänzung 30.09.2026: Ein privates 0600-Manifest bindet Snapshot-Hash,
      Importer-/Schemahash sowie Zielversion, DB-OID, Host und Rolle. Ein
      simulierter Absturz nach Transaktionscommit vor Manifestabschluss wurde
      durch read-only Zeilenvergleich erkannt und als derselbe Lauf finalisiert;
      fremde Identität abort. Ein injizierter Abbruch nach bereits importierten
      Eltern/Config-Zeilen rollte die ganze PG-Transaktion zurück; derselbe
      Pending-Lauf konnte danach aus dem leeren Ziel neu starten. Noch offen:
      vollständige Operatorabläufe und Sequenz-Resume unter Fehlern.
      Der Runner enthält einen expliziten `import`-CLI-Einstieg, der privaten
      Snapshot, Hash, DB, Rolle, Endpoint und bestätigte gestoppte Writer
      verlangt; er ist ohne TLS-Ausnahme und führt keine Sequence-Korrektur
      oder App-Umschaltung nebenbei aus. `verify` ist nur auf einem validierten
      Manifest lesend, `sequences` ist ein separater bestätigungspflichtiger
      Schritt nach demselben Vergleich. Ein Runbookentwurf liegt unter
      `docs/postgresql-migration-runbook.md`; seine End-to-End-Abnahme fehlt.
      Entwicklungsabnahme mit den P11.2-Gates und realem CLI-Containerpfad:
      alle sechs Modelle, Transaktionsabbruch, Post-commit-Manifestabbruch,
      Pending-Resume und validierter read-only Repeat geprüft. Geänderte Quelle,
      fremde Zeile sowie gleicher DB-Name mit anderem Schema abort ohne Übernahme.
      Manifest bindet auch Schema-OID; die Transaktionsverbindung wird separat
      gebunden. Kein Atomaritätsversprechen für DDL/Rollen/Sequences.
- [x] **P11.6 — Reale Sequences und semantischer Verifier.** Im neuen
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
      Der Sequence-CLI-Schritt fordert ausdrücklich sowohl gestoppte Writer
      als auch den belegten Zustand ohne jeglichen App-Write seit dem Import;
      bloß wieder leere Tabellen erlauben keinen rückwärts gesetzten Zähler.
      Import und Sequence-Korrektur prüfen zusätzlich den persistenten
      `MigrationCheckpoint` und brechen bei einem App-Write-Versuch ab.
      Eine disposable PG-Probe simulierte einen Fehler nach bereits wirksamem
      `setval`, prüfte das Importmanifest nochmals lesend und wiederholte die
      Synchronisierung erfolgreich. Weitere Sequenzdrift- und Kollisionsfälle
      sowie die durable App-Write-Grenze bleiben offen.
      Reviewkorrektur 30.09.2026: Sequence-Pläne werden vollständig geprüft,
      bevor das erste nichttransaktionale `setval` ausgeführt wird. Zyklische,
      fremd zugehörige und durch Inkrement erschöpfte Sequences brechen ab.
      Der CLI verwendet auch den geprüften Snapshot-Höchststand für tatsächlich
      korrespondierende AUTOINCREMENT-Spalten: eine gelöschte SQLite-ID 1000
      wird im realen PG-Inserttest nicht wiederverwendet, nächste ID ist 1001.
      Entwicklungsabnahme mit den P11.2-Gates: semantischer Vergleich sämtlicher
      Fachspalten und Mengen, gleich große veränderte Daten, leere/nonempty
      Sequences, gelöschte hohe IDs, Ownership-/Overflow-Fehler und Fehler nach
      setval samt sicherem Repeat. Durable App-Checkpoint sperrt Rücksetzen;
      echte neue Prisma-Inserts kollisionsfrei. setval bleibt nicht rückrollbar.
- [x] **P11.7 — Dual-Backend-Harness beweist Runtime und beide Rückwege.**
      `src/lib/db-schema.test.ts`, passende Ownerintegration und neue Runner-
      Tests gegen disposable SQLite und PG aufnehmen; `vitest.config.ts`/
      npm-Gates so routen,
      dass Tests außerhalb `src/**/*.test.ts` nicht unbemerkt fehlen. Fresh Install,
      Bestandsimport aller Modelle, CRUD/Settings, Queue/History, Regeln/Caches,
      Restart, BigInt/Datum/NULL, Secret-/DB-/Reconnect-Ausfall, Retry/Resume und
      Maintenancewrite-Sperre kausal testen. Vor erstem PG-Write immutable altes
      SQLiteimage+Quelle zurück; danach gestoppte Writer+PG-Backup und ein
      getestetes PG-kompatibles Rollbackimage mit erhaltenem PG-Datenstand.
      Abnahme: kein SQLite-only/Tabellenname-Regex-Ersatz,
      beide Rollbackfälle geprobt und Grenzen ehrlich dokumentiert, Daten/Backups
      bleiben erhalten; ungeprüfter PG-kompatibler Rollback sperrt PG-
      Schreibbetrieb. Eine Rückschaltung auf SQLite nach PG-Writes bleibt
      ohne P11.9 gesperrt, nicht der Proxy-Ausstieg auf SQLite.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Die PG-Gates
      erreichen auch Tests außerhalb `src/`; disposable PG-17-Proben decken
      native Katalogtypen/Indizes/FK, alle sechs Importmodelle,
      Maintenance-/Schreibsperre, Runtime-CRUD, Abbruch/Resume, BigInt und
      Sequence-Inserts ab. Der gebaute Snapshot-Runner hat einen real sichtbaren
      Bind-Mount benutzt; der App-Maintenance-Start veränderte auf einem ebenso
      geprüften Mount keine Sentinel-Metadaten. Noch offen: Worker-/Datei-
      abschluss, gewählter Transport-/TLS-Fall, PG-kompatibler Rollback nach
      PG-Writes
      und ein kompletter Container-End-to-End-Lauf.
      Ergänzung 30.09.2026: Echte PG-Ownerreads für SAB-Queue/-History,
      Ruleset-GET und TopicCategory-Cache laufen auch bei gesperrten Writes;
      der synthetische Queue-Statuswechsel und Settings-API-Save/Readback
      wurden in PG gelesen. Worker-/Dateiabschluss, breitere Fehlerfälle und
      der separate Produktiv-Rollback bleiben weiterhin offen.
      Ein eigener Fork-CI-Job startet jetzt eine kurzlebige, nur an Loopback
      gebundene PostgreSQL-17-Instanz, spielt die native Prisma-Migration auf
      zwei Testdatenbanken ein und führt Katalog-/Runtime- sowie scoped
      Import-/Resume-Proben aus. Der identische `npm run test:pg`-Ablauf
      bestand lokal und im Fork-CI-Lauf 36656647880 (beide Jobs grün).
      Die additive Checkpoint-Migration und Rollen-Grenztests bestanden
      im Fork-CI-Lauf 36657639865; die zugehörige Docker-Build-Validierung
      36657639887 war ebenfalls grün. Ein vorheriger CI-Lauf fand einen
      Start-Race im Testharness (Socket statt finalem TCP-Server); die
      korrigierte TCP-Bereitschaftsprüfung wurde erneut erfolgreich ausgeführt.
      Ein separater Container-Smoke führte lokal Snapshot→native Migration→
      Import→Verify→Sequences→Wartungs-API-Read→ersten PG-Write mit Checkpoint
      gegen eine disposable PostgreSQL-17-Instanz mit echtem TLS aus. Er
      verwendete keine private Quelle und keinen HAProxy; der entsprechende
      Fork-CI-Lauf steht noch aus. Der Rückweg nach PG-Writes und der echte
      Betriebsvertrag bleiben offen.
      Der erste GitHub-Smoke stoppte an einem Linux-Bind-Mount-Rechteunterschied:
      privater Snapshot unter Host-UID, Import unter Image-UID. Die disposable
      Probe verwendet nun dieselbe UID für beide Schritte; eine erneute
      Fork-Ausführung ist erforderlich. Der produktive Backup-Mount braucht
      weiterhin einen eigenen Rechte-Preflight für die feste Runner-UID.
      Erneute Fork-Abnahme: CI 36658718136 und Docker-/TLS-Container-Smoke
      36658718093 sind grün. Der UID-Fehler war auf den synthetischen
      Harness begrenzt; die privaten Betriebsrechte bleiben ungeprüft.
      Ergänzung 30.09.2026: Der lokale TLS-Container-Smoke übernimmt synthetische
      Daten aller sechs Modelle und probt optional den Rückweg nach einem
      Settingswrite mit Checkpoint und zwei Serien am selben Topic. Writer
      stoppen, privates PG-Dump, Restore in eine neue disposable DB und
      semantischer Fingerprint sämtlicher Fachspalten plus Checkpoint;
      danach ein anderes immutable PG-kompatibles App-Image lesend auf
      demselben PG-Stand. Settings/History/beide Regeln und unveränderter
      Fingerprint bestätigt; kein SQLite-Fallback. Dieser Rückweg ist ohne
      `PINGUFUNK_SMOKE_ROLLBACK_IMAGE` ausdrücklich nicht geprüft. Der Standard-
      Fork-Smoke enthält noch kein separat gebautes älteres Rollbackimage;
      finaler P09-Worker-/Schema- und Rollbackgate bleiben offen.
      Aktualisierte lokale Reviewprobe: 579 reguläre Tests und zehn gesonderte
      PG-Tests erfolgreich; Typecheck, Lint, Produktformat und gebaute Runner-/
      Migrator-Images grün. Der TLS-Smoke einschließlich privatem Backuprestore
      und immutable PG-App-Rollback bestand auch nach Einführung der strengeren
      Katalog-/Checksum-Prüfung. Die beiden beim Aufbau der neuen Prüfung
      gefundenen Defaultdarstellungsfälle (Prisma-BigInt-String und PG-E-Literal)
      wurden korrigiert und gegen reale Schema-Defaults erneut geprüft.
      Abgenommen 01.10.2026: Fork-CI 36798866207 und Dockerprobe 36798866196
      erfolgreich. Bootstrap und aktueller SQLite-Schemastand mit P09-Payloads
      durchlaufen TLS-Import, semantischen Vergleich, native Starts und Writes.
      Im selben Cutover wurden vor PG-Writes das immutable alte SQLiteimage
      auf unveränderter Quelle und nach PG-Writes Backuprestore plus ein
      anderes immutable PG-Image geprüft. Letzteres ist ausschließlich ein
      lesender Wartungsrollback, kein freigegebener älterer Worker. Echte
      Medienabschlüsse, Restart und DB-Ausfall-/Weckrufrecovery auf beiden
      Backends bestanden; kein Rücktransfer nach SQLite oder Produktionszugriff.
- [x] **P11.8 — Operatorfertiges Runbook aus realen Commands.**
      `docs/postgresql-migration-plan.md` als Referenz und ein zugehöriges Runbook
      mit tatsächlich implementierter CLI/Flags, dry/read-only Preflight,
      Schreibfreigabe, Stop/Backup/Prepare/Import/Verify/Maintenancestart/Pause/
      Resume/Rollback pflegen. Exact Image-/Tool-/Schemaidentität und erforderliche
      private Betriebswerte nur als redigierte Eingaben, keine Beispielcredentials.
      Abnahme: Runbook an frischer und migrierter disposable Installation vollständig
      nachvollziehbar; keine fingierten fertigen Deploykommandos, Retention/
      Cleanup braucht separate Freigabe und Proxyrollback behält den gewählten
      Provider bei. Falls P11.9 umgesetzt wird, den geprobten PG→SQLite-
      Rücktransfer samt Stop-, Prüf- und Freigabegates ergänzen; dessen
      Zurückstellung blockiert P11.8 nicht.
      Zwischenstand 30.09.2026 (noch **nicht** abgenommen): Ein ausdrücklich
      nicht produktiv freigegebener Entwurf unter
      `docs/postgresql-migration-runbook.md` verwendet die tatsächlich
      vorhandenen Snapshot-/Preflight-/Import-/Verify-/Sequences-Einstiege,
      trennt DDL- und Importsecret sowie die drei Rollbackgrenzen. Noch offen:
      vollständige Docker-End-to-End-Probe und Writer-/Rollback-Harness.
      Private Transport-/TLS-/Rechtewerte gehören beim optionalen Cutover in
      P10.2 und sind kein zusätzlicher Entwicklungsabschlussgate.
      Der Snapshot-Einstieg wurde im gebauten Image mit tatsächlich sichtbarem
      Bind-Mount unter UID 1000 erprobt; ein erster Test unter einem vom
      Docker-Host nicht geteilten Temp-Pfad war ungültig und wurde verworfen.
      Abgenommen 01.10.2026: `docs/postgresql-migration-runbook.md` enthält
      tatsächlich ausgeführte Commands für beide Quellvarianten und getrennte
      immutable Rückwege, Image-/Schemaidentitäten, private Secretdateien,
      Wartungs-/Writegrenzen und Restore in eine neue DB. Die vollständige
      disposable Forkprobe 36798866196 ist grün. Private Installationswerte,
      produktive Mountrechte, Retention und Schreibfreigaben bleiben P10.2;
      keine fertige private Deploymentkonfiguration wird vorgetäuscht.
- [ ] **P11.9 — Optionaler verlustfreier PG→SQLite-Rücktransfer nach PG-Writes.**
      Zuerst Aufwand anhand der sechs Modelle, späterer Schemaerweiterungen und
      vorhandener Import-/Vergleichsbausteine begrenzt prüfen. Nur bei vertretbarem
      Zusatzaufwand umsetzen; andernfalls den konkreten Aufwandbefund direkt
      hier festhalten und den Punkt offen zurückstellen. Die Backendwahl und
      der getestete PG-kompatible App-Rollback bleiben davon unabhängig. Ein
      eigener, ausschließlich bei gestoppten Writern ausführbarer Runner liest
      einen konsistenten PG-Stand mit eingeschränkter Rolle und schreibt in eine
      **neue** private SQLite-Datei mit zur Imageversion passender SQLite-
      Migrationskette. Niemals die alte Quell-/Rollbackdatei überschreiben.
      Alle sechs fachlichen Modelle sowie spätere P07/P09-Spalten, originale
      IDs/FK/Unique, Config/Secrets, Queue/History, BigInt, Zeitpräzision und
      NULL semantisch gleich übertragen; PG-only-Betriebsmarker nicht als
      Fachdaten vortäuschen. SQLite-Sequences/Defaults und echte neue Prisma-
      Inserts prüfen. Danach beide Seiten zeilenweise ohne Nutzlastausgabe
      vergleichen, `integrity_check`/`foreign_key_check` ausführen, Dateieffekte
      und Jobzustände separat abstimmen und die Umschaltung erst nach expliziter
      Freigabe zulassen. Abbruch/Retry/Fehler nach Teilimport dürfen weder PG
      noch alte SQLite-Datei verändern; keine Secrets oder Dumps ins Git.
      Abnahme mit synthetischen Writes nach dem PG-Cutover, Restart und
      erneutem Vergleich auf disposable Backends. Solange offen: Rückschaltung
      von einem beschriebenen PG-Bestand auf SQLite gesperrt. P11.9 ist kein
      Gate für PG-Betrieb mit getesteter PG-kompatibler App-Rücknahme und kein
      Gate für SQLite-Betrieb oder Proxy-Ausstieg.
      Aufwandbefund 30.09.2026: Die sechs aktuellen Modelle sind grundsätzlich
      typisiert rückübertragbar. Ein sicherer Operatorrunner benötigt aber eine
      eigene konsistente PG-Snapshot-/Read-role-Grenze, atomare NEW-Datei-/Resume-
      Identität, semantischen Rückvergleich und SQLite-Höchststandprüfung;
      die geplanten P09-Erwartungsspalten müssen ebenfalls unverändert erhalten
      bleiben. Dafür genügt weder pg_dump noch Umkehrung einzelner Inserts.
      Vor Abschluss von P09 bewusst zurückgestellt, um keinen vorzeitig
      unvollständigen Rückweg zu behaupten. Der geprobte PG-kompatible Image-
      Rollback bleibt der verlustfreie Pflichtweg nach PG-Writes; keine
      Rückschaltung auf das veraltete SQLite. Kein offenes Gate wird entfernt.
      Erneute Aufwandprüfung 01.10.2026 nach P09: Erwartungen und Prüffakten
      liegen jetzt als versionierte nullable Texte vor und sind verlustfrei
      vergleichbar. Weiterhin fehlen jedoch ein eigener konsistenter PG-
      Lese-Snapshot, Rollen-/Resume-/NEW-Datei-Grenze und die negative
      Abbruchmatrix samt SQLite-Höchststand-/Insertprobe. Diese Grenzen sind
      nicht durch den vorhandenen Vorwärtsimport erfüllt. Der optionale
      Rücktransfer bleibt daher ausdrücklich zurückgestellt; der vollständig
      geprobte PG-Backuprestore/Wartungsrollback ist der verfügbare Rückweg.
      Das ist kein PostgreSQL→SQLite-Nachweis und keine entfernte Anforderung.

## Phase P06 — Sonarr als optionaler accountfreier Metadatenanbieter

Ergebnis: fehlende lokale Episoden sicher auffindbar. Abhängigkeit P05 und P11.1;
B08/B09. Sonarr-Key nötig, neues TVDB-/TMDB-Konto nicht.

- [x] **P06.1 — Beschlossenen Provider-/Fallbackvertrag technisch festlegen.**
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
      Nutzerentscheidung 30.09.2026: Neben exakten Episoden auch Staffel-/RSS-
      Fallbacks vorsehen. Sonarr bleibt optional, default-off und zunächst eine
      Instanz; alle Pfade verlangen verifizierte Serien-/Episodenidentität.
      Keine globale Proxy-20-Minutenheuristik übernehmen. Die ausdrückliche
      Freigabe erweitert den Suchumfang, ersetzt aber nicht API-Verifikation,
      konkrete Laufzeitpolitik oder die Abnahme des Consumers in P06.2/P06.3.
      Präzisierung des Nutzers 30.09.2026: Sonarr ergänzt zunächst nur fehlende
      Episoden; vorhandene lokale/TVDB-/TMDB-Angaben nicht ersetzen. Widersprüche
      verhindern automatische Zuordnung. Dauerprüfung konfigurierbar und soweit
      verfügbar anhand belegter Episodenlaufzeit; kurze Episoden nicht pauschal
      ausschließen, fehlende Laufzeit nicht automatisch als bestanden werten.
      RSS-Fallback ausschließlich für überwachte Serien, mit begrenztem
      Aktualitätsbereich und Abfragebudget; keine vollständige Bibliothekssuche
      bei jedem RSS-Abruf. Konkrete Einheiten, Grenzwerte/Toleranzen und Budgets
      technisch begründen, dokumentieren und mit kurzen/fehlenden Laufzeiten,
      unüberwachten Serien und Grenzfällen regressionsprüfen. Die Fachentscheidungen
      sind geklärt; API-Verifikation und technische Vertragsabnahme bleiben offen.
      Ausführbare Konkretisierung (Planungswerte, keine ausgeführte Integration):
      Der bestehende Basislookup bleibt lokale Shows → TVDB → TMDB, nur soweit
      konfiguriert. Sonarr ergänzt anschließend nach verifizierter TVDB-ID
      fehlende `(seasonNumber, episodeNumber)`-Einträge; bestehende Einträge,
      IDs, Titel, Airdates und Laufzeiten werden nicht überschrieben. Ohne
      Basisbestand ist ein vollständig verifizierter Sonarr-Serienbestand
      zulässig. Gleiches Koordinatenpaar mit widersprüchlichem Titel/Airdate
      oder mehreren Sonarr-Serien zur TVDB-ID sperrt dessen automatischen
      Fallback; keine Titelsimilarität zur Konfliktauflösung. Serienlaufzeit/
      Durchschnitt nicht als belegte Einzelepisodenlaufzeit ausgeben. Herkunft
      und Einheiten je Feld im Adaptervertrag dokumentieren.
      RSS ergänzt nur `series.monitored === true`; fehlender Monitoringbeleg
      gilt nicht als true. Explizite Einzel-/Staffelsuchen bleiben hiervon
      unabhängig. Defaultfenster: Airdate UTC in `[jetzt − 14 Tage, jetzt]`,
      fehlende/ungültige/future Airdate im Sonarr-RSS überspringen. Konfigurierbar
      auf 1–90 Tage. Pro neuem RSS-Snapshot höchstens fünf Serien, 50 passende
      Episoden und zehn zusätzliche HTTP-Versuche einschließlich Retries/
      Folgeseiten; gemeinsamer P05-Deadline maximal 15 Sekunden, kein Budget
      pro Unterabfrage neu starten. Deterministischer fortschreitender Cursor
      über überwachte Serien; nicht immer nur die ersten fünf. Cursor erst nach
      erfolgreichem Snapshot weitersetzen, Offset/Pagination bewegt ihn nicht.
      Serien-/Episodenmetadaten zehn Minuten, RSS-Ergebnis höchstens 60 Sekunden
      cachen; Budget-/Fenster-/Konfigurationsänderung invalidiert den Snapshot.
      `total` beschreibt den gefilterten Snapshot, nicht die ganze Bibliothek.
      Überwachte Serien aus einer coalesced gecachten API-Inventarabfrage
      bestimmen, keine komplette Bibliotheks-Content-Suche je RSS-Request.
      Positiv endliche Quell-Dauer in Sekunden ist Pflicht; unbekannt/0/negativ/
      NaN/Infinity ist kein gültiger Sonarr-Fallback. `matching.minDuration`
      (bestehend: 300 Sekunden) für unabhängige Bestandspfade erhalten. Bei
      belegter positiver Episodenlaufzeit E in Sekunden zusätzlich das Intervall
      `[E − Δ, E + Δ]` prüfen, Δ = min(25 % E, max(5 Sekunden, p % E));
      p konfigurierbar 0–25 %, Planungsdefault 10 %. Bei p=0 gilt exakte Dauer,
      ohne den 5-Sekunden-Sockel. Für belegte Kurzepisoden nur in diesem sicheren
      Fallback die Mindestgrenze auf min(konfigurierte Mindestdauer, E − Δ)
      reduzieren; nicht global die Bestandsfilter abschalten. Fehlt E, bleibt
      allein die konfigurierte Mindestprüfung möglich und die Sollprüfung
      ausdrücklich unbekannt; keine erfolgreiche Sollprüfung erfinden.
      Abnahme P06.1: fachlichen Lookup-/RSS-/Dauervertrag mit Units, Herkunft,
      Grenzen und API-Version schriftlich fixieren; Primärdokumentation und
      synthetische Adapterfixtures statt ungefragter Live-Bibliotheksantworten.
      API-Verfügbarkeit/Schema vor realem Betrieb am gewählten Sonarr separat
      verifizieren. Zahlen sind konfigurierbare technische Startwerte, keine
      aus Sonarr oder dem privaten Proxy abgeleiteten Tatsachen.
      Technischer Vertrag abgenommen 30.09.2026 unter
      `docs/sonarr-metadata-contract.md`: offizielle v3-OpenAPI und Sonarr-
      Controller/Mapper auf cab419ade8ac7fcab5bf80394ee492abd35d5f5a geprüft;
      Sonarr 3/4, Arrayantworten ohne erfundene Pagination, lokale Serien-ID
      getrennt von externer Serien-/Episoden-TVDB-ID. Episodenlaufzeit statt
      Serienmittelwert, UTC-Zeitpunkt statt Kalendertag. Eigenständige
      synthetische Ressourcen prüfen Parser-/Identitäts-/Monitoring-/Units-
      Grenzen in `src/services/sonarr-metadata.test.ts`. Noch kein Lookup-/RSS-
      Anschluss und kein Liveversionsnachweis: P06.2/P06.3 bleiben offen.
      Upstream 1b41ebbe6c1d988cc981675a1dd90a0e038e8400 erneut geprüft;
      TVDB-/Settingsfix, kein Sonarradapter. Nicht ungeprüft integriert.
      Verifikation: 29 neue synthetische Parserfälle, insgesamt 437 reguläre
      Tests, Lint, Typecheck, Format und Produktionsbuild grün. Die acht PG-
      Gates und isolierten Containerproben aus P11.1 werden für dessen
      unveränderte DB-/Runtimeinputs wiederverwendet; Parser ist noch kein
      integrierter Sonarr-Consumer und benötigt keine neue UI-Abnahme.
- [x] **P06.2 — Sicherer Provider mit vollständig fehlertolerantem Consumer.**
      Ergänzungsbefund erneut abgenommen 05.10.2026 auf `b189bf2`: 998 reguläre
      Tests, Lint/Types/Format/Build und Fork-CI 37323756642 einschließlich
      separater PG-Integration grün. Docker-Gate 37323756720 mit nativen
      Consumer-/Medien-/beiden Backendprüfungen erfolgreich. Lesende native
      Staffelsuche über unveränderten Sonarr-/Prowlarr-Pfad bestätigt vollständige
      sechs-/vierteilige deutsche Treffer ohne Rejections. Private Betriebswerte
      bleiben im privaten Runbook; kein Grab oder neuer Importnachweis.
      Am 05.10.2026 für den Ergänzungsbefund erneut geöffnet: neue Bibliotheks-
      serien dürfen nicht an einem zehn Minuten alten Inventar scheitern.
      Ein gezielter Missing-ID-Refresh im selben Budget, keine negativen
      Seriencaches und validierte globale Aliasse sind implementiert und
      kausal regressionsgeprüft. Frühere Abnahme unten bleibt historisch;
      neue Fork-CI/Consumerprüfung vor erneutem Schließen nachweisen.
      Neuen Sonarradapter in `shows.ts`/TV-Suchowner anschließen, P05-Secret-/
      Budget-/Cachegrundlagen nutzen, nur GET und Base-URL-Unterpfade. Serien-ID,
      Instanz und Episode verifizieren; veralteter Bestand ohne gewünschte Folge
      wird gezielt ergänzt, API-Ausfall nicht erfolgreich leer gespeichert.
      Abnahme: Missing-Episode, falsche Instanz/ID, Rotation, Timeout/401/429,
      Cacheexpiry/-coalescing und default-off mit synthetischer API getestet;
      keine APIkeys/echten Bibliotheksantworten im Browser oder Git.
      Producer-/Consumerowner gemeinsam bewegen: `shows.ts` darf eine lokale
      Trefferliste nicht vor Ergänzungsprüfung vorzeitig zurückgeben;
      Newznab-TV-Route, `mediathek.ts` mit `fetchSearchResultsById` und
      `fetchSearchResultsForRssSync` sowie Cachekeys verwenden denselben verifizierten
      Ergänzungsbestand. Keine Metadaten/RSS-Ausfallantwort als erfolgreich leeren
      Cacheeintrag speichern. Unabhängig belegte Bestandstreffer bleiben nutzbar;
      ein nur durch ausgefallenen Sonarr belegbarer Request meldet 503, nicht
      fingierte Identität oder Empty-Erfolg. Noch nicht fertig aufgebaute Sonarr-
      RSS-Snapshots nicht teilweise publizieren. Secretrotation/Instanzwechsel
      trennt Cache und inFlight; alte Antworten dürfen neue Epochen nicht füllen.
      Konfigurationsowner `src/lib/settings.ts`, Settings-API und `/settings` →
      Matching/Integrationen für Fenster, Mindestdauer und Toleranz zusammenführen;
      validierte Zahlen mit sichtbaren Units, persistenter Reload/Readback,
      serverseitige APIkeys/Secretdateien, default-off ohne Sonarr-Netzverkehr.
      Desktop-only QA samt Screenshot/Konsole für neu sichtbare Controls.
      Abnahme zusätzlich: Merge ohne Überschreiben, widersprüchliche Koordinaten,
      gecachte lokale Serie mit fehlender neuer Folge, unüberwachte/Monitoring-
      unbekannte Serie nicht in Sonarr-RSS, zukünftige/fehlende Airdate,
      Fenstergrenzen, Rotation über mehr als fünf Serien, stabiles RSS-Offset/
      total, Budget einschließlich Retry/Folgeseite, Abbruch ohne Teilsnapshot
      und invalidierte spät eintreffende Antworten kausal testen. Bestehende
      RSS-/Validierungsfeeds und die gesamte RSS→NZB→Queue-Kette regressionsprüfen.
      Teilfortschritt 30.09.2026, keine Abnahme: `HttpRequestBudget` zählt
      Retries/Unterabfragen gemeinsam (maximal zehn Versuche/15 Sekunden).
      `createReadOnlyArrJsonClient` hält ein Credential pro Operation fest,
      verwendet GET/Header/Unterpfad und den gemeinsamen
      `readBoundedProviderJson`-Owner mit Mediathek. Arr 5 MiB, Mediathek
      weiterhin 8 MiB, maximal 8.192 nichtleere Chunks, striktes UTF-8;
      Header-/Body-/Parsezeit gehört zur selben Deadline. Fehlertexte bleiben
      generisch; Timeout wartet nicht auf eine hängende Streamcancellation.
      Noch kein Sonarr-Netzconsumer aktiviert und keine neuen UI-Controls;
      Provider/Cache/Merge, Budgetdurchreichung durch die Suchkette, RSS-
      Snapshots und Desktop-UI-Abnahme bleiben hier offen. Nebenfund im
      bestehenden Download-Retry-Test behoben: vorheriger Erfolgstest drainiert
      seinen asynchronen Workerstart vor dem nächsten negativen Fall; dessen
      No-Start-/Historyschutz-Assertions unverändert. 457 reguläre Tests, Lint,
      Typecheck, Format und Build grün; keine realen APIs/DBs/Medien verwendet.
      Implementierungscheckpoint 30.09.2026 (Abnahme noch offen): P06.2-Provider,
      nicht überschreibender Merge, gemeinsames HTTP-/Zeitbudget durch Arr,
      Mediathek und bei gemischten Basissuchen SRF; bounded RSS-Snapshot mit
      Cursorrotation, 50-Episoden-Cap und 60s-Pagination. Derselbe neue
      Schlussfilter schützt Exact/Staffel/RSS vor falscher Serie, Jahr,
      Koordinaten, Laufzeit, Fassung und HLS/DASH/unsicherer URL. Legacy-Fuzzy-
      Regeln bekommen ausschließlich Basisepisoden. Synthetischer vollständiger
      API→lokale Missing-Episode→Sonarr→RSS→NZB→Queue-API-Pfad grün;
      Sonarr-Outage lässt unabhängig belegte Basis-Suche/RSS nutzbar.
      Desktop-only `/settings` → Matching auf einem neu erzeugten SQLite-
      Testbestand: Default-off, ungültiges Fenster, Speichern, Reload und
      API-Readback geprüft; tatsächliche Vorher-/Nachher-Screenshots betrachtet,
      Konsole ohne Warnungen/Fehler. Kein Netzwerkzugriff auf reale Sonarr-
      Bibliotheken. Finaler Gesamtlauf/Fork-CI und Scope-Review stehen noch aus;
      deshalb keine Checkbox geschlossen und P07 noch nicht begonnen.
      Finale Entwicklungsabnahme: 524 reguläre Tests bestanden; die sechs
      dort getrennt gerouteten PostgreSQL-Tests nicht als ausgeführt gezählt.
      Acht Gates in `npm run test:pg` separat erfolgreich. Lint, Formatcheck,
      Build und nach Korrektur einer Testmock-Typdeklaration Typecheck grün.
      Gesamter Provider-/Merge-/Cache-/Budget-/RSS-/Settings-Consumer nochmals
      gegen den Vertrag geprüft. Fork-CI 36751264194 und Docker-Validierung
      36751265752 für Implementierungscommit 4573b80 erfolgreich, ohne
      Veröffentlichung oder produktive Zugriffe. Desktop-Evidenz wie oben;
      API-/RSS-/NZB-/Queue-Regression einschließlich unabhängiger Basistreffer
      bei Sonarr-Ausfall bestanden. Dies ist Entwicklungsabnahme, kein
      Nachweis der Version oder Bibliothek einer produktiven Sonarr-Instanz.
- [x] **P06.3 — Titelkandidaten auf sichere Identität begrenzen.**
      Ergänzungsbefund erneut abgenommen 05.10.2026 mit den frischen Gates von
      P06.2: generische Metadatentitel bei verifizierten Koordinaten/Laufzeiten,
      eindeutige vollständige ARTE-Staffel und unverändert negative Konfliktfälle.
      Native sechs-/vierteilige Staffelsuche akzeptiert jede reguläre deutsche
      Episode mit korrektem S01/Enn; keine Profil- oder Bibliotheksänderung.
      Quellen-/Workerprüfung und beide Persistenzbackends separat grün;
      lesende Trefferabnahme ist ausdrücklich keine produktive Importabnahme.
      Am 05.10.2026 für generische Metadatentitel erneut geöffnet: exakte
      Serien-/Aliasbindung, explizite Quellkoordinaten und bekannte passende
      Solllaufzeit gemeinsam verlangen. Konkrete Titelkonflikte nicht lockern.
      ARTE-Bruchteile nur bei geprüftem Programm und vollständigem eindeutigem
      Einzelstaffelbestand; nie pauschal S01. Synthetische sechs-/vierteilige
      Staffelsuche bis RSS/NZB/Queue geprüft; frische Consumer-/CI-Abnahme offen.
      TV-Suche/`newznab.ts` mit vollständigem Episodentitel oder letztem
      Separatorsegment ≥3 Zeichen nur innerhalb gesicherter Serie, Jahr/
      Serienpräfix, Quellkoordinaten und beschlossener Dauerpolitik matchen.
      Trailer/AD/Klare Sprache nach P03-Vertrag, unsichere URLs und Konflikte
      ablehnen. Sonarr-Fallback vor P09 nur direkte progressive HTTP(S)-Renditions.
      Abnahme: synthetische Tatort-Missing-Episodes und Jahres-/Titelkonflikte
      nachgewiesen; Unbekanntes erhält nie angefragte S/E/TVDB-Identität.
      Dauerprüfung an derselben Schlussfilterstelle vor Dedupe/Limit/total für
      Einzel-, Staffel- und Sonarr-RSS-Fallback anwenden. Grenztests mit belegter
      120-Sekunden-Folge trotz bestehender 300-Sekunden-Mindestdauer, genau auf/
      knapp außerhalb der Toleranz, p=0 und fehlender Soll-/Quell-Dauer. Gleich
      benannter kurzer Trailer, falsches Jahr, fremde Serie und widersprechende
      Quellkoordinaten dürfen keine Request-Identität erhalten; Dauer allein
      beweist keine Episode. HLS-Sperre nur für diesen Fallback bis P09.2 erhalten.
      Abgenommen mit P06.2: gemeinsamer Schlussfilter in
      `src/services/sonarr-matcher.ts`, 28 fokussierte Matcherfälle und
      integrierte Exact-/Staffel-/RSS-Consumer. Verifizierte 120s-Episode,
      inklusive Toleranzgrenzen, p=0, unbekannte Laufzeit, Jahr-/Serien-/Titel-/
      Koordinatenkonflikte, Trailer und unsichere einzelne Renditions geprüft.
      Progressive URL-Endungen sind kein Containerbeweis; die tatsächliche
      Dateivalidierung bleibt ausdrücklich P09 zugeordnet.

- [x] **P06.4 — Breite TV-Suche und TBA mit Quellenkoordinaten.**
      Nutzerauftrag 06.10.2026, Owner `tv-search-terms.ts`, `sonarr-provider.ts`,
      `sonarr-matcher.ts`, `mediathek.ts`, `sonarr-rss.ts` und `newznab.ts`;
      abhängig von P06.2/P06.3, keine Lockerung konkreter Konflikte.
      Bis sechs OR-Abfragen über Namen/Aliasse/eindeutig gebundene Regel-Themen
      im bestehenden 32-/10-Versuche- und 15s-Budget. Sammel-/Mehrserienthemen
      nicht als Identität verwenden. RSS-Duplikate und Regel-Cacheinvalidierung
      prüfen; erfolglose Folgesuche liefert keine Teilmenge/Empty-Erfolg.
      TBA/TBD und passende generische Titel verlangen gesicherte Serie, explizite
      vollständige S/E, validierten Sonarr-Bestand und bekannte passende Dauer.
      Bestehende Metadaten bleiben unverändert; RSS übernimmt den Quelltitel.
      Abnahme: kausale positive/negative Matcher- und Merge-Regressionen,
      Alias-/Regel-Themenabfrage bis RSS/NZB/Queue einschließlich Pagination,
      budgetierte RSS-/Cachetests, native Sonarr-TBA-Suche direkt und über
      Prowlarr gegen eigene unüberwachte Fixture ohne Grab, Vollsuite/Lint/
      Typecheck/Format/Build, Fork-CI und beide bestehenden Backendgates grün.
      Vertrag `docs/tv-search-contract.md`; Nutzerklarstellung 06.10.2026:
      Einzel-/Staffelsuche für tatsächlich verfügbare Mediathek-Vorabfolgen
      ohne Sperre anhand des späteren TV-Termins, zusätzliche RSS-Grabs sind
      dafür nicht erforderlich. Das getrennte RSS-Datumsfenster bleibt erhalten.
      Produktionsrollout ist nun separat freigegeben; echte Grabs/Importabnahme
      sind damit nicht beauftragt. Keine Profil-, Bibliotheks- oder DB-Änderung.
      Entwicklungsabnahme 06.10.2026 auf `aefa709`: 1018 reguläre Tests,
      Lint/Typecheck/Format/Build grün. Fork-CI 37380855999 mit separatem PG-Gate
      und Docker-Validierung 37380856018 vollständig bestanden. Native Sonarr-
      TBA-Suche direkt und via Prowlarr, 720p/UNKNOWN-/Konfliktvarianten,
      SQLite-/PG-Persistenz, echte synthetische Medien und Rollback geprüft;
      keine Image-Publikation, Grabs oder produktive Mutationen.

## Phase P07 — Allgemeines ARTE-Matching statt Titel-Allowlist

Ergebnis: identitätsgesicherte Mehrserien-/Sprachzuordnung. Abhängigkeit P06;
B04/B05/B06, R3.

- [x] **P07.1 — Regelquelle und Identität gemeinsam korrigieren.**
      `src/services/rulesets.ts::{loadRulesets,getRulesetsForTopicAndTvdbId}`,
      `src/services/ruleset-generator.ts` und `data/rulesets.json` prüfen:
      Remote-main wird vor lokal geladen, daher Quelle/Version/Updateweg explizit
      festlegen. Regel 109 mit generischem ARTE-Topic auf gesicherte Serienidentität
      eingrenzen statt pauschaler Occupied-Zuordnung; fehlgeschlagene Regeln dürfen
      gültige generische Kandidaten nicht endgültig entfernen. Abnahme: lokale
      Änderung tatsächlich verwendbar, Remoteausfall kompatibel, fremde Serien
      nie Occupied und keine dauerhafte All-the-Sins-/Titel-Allowlist.
      Implementierungscheckpoint: `docs/ruleset-sources.md` definiert gebündelte
      imagegebundene Regeln als Standard und eine explizite `RULESETS_URL`-
      Opt-in-Quelle mit geprüftem Katalog, begrenztem HTTP und lokalem Fallback.
      Der gemeinsame Shared-Topic-Guard verlangt belegten Seriennamen/Alias
      im Titel; Regel 109/deren ID bleibt erhalten. Fehlerhafte oder erfolglose
      Regeln verbrauchen neutrale Textkandidaten nicht. Auto-Regeln verwenden
      weder beliebige Einzel-Topics noch ähnlich benannte Fortsetzungen als
      Serienbeweis. Regelkontext ist Teil der TV-/RSS-Ergebnis-Cachekeys;
      ein Quellenrefresh lässt veraltete Antwortkeys nicht wiederverwendbar.
      542 reguläre Tests und alle normalen Gates grün; eine zusätzliche
      kausale Cachewechselprobe anschließend fokussiert erfolgreich. Finaler
      Fork-CI-Lauf/Abnahme noch offen, keine Bestandsmigration ausgeführt.
      Finale Abnahme für 738a35b: Fork-CI 36753440953 und Docker-Validierung
      36753440947 erfolgreich. Insgesamt 543 Tests einschließlich der kausalen
      Cachewechselprobe im Fork bestanden. Kein Schema-/Betriebswrite in P07.1.
- [x] **P07.2 — Auto-Regeln für gemeinsam genutzte Topics.**
      `ruleset-generator.ts::{getGeneratedRulesetByTopic,getGeneratedRulesetByTvdbId}`,
      `GeneratedRuleset` und alle Read/Writeconsumer auf nachgewiesene kombinierte
      Serien-/Topicidentität bringen statt globalem Topic-Unique. Schlüsselumfang
      aus realen Consumers ableiten und vor Schema-Cutover festlegen; nötige
      append-only Migrationen für beide Provider samt Datentransition/Rollback
      mitliefern, keine
      TopicCategory-Unique beiläufig ändern. Abnahme: zwei Serien im selben Topic
      können Regeln laden/generieren ohne Überschreiben/Fehlzuordnung; vorhandene
      IDs/Regex/Filter bleiben erhalten und Migration auf Bestand getestet.
      Vor der ersten neuen SQLite-Schemaänderung beide Bestandsformen prüfen:
      vollständige angewandte Prisma-Kette und historisches Bootstrap mit leerem
      Ledger. Einen geprüften, idempotenten Baselineübergang für letzteren
      mit Backup/Schema-/Datenvergleich liefern; kein blindes Ledger-Adoptieren,
      kein SQL-Replay über vorhandene Tabellen. Source-/Zielversion und
      Gegenprobe auf beiden disposable Backends gehören zur P07.2-Abnahme.
      Implementierungscheckpoint (noch offen): beide Schemas/Clients verwenden
      `(tvdbId, topic)`; additive Indexmigrationen und scoped Generierung/Read,
      keine Änderung an TopicCategory. `scripts/sqlite-baseline.mjs` baut aus
      privatem Snapshot eine neue migrierte SQLite-Datei, vergleicht sämtliche
      Rohwerte aller sechs Modelle, erhält IDs/Sequenzhochstände und führt
      deren Ledger tatsächlich aus. Quelle unverändert, identischer Repeat
      lesend und Fremd-/Driftbestand abort. Baseline-/SQLite-Runtimeproben grün;
      ein bevölkerter alter PG-Regelbestand wurde in isoliertem Schema migriert
      und auf zwei Serien plus unveränderte Originalwerte geprüft. Neun
      separate PG-Gates bestanden. Container-/finale Consumer-/Fork-Abnahme
      bleibt offen; keine produktive Migration. Ablauf und Rückweg unter
      `docs/sqlite-baseline-transition.md`.
      Abnahmecheckpoint: 553 reguläre Tests, Lint, Typecheck, Formatcheck und
      Produktionsbuild erfolgreich; sieben PG-Fälle dort bewusst getrennt,
      neun Gates separat grün. Neue Runner-/Migrator-Images bestehen SQLite-
      Fresh-/Bootstrap-Baseline-/Write-/Restartproben und PG-TLS-Import/Verify/
      Sequences/Maintenance/Checkpoint. Vor neuen Zielwrites startete das
      verifizierte Vor-P07-Image mit der ursprünglichen Bootstrap-Datei im
      Maintenancebetrieb; Settings korrekt, Sourcehash unverändert. Dieser
      optionale Vorimage-Rollback wurde lokal ausgeführt, nicht als Fork-CI-
      Prüfung behauptet. Manifest bindet zusätzlich tatsächliche Zieldatei-
      Identität; geänderte/fremde Daten und nicht erfüllbare Pflichtwerte
      abortieren ohne Quelländerung. Final abgenommen mit Commit `96a570e`:
      Fork-CI `36756864402` und Docker-Buildvalidierung `36756864457` erfolgreich,
      ohne Imagepublikation oder produktive Migration.
- [x] **P07.3 — ARTE-Varianten über gesicherte Quelle auflösen.**
      Ergänzungsbefund erneut abgenommen 05.10.2026 auf `b189bf2`, Fork-CI
      37323756642 und Docker-Gate 37323756720 erfolgreich. Native Sonarr-Suche
      über Prowlarr akzeptiert alle vier regulären deutschen ARTE-Folgen mit
      korrekten Koordinaten und tatsächlich belegtem WEBDL-720p. Keine Wildcard-
      CDN-Freigabe, HLS-Sprachübertragung oder produktiver Grab. Quellen-/Worker-
      Konfliktfälle bleiben streng; P03.4s umfassender Sprachbefund bleibt offen.
      Am 05.10.2026 für den HLS-only-Playerbefund erneut geöffnet: vorhandene
      indexierte MP4s nach Player-ID/Titel/Koordinaten/Rechteprüfung erhalten,
      ohne Mehrspur-HLS auf eine MP4-Tonsprache zu übertragen. Exakten HbbTV-
      URL-/Programmbeleg vor Sprachwahl nutzen. Positive Staffelfälle und
      unverändert strenge Konfliktfälle grün; frische Consumer-/CI-Abnahme offen.
      Quellengegencheck fand zusätzlich den bisher ausgeschlossenen offiziellen
      ARTE-CDN `arteptweb-a.akamaihd.net`. Nur diesen exakten Host ergänzt, kein
      neues Wildcardnetz; Producer-/Workerbeleg und negative Nachbardomains
      regressionsgeprüft. Öffentliche reale vierteilige Quelle liefert danach
      vier normal-deutsche Episoden mit begründetem Staffel-/Sprachbeleg,
      ohne produktive Suche, Grab oder Import. Native Abnahme bleibt separat.
      ARTE-Kandidatensuche/Providerconsumer über Titel/Alias plus sichere Serie
      und gleiche Video-ID zur passenden DE-Fassung führen; deren Koordinaten
      und tatsächlichen Sprachstatus erneut prüfen. B04-Fallback hat weiterhin
      exakte Abschlussfilter und P05-Budget, keine Locale=Audio-Annahme.
      Abnahme: zwei Serien/gleiches Topic, fehlende DE-Fassung, OV/AD, APIausfall
      und paginierte Kandidaten fail closed; korrekte Varianten reihenfolgeunabhängig.
      Implementierungscheckpoint 30.09.2026, noch keine finale Fork-Abnahme:
      `arte-editions.ts` prüft offizielle Video-ID, bekannte Serienpräfixe,
      Player-ID/-Titel/-Koordinaten, Rechte und versionspezifischen Audiocode.
      Neue progressive URLs benötigen eine eindeutige indexierte Qualitätsfassung
      derselben Video-ID; keine Locale=Audio- oder beliebige URL=720p-Annahme.
      Deutsche Titel dienen zur begrenzten Nachsuche, URL-Felder sind beim
      Provider nicht suchindexiert. Player und Nachsuchseiten teilen zehn
      Versuche/15 Sekunden. Gemeinsame Topicconsumer nutzen nur lokale oder
      bereits verifizierte Metadaten, keine neue externe Metadatenkaskade.
      Sprachselektion erfolgt nach Auflösung; Quellcaches behalten Rohkandidaten,
      damit Regeländerungen nicht alte ARTE-Zuordnungen übernehmen. TV-ID,
      regelgebundene Text-/Koordinatensuche, RSS und optionaler Sonarr nutzen
      den Adapter; der jeweilige Episoden-/Dauerfilter bleibt zuständig.
      Quellen-/Stopvertrag und Beweisgrenzen unter
      `docs/arte-edition-contract.md`. Synthetische Zwei-Serien-RSS→NZB→Queue-
      Probe, Ausfall ohne Teilresponse, OV/AD, widersprüchliche Audiocodes,
      Qualitäts-/ID-Konflikte und Folgeseitenfehler sind implementiert.
      Final abgenommen mit `1c7124e`: 573 reguläre Tests, Lint, Typecheck,
      Formatcheck und Build grün; Fork-CI `36761536896` und Docker-/TLS-/
      SQLite-Buildvalidierung `36761536831` erfolgreich, ohne Publikation.

## Phase P08 — Ein gemeinsamer Indexer mit ehrlichen Kandidaten und Arr-Metadaten

Ergebnis: Sonarr/Radarr nutzen Pingufunk direkt oder über Prowlarr als
Newznab-Indexer; MediathekView und vorhandene Provider bleiben Videoquellen.
Abhängigkeit P07; B01/B11–B13, A5, R1/R2.

Verbindliche Nutzerentscheidung 01.10.2026: **Ein gemeinsamer Endpunkt und
derselbe Suchvertrag für direkte und über Prowlarr vermittelte Anfragen.**
Keine zusätzlichen Manual-Endpunkte, getrennten Indexerinstanzen oder
vorausgesetzten Sync-Profile. Gezielte Suche und RSS anhand ihrer tatsächlichen
Parameter unterscheiden, nicht mit interaktiv/automatisch gleichsetzen.
RSS ist ein eigener Aktualitätslauf, nicht zwingender Bestandteil jeder
gezielten Suche. Plausible, nicht abschließend identifizierte Kandidaten dürfen
ausgegeben und in der Arr-GUI manuell zugeordnet werden. Ihre Ausgabe ist
keine garantierte Auto-Grab-Sperre: Arr kann einen Kandidaten selbst akzeptieren.
Keine fremde Rejection-/Confidence-Unterstützung oder Sicherheit durch ein
freies XML-Attribut behaupten. Unsicherheit niemals durch erfundene
Request-IDs, Produktionsjahre, Koordinaten oder Sprache verdecken.

- [x] **P08.1 — Optionale strukturierte Metadaten statt Senderseiten-Parser.**
      `src/services/sonarr-provider.ts`, neuer Radarr-Metadatenowner,
      `src/lib/read-only-arr-client.ts`, Settings-/Secret-/Cacheowner und
      `docs/movie-source-evidence.md`: vorhandene Sonarr-Anbindung erhalten,
      optional eine explizit konfigurierte Radarr-Instanz unterstützen.
      Standardmäßig deaktiviert; kein zusätzlicher TVDB-/TMDB-Nutzeraccount,
      keine verpflichtende Arr-Instanz. Lokale Arr-API-Keys ausschließlich
      serverseitig aus Umgebung/Secretdatei, GET-only, Base-URL-Unterpfade,
      Versions-/Schemaschutz, Rotation, gemeinsame P05-Budgets und Bodylimits.
      Titel/Originaltitel/Aliase, IDs, Jahr, Episodenkoordinaten und belegte
      Laufzeit verwenden; Units einmal nach Sekunden normalisieren.
      Bestehende ausdrücklich konfigurierte Metadatenprovider erhalten.
      Keine neuen ARTE-HTML-/Flight- oder ARD-Seiten-/Gateway-Filmparser:
      die isolierten Versuche sind verworfen und samt ihren ausschließlich
      zugehörigen Fixtures aus dem aktiven Code zu entfernen. Allgemeine
      Bodyreader und unabhängig abgenommene P07-Playerintegration erhalten.
      Zentrale Sonarr-/Radarr-Metadatendienste nicht still als zugesicherte
      Drittanbieter-API aktivieren; ein solcher Anbieter braucht einen separat
      geklärten Nutzungs-/Schema-/Verfügbarkeitsvertrag, keine kopierten Keys.
      Abnahme: synthetische positive/negative API- und Consumerfälle,
      deaktiviert ohne Secret-I/O/HTTP, keine Writes, keine Secrets im Browser,
      Fehlern, URLs, argv oder Git; Ausfälle nicht erfolgreich leer cachen.
      Fehlende Metadaten stoppen nur die davon abhängige ID-Auflösung,
      nicht eine unabhängig mögliche ehrliche Text-Kandidatensuche.
      Abnahme 01.10.2026: optionale Radarr-API v3/6.x, deaktiviert ohne
      Credential-/HTTP-I/O, GET-only und Subpaths, Rotation, bounded Bodies,
      gemeinsame Budgets, strenge Parser/IDs sowie maskierte Settings belegt.
      Source-Seitenversuche entfernt, allgemeine Reader/P07 erhalten.
      Zusätzlich überwachte Film-Recent-Ziele aus begrenzter Bibliotheksliste
      (2.000 Zeilen/5 MiB/60s), keine lokalen Library-IDs/Paths/Keys im Ergebnis.
      Synthetische direkte/vermittelte ID-/RSS-Abfrage einschließlich
      RSS→NZB→Queue, Monitoring, Pagination und Providerfehler ohne
      Teilbestandcache erfolgreich. Keine reale Instanz angebunden.
- [x] **P08.2 — Kanonischer Suchkontext und ehrliche Releaseidentität.**
      Newznabroute, `src/services/movie-matcher.ts`, `src/services/tmdb.ts`,
      neuer Radarr-Owner und
      `mediathek.ts::{fetchMovieSearchResults,fetchMovieSearchByQuery}`
      für `t=movie`/`t=search` mit Filmkategorie,
      q/IMDb/TMDB/Jahr, ID-only und q+ID gemeinsam überarbeiten.
      Ganzzahlige IDs vollständig prüfen; widersprüchliche IDs/Titel/Jahre
      ablehnen statt Queryjahr über Metadatenjahr zu setzen. Suchziel-Metadaten
      sind kein Nachweis für jeden gefundenen Mediathekbeitrag.
      Sicher zugeordnete Ergebnisse dürfen begründet kanonisch formatiert werden;
      unsichere Kandidaten behalten Quelltitel, Quelle und vorhandene Angaben,
      ohne Suchziel-ID/Jahr/Koordinaten oder falsches Film-/Sprachlabel.
      Ausstrahlungsdatum niemals als Produktionsjahr verwenden.
      Keine automatische/kollektive Umbenennung beliebiger Magazine, Clips,
      Remakes oder Sequels in den gesuchten Film. Original- und Alternativtitel
      nur aus belegten Metadaten; IDs nur nach tatsächlicher Zuordnung.
      Abnahme: sichere Treffer plus unaufgelöste plausible Kandidaten,
      Metadatenkonflikte, fehlendes Jahr/ID/Dauer, gleiche Titel verschiedener
      Werke und alle Routeformen; generische Nichtfilmverträge erhalten.
      Wiedereröffnet 03.10.2026: Nutzerfreigabe für Metadatenkorrelation bei
      exaktem vollständigem Quelltitel/belegtem Alias, bestätigter Laufzeit
      mit anfänglich ±10 % (inklusive Grenzen) und ±1 Jahr Mindesttoleranz
      zwischen vorhandenem Quell-/Suchjahr und Metadatenjahr. Fehlendes
      Quelljahr darf nach dieser Prüfung ergänzt werden, Ausstrahlungsjahr
      und beiläufige Beschreibungsjahre nicht. Unbekannte Laufzeit, Fuzzy,
      Titelkonflikte und mehrdeutige RSS-Remakes bleiben unbestätigt.
      Historische pauschale Nichtkorrelation wird damit ausdrücklich ersetzt.
      Erhalt: Fassungen/Sprache, vorherige generische Film-GUIDs und aktuelle
      Medien-URL durch RSS→NZB→Queue. Abnahme ergänzt die Grenzwerte ±10 %,
      ±1 Jahr und jeweils unmittelbar außerhalb, sowohl ID-Suche als auch RSS.
      Erneut abgenommen 03.10.2026 auf Produktcheckpoint `55edcf7`: exakte
      Titel-/Alias- und Laufzeitkorrelation, fehlendes Quelljahr, inklusive
      Grenzen, nicht kumulierbare Jahrestoleranz, unbekannte Laufzeit,
      Clips/Fuzzy/Konflikte und mehrdeutige RSS-Ziele kausal geprüft.
      Generische Film-GUIDs und aktuelle NZB-Medien-URLs bleiben erhalten.
- [x] **P08.3 — Begrenzte Kandidatensuche ohne vorgespielte Gewissheit.**
      Film-/TV-Consumer, Content-Search und gemeinsame Release-/NZB-Owner:
      vollständige Titel/Aliase/Episodentitel sowie begrenzte markante Wörter
      und Umlautvarianten als Suchbegriffe nutzen. Begriffe, Pagination,
      Metadata-Lookups und Retries teilen P05-Gesamtbudget.
      Vor Dedupe/Pagination/total Quellrenditions, Sprache/Fassungen und
      tatsächliche Zuordnung auswerten; sicher erkannte Konflikte nicht durch
      fuzzy-Ranking überschreiben. Ranking kann plausible Kandidaten ordnen,
      beweist aber keine Identität. Keine global neue 60-Minutenheuristik;
      belegte Kurzfilme erhalten, unbekannte Soll-Laufzeit bleibt unbekannt.
      Dauerprüfung mit dokumentierten Units/konfigurierbarer P06-Regel,
      fehlende Laufzeit nicht als bestanden deklarieren. Kein Vorab-Mediengrab.
      Abnahme: korrekte Reihenfolge/Counts/IDs/Titel/aktuelle Medien-URLs,
      Varianten vor Pagination, Quellenfehler ohne partiellen Erfolg oder
      Empty-Success-Cache, bounded Requests und RSS→NZB→Queue-Konsistenz.
- [x] **P08.4 — Direkter und Prowlarr-vermittelter Arr-Verbrauchervertrag.**
      `src/app/api/newznab/route.ts`, vorhandener API-Alias, RSS-/NZB-Owner,
      Sonarr-/Radarr-Consumerregressionen und Cutover-Runbook:
      gleiche Caps/Kategorien/Anfrageparameter, stabile Quell-/Fassungs-GUIDs,
      Pagination und Downloadlinks für beide Zugriffswege sichern.
      Keine zuverlässige Calleridentität oder interaktiv/automatisch aus
      IP, User-Agent, RSS, `t=search` oder Prowlarr-Weiterleitung ableiten.
      Die optionale Metadatenanbindung ist separat an Arr konfiguriert;
      Prowlarr ist kein allgemeiner Proxy ihrer lokalen Metadaten-APIs und
      übermittelt nicht automatisch deren Bibliothek oder API-Keys.
      Gegen versionierte Arr-Parser/Decision-/Override-Consumer reviewen,
      welche unveränderten Quelltitel sichtbar/manuell zuordenbar sind und
      welche Ergebnisse schon vor der GUI verloren gehen. Keine garantierte
      Anzeige jedes beliebigen Kandidaten behaupten. Synthetische Proben
      für ID-/Text-/RSS-Anfragen und direkte/vermittelte Links ausführen.
      Dokumentieren, dass Arr die automatische Auswahl verantwortet und
      ehrliche unbekannte Felder keine garantierte Ablehnung bewirken.
      Abnahme: reproduzierbare Consumer-Evidenz, kein zweiter Modus/Endpunkt,
      keine produktiven Suchläufe, Grabs oder Instanzänderungen ohne Freigabe.
      Wiedereröffnet 03.10.2026: Frühere Consumerprobe mit bereits im
      Quelltitel vorhandenem Jahr bewies die neue Metadatenkorrelation nicht.
      Isolierte echte Radarr-/Prowlarr-Probe muss jetzt einen Film ohne
      Quelljahr korrekt parsen/zuordnen, nicht bloß einen abgelehnten Treffer
      anzeigen. Optionalen Metadatenzugriff separat prüfen; Prowlarr-Sync
      allein richtet ihn nicht ein. Bibliotheksantworten bleiben bounded
      (2.000 Zeilen, `integration.radarr.inventoryMaxMiB`: Default 10 MiB,
      konfigurierbar 1–64 ganze MiB), einzelne Lookups 5 MiB. Ungültige Werte
      abbrechen, Limitänderung invalidiert Bibliotheks-/Suchcaches; lokale TMDB-Auflösung
      vor externem Lookup. Produktionsabnahme bleibt gesondert dokumentiert,
      Tests starten keine realen Downloads.
      Erneut abgenommen 03.10.2026: isolierte echte Radarr 6.4.4.10685 /
      Prowlarr 2.6.5.5623 auf Runner `55edcf7` ordnen den synthetischen Film
      ohne Quelljahr direkt und vermittelt der tatsächlichen Movie-ID/TMDB-ID
      und dem kanonischen Jahr zu; kein Grab. Ein erster Suchversuch vor
      nativer Indexer-Readiness war leer und ist keine positive Evidenz;
      spätere begrenzte Read-only-Probe bestand sämtliche Assertions.
      873 reguläre Tests, Lint, Typecheck, Formatcheck und Build grün;
      zwölf bedingte PG-Tests nicht im regulären Lauf, separate native PG-
      und Docker-/Dual-Backend-Gates in Fork-CI `37135870734` / `37135870743`
      erfolgreich. Bodylimit-Validierung, Abbruch und Cachewechsel geprüft.
      Produktive Freigabe/Readback sind private Betriebsunterlagen; korrekte
      Filmzuordnung ist kein Nachweis deutscher Tonspuren oder garantierter
      Freigabe durch das unveränderte Arr-Sprachprofil.

Implementierungscheckpoint 01.10.2026, keine vollständige P08-Abnahme:
der gemeinsame Filmkontext prüft q/IMDb/TMDB/Jahr inklusive Konflikten;
Radarr ist optional, standardmäßig aus, GET-only und derzeit auf API v3/6.x
begrenzt. Derselbe Handler verarbeitet direkte und vermittelte Anfragen.
Die verworfenen Senderseiten-Filmadapter sind entfernt; Quellkandidaten
übernehmen keine Anfrage-IDs/Jahre oder unbelegte Sprache. Begrenzte
Titel-/Alias-/Umlaut-/Wortsuche teilt den Callerbudget-Owner; Metadatenfehler
verhindern nicht automatisch eine unabhängig mögliche Textsuche.
Synthetisch gesichert: Quellen-/Suchzieltrennung, Kurzfilmeinheiten,
Konflikte, Secretmaskierung, Rotation/Budget, direkte/forwarded Film-Route
sowie identischer RSS→NZB→Queue-Pfad. Lokal 635 Tests erfolgreich, zehn
unverändert bedingte PG-Gates nicht in diesem regulären Lauf ausgeführt;
Lint, Typecheck, Formatcheck, Build und diff-check erfolgreich. Lockfile,
Schema und DB-Runtimewriter unverändert; keine neue PG-Abnahme behauptet.
Offen bleiben insbesondere Film-Recent/RSS statt Validierungsfeed,
TV-Kandidaten ohne sichere Koordinaten, vollständige verbleibende
Callerbudget-Kette und tatsächliche Arr-/Prowlarr-Consumerabnahme.
Alle vier Checkboxen bleiben bis zum vollständigen Kriteriennachweis offen.
Details und versionierte Primärquellen in
docs/movie-source-evidence.md; GUID-Übergang im Cutover-Runbook.

Fortschritt 01.10.2026 nach dem obigen Zwischenstand:
Film-Recent/RSS ist kein Validierungsfeed mehr: überwachte optionale Radarr-Ziele
werden gegen ein begrenztes aktuelles Sourcefenster geprüft. Ohne Filmkontext
ehrlich leer, kein beliebiger TV-Langbeitrag als Film und kein manuell/automatisch-
Zweitmodus. Nicht parsebare RSS-Titel können beim Arr-Consumer entfallen;
ein leerer Feed kann beim dortigen Indexertest beanstandet werden. Das ist in
der Fachreferenz ausdrücklich beschrieben, kein bereits freigegebener Betrieb.
Neutrale TV-Kandidaten ohne Quellkoordinaten sind ergänzt; erkannte Nachbarn,
Daily-Date-Fehler und verifizierte Sonarr-Zuordnungen dürfen nicht über diesen
Fallback erneut erscheinen. Der kompakte zentrale SxxEyy-Parser und ein neuer
Sonarr-Doppel-/Nachbarfall schützen diese Grenze. Der TV-Textfallback erhält
den ursprünglichen ID-Callerbudgetscope.
P08.3 bleibt wegen älterer TVDB-/TMDB-Serienanbieter, GitHub-Showrefresh und
Regel-Metadatenauflösung offen: dort ist der vollständige Gesamtbudget-
Nachweis noch nicht erbracht. P08.2/P08.4 nicht allein aus diesem Teilstand
schließen; P09 weiterhin nach vollständiger P08-Abnahme.

Weiterer Budgetcheckpoint 01.10.2026: Basislookup, TVDB-Login/Serie,
TMDB-Find/Details/alle Staffeln, initialer/überfälliger Show-/Regelkatalog,
Regel-Metadaten und automatische Regelgenerierung teilen nun den Callerbudget.
Keine ungezählte Hintergrundaktualisierung aus Vordergrundsuchen;
explizite Caller erben kein fremdes Coalescing-Budget. TVDB-Fehler kann ein
konfiguriertes TMDB innerhalb der verbleibenden Versuche auffangen;
erschöpfter Scope wird nicht zurückgesetzt. Sonarr-RSS reserviert fünf
Versuche für das Hauptfenster, ohne eigenes zusätzliches Requestbudget.
Gemeinsame begrenzte Titel-/Umlaut-/Wortterme auch für TV; exakte Episode
nutzt ihren belegten Titel, höchstens drei Begriffe/1.500 Sourcezeilen je
TV-Begriff. Union und Quellidentität bleiben vor Sprache/Pagination.
Kausale Regressionen prüfen mit dem echten Retry-Client Fehlidentität,
Bodylimit, teilweises TMDB-Staffelversagen, Budgeterschöpfung,
TVDB→TMDB-Retrykaskade, Regelgenerierungsfehler und RSS-Reserve.
662 reguläre Tests, Lint, Typecheck, Formatcheck, Build und Diffcheck grün;
zehn bedingte PG-Tests nicht in diesem Lauf ausgeführt. Keine Schemaänderung.
Checkboxen P08.2–P08.4 nicht allein mit diesem Checkpoint schließen;
vollständige Consumer-/Scopeabnahme vor P09 bleibt erforderlich.

Abnahme P08.2–P08.4 am 01.10.2026 nach vollständigem Ownerreview:
Suchziel und Quelle bleiben getrennt; keine Film-ID wird aus bloßer
Titel/Jahr/Laufzeit-Korrelation erfunden. Belegte Kurzfilmkorrelation,
fremde IDs/Jahre/Titel, unbekannte Felder und generische Nichtfilmverträge
sind gesichert. Bekannte TV-Nachbarn und Daily-Date-Konflikte werden nicht
durch neutrale Kandidaten wieder eingeführt. Alias-/Titel-/Episodentitel-
Union, begrenzte Seiten, Dauer/Fassung/Renditions/Dedupe vor Pagination
und gemeinsames Gesamtbudget über alle genannten HTTP-Owner geprüft.
Versionierte Sonarr-/Radarr-Request-, Newznab-RSS-, Decision- und GUI-Override-
Owner reviewt; Prowlarr-Sync nicht als Metadatenproxy interpretiert.
Ein dabei gefundener realer Fehler ist behoben: relative NZB-Enclosures
wurden im alten Test stillschweigend gegen eine Base-URL aufgelöst.
Der echte GET-/Alias-Scope erzeugt jetzt absolute NZB-Links; optionaler
öffentlicher URL-Unterpfad, parallele Caller und URL-bezogene RSS-Caches
sind getestet. Keine Forwarded-Header-/Caller-/Manuellheuristik, keine
XML-Umschreibeschicht. GUID-Werte unverändert, Hashes korrekt nicht als
Permalinks markiert. Caps-Default entspricht 100; maximal 5.000 Ergebnisse,
vollständig geprüfte eindeutige Paginationparameter vor Providerarbeit.
Direkte/vermittelte ID-, Text-, RSS-, Caps-, Download-/Queue-Pfade und
MIME/absolute Enclosures sind hermetisch abgesichert. Das ist versionierte
Quellreview plus synthetischer Fach-/Transportnachweis, keine gestartete
Arr-/Prowlarr-Instanz oder Garantie beliebiger GUI-Anzeige/Auto-Ablehnung.
Leerfeed-/RSS-Parsergrenzen und GUID-Cutover stehen weiterhin im Runbook.
P09 ist damit freigegeben; produktive P10-Gates bleiben separat.

## Phase P09 — Tatsächlicher Medieninhalt vor completed

Ergebnis: falsche/kaputte Downloads werden nicht importierbereit gemeldet.
Abhängigkeit P08; B10/R7.

- [x] **P09.1 — Erwartungs- und Legacyvertrag gemeinsam festlegen.**
      RSS/NZB-Producer, `download.ts::parseNzbContent`, `Download`-Modell und
      `download-manager.ts` gemeinsam auf verlässliche erwartete Medienmetadaten
      planen: optionale neue Felder benötigen eigene append-only Migrationen
      für SQLite und PostgreSQL sowie NZB-Kompatibilität. **Fehlende
      Legacy-Erwartungswerte vor Implementierung
      ausdrücklich entscheiden**, nicht blind fail/pass. Abnahme: persistierter
      Producer/Consumervertrag mit realen Units/Evidenz, alte NZBs weiter lesbar;
      kein Voll-Download als Voraussetzung jeder Suche und kein erfundener
      Audio-/1080p-Nachweis allein aus Quelllabeln.
      Nutzerentscheidung 30.09.2026: Alte NZBs/Jobs ohne erwartete Medienwerte
      dürfen nach grundlegender lokaler Medienprüfung weiterhin completed werden,
      sofern Audio/Video intakt und Download/Mux nachweislich abgeschlossen sind.
      Nicht vorhandene Soll-Laufzeit-/Sprach-/Auflösungswerte bleiben unbekannt;
      deren Nachweis weder behaupten noch als erfüllt speichern. Vorhandene
      Erwartungen weiter prüfen. Neue Jobs erhalten strengere evidenzbasierte
      Prüfungen; fehlende neue Pflichtwerte nicht durch Legacy-Einstufung umgehen.
      Legacy-/Neu-Unterscheidung und Probevertrag in Producer, Parser, Persistenz
      und Worker gemeinsam festlegen und positiv/negativ testen. P09.2 muss bei
      evidenzarmen Altjobs echte Defekte ablehnen, nicht unbekannte Sollwerte als
      bewiesene Samples oder umgekehrt jeden Legacy-Job pauschal als failed werten.
      Vertrag konkret: Version 1 der neuen NZB-Medienerwartungen gemeinsam in
      `newznab.ts`/Fake-NZB-Route, `download.ts::{parseNzbContent,addToQueue}`,
      `src/types`, `Download` und Worker definieren. Vertragsversion, optionale
      positive Solldauer in Sekunden, belegte Audio-/Auflösungserwartungen und
      deren Herkunft speichern; NULL bedeutet unbekannt, niemals 0/false=erfüllt.
      Fremde/negative/nichtendliche/falsch typisierte Werte und unbekannte
      Vertragsversion ablehnen; deklarierte neue Version ohne erforderliche
      Struktur nie automatisch als Legacy weiterverarbeiten. Bestehende
      unversionierte NZBs und bestehende DB-Zeilen bleiben Legacy-kompatibel;
      keine massenhafte Umschreibung oder Sollwert-Neuberechnung aus Titeln.
      Fehlender Versionsmarker beweist nicht das Erzeugungsdatum: die Einstufung
      bezeichnet Protokollkompatibilität, keine vertrauenswürdige Altersprüfung.
      Eigene neue Producer müssen den Marker immer liefern; Header-/Title-
      Fallbacks dürfen einen kaputten v1-Payload nicht auf Legacy herunterstufen.
      Für alle neuen Jobs gelten die grundlegenden Medienchecks; zusätzliche
      Sollchecks nur mit belegten Erwartungen, nicht durch erfundene Pflichtwerte.
      Append-only Migrationen für beide Provider erhalten bestehende IDs,
      Queue/History, Pfade und NULL; den historischen SQLite-Bootstrap-/Ledger-
      Übergang aus P11.1 ausdrücklich lösen, nicht mit migrate deploy blind
      adoptieren. Retry und Restart behalten Vertragsversion/Erwartungen unverändert.
      Abnahme: neue Producer→Parser→DB→Restart→Retry→Worker mit identischen
      Erwartungen, unversioniertes altes NZB mit unbekannten Sollwerten,
      neue deklarierte Version mit fehlender/kaputter Struktur abgelehnt und
      gleiche Daten-/NULL-Semantik auf beiden disposable Backends. Keine
      reine Spaltenexistenz-/HTTP-200-Abnahme.
      Abgenommen 01.10.2026: Alle RSS-/Fake-NZB- und UI-Producer liefern v1
      aus serverseitigen Ownern; Parser, beide Addfile-Routen, Queue, Retry und
      Restart erhalten belegte Sekundenwerte und explizites NULL. Beide
      append-only Schemata und alle historischen SQLite-Übergänge sind geprüft.
      Fork-CI 36798866207: 782 reguläre Tests; zwölf bedingte DB-Tests werden
      separat mit 15 Ausführungen (darunter eine SQLite-Runtimeprobe) abgedeckt.
      Desktop-UI-Consumer für Suche und HD/SD/Low einschließlich abgefangener
      v1-POSTs und gematchter Light-/Dark-Screenshots bestanden.
- [x] **P09.2 — Fertigmeldung nur nach verifiziertem Medienabschluss.**
      Manager-/FFmpeg-/yt-dlp-Owner nach Download/Mux per lokaler Probe tatsächliche
      Dauer, Audio/Video, Sprache soweit beweisbar, Auflösung und Abschluss prüfen.
      HTTP-200-HTML, nachweisbare Samples, Abbruch, fehlende Audiospur und kaputte Artefakte
      erhalten failed statt completed; P03-Sprachvertrag und P04-Isolation gelten.
      Abnahme: synthetische Medien/Processmocks mit positivem Readback, negativen
      Abbruchfällen und anschließender Queuearbeit; vorhandenes ORF-/SRF-Muxing
      erhalten. Sonarr-Fallback-HLS erst nach dieser Abnahme über vorhandenes
      Setting freischaltbar; keine globale HLS-Sperre oder ungeprüfte Aktivierung.
      Grundprüfung für Legacy und v1 an einem gemeinsamen Abschlussowner:
      nur jobeigene reguläre lokale Datei, erfolgreicher Download-/Mux-Exit,
      bei vorhandener zuverlässiger Längenangabe vollständig empfangene Bytes,
      lesbarer unterstützter Mediencontainer, mindestens eine nutzbare Video-
      und Audiospur, positive endliche tatsächliche Dauer. Coverbilder nicht
      als Videospur zählen. Probeprozess ohne Netzwerkzugriff, maximal
      30 Sekunden Wallclock und 1 MiB Ergebnisoutput betreiben; Timeout/
      Outputoverflow bricht den eigenen Prozessbaum ab und ergibt failed,
      ebenso Fehler/fehlende Spur. Keine fremden FFmpeg-Prozesse beenden.
      Probe vor persistiertem completed und importbereiter History ausführen,
      in allen progressiven/HLS-/Konvertierungszweigen; DB-/Probe-Fehler dürfen
      keine zuvor verfrühte Fertigmeldung hinterlassen. Bereits abgeschlossene
      historische Jobs nicht ungefragt erneut probieren oder umschreiben.
      Belegte Solldauer mit derselben P06-Toleranz vergleichen. Fehlende
      Legacy-Sollwerte als unknown führen, nicht als erfolgreich geprüft;
      dennoch completed bei bestandener Grundprüfung zulassen. Sprache nur
      soweit belegbar melden, keine deutschen Tags erfinden. Nachweislich
      verkürzte Dateien/Samples mit verlässlicher Solldauer ablehnen; ohne
      solche Evidenz keine vollständige Film-/Episodenidentität allein aus
      ffprobe behaupten. Prüfgrenzen dokumentieren, kein Voll-Decode behaupten,
      wenn nur Container-/Stream-/Abschlusschecks durchgeführt wurden.
      Kausale Gates: gültige Legacy-Datei ohne Erwartungen completed; gleiche
      Datei ohne Audio/mit HTML/nachweisbarer Truncation/Probe-Timeout failed; v1-Sample mit
      Soll-Dauer failed; positive progressive und ORF-/SRF-HLS-/Mux-Fälle,
      Grenzdauer und Unknown-Sprache; Medienfehler lassen bei verfügbarer DB
      den nächsten Queuejob weiterlaufen. DB-Ausfall pausiert fail closed ohne
      completed oder Spinloop, Reconnect nimmt sicher wieder auf. Retry/Restart
      erhält Status-/Erwartungsvertrag. Öffentliche
      Kategorie, Release-ID, Importpfad und Remote-Path-Mapping unverändert.

      Abgenommen 01.10.2026: Gemeinsamer lokaler Probe-/Abschlussowner in allen
      progressiven/HLS-/Muxzweigen; unbekannte Sollwerte werden nicht als
      bestanden gespeichert. Reale synthetische MP4-/HLS-/MKV-Containerproben
      auf beiden Backends, negatives Audio/HTML/Truncation/Sample, Queuefortsetzung,
      Restart und PG-Ausfall mit sicherem Weckruf bestanden. Timeout-/Output-/
      Jobpfad-/Commitfehler sind kausal getestet. Docker-Forklauf 36798866196,
      CI 36798866207 einschließlich Lint/Typecheck/Format/Build grün. HLS bleibt
      opt-in; ffprobe beweist keinen Voll-Decode oder unbekannte Inhaltsidentität.

      Wieder geöffnet 06.10.2026, enger Folgeauftrag in P12.2:
      `completeValidatedDownload` liest bei sämtlichen Jobarten den aktuellen
      Serienwert. Die ursprüngliche gemeinsame P06-Toleranz ist kein passender
      Vertrag für separat konfigurierbare Film-/Serienregeln. Identitätsvergleich
      gegen Metadaten und Dateiabschluss gegen die konkrete Quelldauer getrennt
      behandeln; alte Jobs nicht still neu klassifizieren oder umschreiben.
      Engen Folgeauftrag erneut abgenommen 08.10.2026 mit P12.2:
      neue v3-Jobs halten beide bekannten Dauerreferenzen mit Herkunft und
      jeweiliger Regel fest; spätere Matchingänderungen verändern sie nicht.
      Reale synthetische Medienworker auf SQLite/PG prüfen unabhängige
      Metadaten-/Assetabweichung, Film/Serie/Unknown, HLS, Restart und Retry;
      Legacyprüfungen bleiben erhalten. CI 37704788531 und Containerkette
      37704788439 auf `4dc280c` bestanden. Keine historischen Jobs umgeschrieben,
      keine Inhalts-/Sprachvollabnahme oder echte Arr-Importabnahme behauptet.

- [x] **P09.3 — Katalog-Qualitätsfeld von belegter Auflösung trennen.**
      Separater Befund beim P03.4-Review: `newznab.ts` behandelt `url_video_hd`
      pauschal als 1080p, obwohl darin eine tatsächliche 720p-Fassung liegen kann.
      Tonsprachenbeleg ist kein Dimensionsbeleg. Vor einer neuen Auflösungszusage
      gemeinsame Rendition-/Titel-/GUID-/Erwartungs-/Worker-Owner prüfen; bekannte
      Provider-Dimensionen nur an die exakte Medien-URL binden, Unbekannt nicht
      umetikettieren und keinen Senderseitenparser hinzufügen. Historische
      Qualitäts-/GUID-/History-Verträge und mögliche Doppelgrabs ausdrücklich
      bewerten. Abnahme: synthetische echte 720p-Fassung im HD-Feld, konkurrierende
      SD/HD-URLs, fehlende/widersprüchliche Maße, native Consumer-Zuordnung und
      positive/negative Workerchecks. Keine ungefragte Neubewertung importierter
      Dateien oder Veränderung produktiver Profile. Dieser neue offene Befund
      nimmt die historische Grundprüfung P09.2 nicht zurück und gehört nicht zur
      Tonsprachenabnahme P03.4.
      Abgenommen 04.10.2026: gemeinsame Renditionauswahl,
      exakt gebundene optionale ARTE-Maße, UNKNOWN ohne implizites WEB-SD-Label,
      historische Slot-GUIDs und per-URL-NZB-Erwartungen implementiert.
      Vertrag/Grenzen in `docs/rendition-quality-contract.md`. 965 reguläre
      Tests, Lint, Typecheck, Formatcheck und Build grün; separate PG-Integration
      in Fork-CI 37167389069 erfolgreich. Docker-Gate 37167389065 auf `38836c5`
      bestanden: echte isolierte Radarr 6.4.4.10685 direkt/via Prowlarr 2.6.5.5623
      und Sonarr 4.0.20.3014 als nativer Parser des tatsächlichen Titelsuffixes
      erkennen 720p im HD-Slot als WEBDL-720p, fehlende/widersprüchliche Maße als
      Unknown. Drei neue interne Testkonturen, kein Grab. Reale synthetische
      1280×720-Datei besteht Workercheck; falsche Höhe und falsche Breite bei
      gleicher Höhe werden auf SQLite und PG abgewiesen. v1/v2-Sollmaße bleiben
      über Queue/Restart/Retry erhalten; bestehende TLS-/Rollback-/PG-Ausfall-
      Gates ebenfalls grün. Kein vollständiger neuer Sonarr-Importnachweis,
      kein Produktivrollout, Profilwechsel oder Bestandsrewrite. Andere Quellen
      ohne vorhandenen Dimensionsbeleg bleiben UNKNOWN; konkrete Auswahl bleibt
      dort historischer Slothinweis, kein Mindestauflösungsfilter. Mögliche
      neu sichtbare URLs/Upgrades im Cutover-Vertrag berücksichtigt. P03.4 offen.

- [x] **P09.4 — Sichere Transferdiagnostik und isolierte Reproduktion.**
      Nutzerauftrag 03.10.2026: bestehende progressive Workerpfade in
      `download-manager.ts` statt generischer Sammelfehlermeldung mit begrenztem
      Phasen-/Byte-/HTTP-/Allowlistcode-Vertrag über `download-failure.ts`
      diagnostizieren. Keine URLs, Rohfehler oder privaten Providerantworten;
      keine neuen Retries, Profile, Timeouts, DB-Spalten oder Produktivgrabs.
      Fehlertext in bestehender Failed-History und nach DB-Reconnect erhalten.
      Abnahme: nativer Loopback-HTTP-Abbruch nach echten Bytes, Redirect-Grenze,
      Gzip/positiver Transfer, Dateifehler/Open-Race, DB-Fortschrittsfehler,
      Inaktivität und Secret-Negativtests; kein Probe/completed bei Transferfehler,
      eigene Partialdateien bereinigen, Nachbarziele erhalten, Queue fortsetzen.
      Vollständige Test-/Lint-/Typecheck-/Format-/Build-Gates und Ownerreview;
      Grenzen in `docs/download-failure-diagnostics.md`. Reproduzierte Fehlerklasse
      nicht als nachträglich bewiesene Produktionsursache behaupten. Produktion
      und erneute Downloadbeauftragung bleiben separat freizugeben.
      Implementiert und lokal reviewt 03.10.2026: 48 fokussierte Owner-Tests,
      930 reguläre Tests; 13 bedingte PostgreSQL-Gates separat. Nach `npm ci`
      mit Node 26.10.0 bestanden Lint, Typecheck, Formatcheck, Build und Diffcheck.
      Ein anfänglicher Open-Listener-Typfehler wurde korrigiert, alle relevanten
      Gates danach erneut ausgeführt. Die 14 vorhandenen Turbopack-Tracing-
      Warnungen bleiben sichtbar. Entwicklungsabnahme auf Produktstand `fc99caf`:
      [Fork-CI](https://github.com/superions/pingufunk/actions/runs/37150444785)
      mit Node 24 einschließlich separater PostgreSQL-Integration erfolgreich.
      Dokumentationsabnahme verändert die Produktinputs nicht; diese Evidenz
      bleibt gültig. Keine Produktivursache oder produktive Installation behauptet.

- [x] **P09.5 — ZDF-/ARD-MP4-Dimensionen aus begrenzten Quellenproben.**
      Nutzerauftrag 06.10.2026; Owner `mp4-audio-language.ts`, `source-audio.ts`,
      bestehender Rendition-/RSS-/NZB-/Workervertrag; abhängig von P09.2/P09.3.
      Im vorhandenen höchstens viermal 1-MiB-/Deadlinebudget kodierte Maße aus
      genau einer unterstützten Videobeschreibung lesen, nicht HD-Slot stempeln.
      Audio-only-Worker ohne zusätzliche Videoproben. Maße pro exakter URL,
      mehrdeutige/kaputte/verschlüsselte Beschreibungen neutral; Sprache und
      Bildmaße unabhängig. Keine neuen Hosts, Accounts oder Senderseitenparser.
      Abnahme: positive 720/1080p und negative Mehrvideo-/Codec-/Grenzfälle,
      synthetische ZDF-Suche mit TBA/Regel-Thema bis RSS/NZB/Queue und tatsächlichen
      720p im HD-Slot, bestehende native Qualitäts-/Worker-/SQLite-/PG-Gates,
      Vollsuite/Lint/Typecheck/Format/Build und Fork-CI grün. Historische GUIDs,
      Schemas und Altjobs erhalten. `docs/rendition-quality-contract.md` ergänzt;
      P03.4 und Produktivabnahme bleiben unabhängig offen.
      Entwicklungsabnahme 06.10.2026 mit den frischen Produktgates von P06.4
      (`aefa709`, CI 37380855999, Container 37380856018). Zwei öffentliche
      reguläre ZDF-Quellen zusätzlich begrenzt lesend als Deutsch/1920×1080
      geprüft; keine realen Antworten als Fixture oder Gitinhalt persistiert.
      Dieser Quellengegencheck ersetzt keinen produktiven Treffer/Import.

P09-Grundlagencheckpoint 01.10.2026, keine P09-Abnahme: Der neue streng
versionierte Erwartungsparser und lokale Probeowner sind implementiert und
isoliert geprüft. Explizite NULL-Sollwerte bleiben unbekannt; kaputte v1-
Strukturen werden nicht als Legacy akzeptiert. Probe prüft Container, nutzbare
Audio-/Videospuren ohne Coverbild, endliche Dauer und nur explizite Tags/
Dimensionen. 30s/1-MiB-Limits einschließlich stderr, tiny-chunk-Cap,
eigene Prozessgruppe, direkte reguläre Jobdatei und Inode-/Size-/mtime-
Stabilität sind kausal getestet. Eine echte kurzlebige, netzlose Containerprobe
mit synthetisch erzeugtem MP4 bestätigt die eingesetzten ffprobe-Optionen.
Noch nicht in Producer/Parser/Queue/Worker verdrahtet; noch keine P09-Spalten
oder Schemaübergänge. Diese Basis allein erfüllt weder P09.1 noch P09.2.
Vollständige Wiring-, SQLite-/PG-/Restart-/Retry-/Medien-/DB-Ausfall- und
Imageproben bleiben Pflicht, historische completed-Jobs bleiben unangetastet.

P09-Persistenzcheckpoint 01.10.2026, weiterhin keine P09-Abnahme: Der optionale
v1-Block wird durch Downloadlink/Fake-NZB, Parser und beide Addfile-Routen bis
zur Queue erhalten. Deklarierter beschädigter/mehrfacher Block wird abgelehnt,
ohne Titel-/URL-Legacyfallback. Beide additiven Migrationsketten enthalten
nullable `Download.mediaExpectations` und `mediaValidation`. Der SQLite-
Snapshotübergang erkennt auch den P07-Zwischenstand mit passender Ledgerpräfix-
Prüfung; nur die historisch fehlenden neuen Spalten werden als NULL verglichen.
Vorhandene JSON-Strings bleiben bei Übergang/PG-Import/Retry bytegleich, Retry
übernimmt keine früheren Prüfergebnisse. Reale SQLite- und disposable PG-
Queue-/Restart-/Retry-Proben sowie Bootstrap-/aktueller PG-Import sind grün.
Noch keine Aktivierung in allen RSS-Producern und kein Worker-Abschlussgate;
P09.1/P09.2 bleiben offen. Die Vollsuite bestand mit 737 regulären Tests;
die zusätzlichen PG-Proben laufen separat, nicht als SQLite-Ersatz.

P09-Abschlusscheckpoint 01.10.2026, Fork-Abnahme ausstehend: eigene Producer
liefern immer v1; gemeinsamer Workerabschluss probt alle Transfer-/Muxzweige,
persistiert Fakten erst danach und schützt DB-/Commitfehler. HLS-Opt-in auch
für Sonarr-Metadatenfallback, unveränderter Default. Beide realen Backends mit
synthetischem Medienabschluss/SAB-History, negatives Audio/HTML/Truncation/
Sample, Queuefortsetzung, Restart und PG-Ausfall-/Weckrufrecovery geprüft.
Zusätzlich finaler TLS-Import samt P09-Payloads und beide immutable Rückwege
lokal grün. Details/Prüfgrenzen unter `docs/media-validation.md` und dem
P09-Workerreview. P09.1/P09.2 sowie P11.7/P11.8 bleiben bis aktuellem Fork-CI-
und Dockerlauf offen; kein produktiver Cutover oder SQLite-Rücktransfer.

P09-UI-Nachreview: Die eigenständigen Legacy-NZB-Producer in `/search` und
`/movies` waren im vorherigen Pfadreview übersehen. Beide erhalten jetzt pro
Rendition serverseitige v1-NZBs aus demselben Owner; Kategorie-/Dateinamenvertrag
unverändert. Echte SQLite-/PG-Queuewrites plus Desktop-Pointer-/Tastaturprüfung,
gematchte Light-/Dark-Bilder und abgefangene NZB-POSTs bestanden. Details und
vorhandene zusätzliche P10-Consumerbefunde im Review; P09 bleibt bis aktuellem
Forklauf offen.

## Phase P10 — Vollständige Parität und getrennt freigegebener Betrieb

Ergebnis: nachgewiesene Gesamtkette auf dem gewählten Backend, danach kein Proxy.
Abhängigkeit P09 und alle für den gewählten Betriebsweg relevanten
Entwicklungsabnahmen; B16/O01/O02, R6/R9/R10. P11.1 gilt für beide Betriebswege;
P11.2–P11.8 sind nur für PostgreSQL-Betriebsfreigabe Pflicht, P11.9 ist optional.

- [x] **P10.1 — Komplette Paritätsabnahme ohne Produktion.** Beide Newznab-
      Pfade einschließlich Caps/Validation/RSS, ID-/Text-/Staffel-/Episode-/Movie-
      Suche, Counts/Relative-Enclosure, NZB-addfile, Queue/failed/completed,
      History/Import/Remove/Retry gegen synthetische Sources und disposable
      SQLite sowie bei PG-Wahl zusätzlich disposable PG
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
      Wieder geöffnet 06.10.2026, enger Folgeauftrag in P14.1:
      `/api/search` verwirft im Standardpfad weiterhin ganze Einträge bei
      Standard-HLS trotz nutzbarem HD-MP4; der alternative Providerpfad hat
      abweichende Budget-/Auswahlverträge. Neue synthetische UI-/NZB-Consumer-
      Regressionen ergänzen die historischen Paritätsnachweise, ersetzen sie nicht.
      Engen Folgeauftrag erneut abgenommen 08.10.2026 mit P14.1 auf `7d98932`:
      1121 lokale Tests, Lint/Typecheck/Format/Build und reale Desktop-HLS/MP4-
      Auswahl samt NZB-/RSS-/Queueconsumer grün. Fork-CI 37707678742 und
      Dockervalidierung 37707678881 vollständig erfolgreich, einschließlich
      nativer Arr-Consumer direkt/via Prowlarr, beider Backend-/Medienketten,
      Persistenz und Rollback. Keine Produktvollabnahme P13–P16/P03.4 oder
      produktive Operation behauptet; historische übrige Routejourneys erhalten.
      Abgenommen 01.10.2026 auf Produktcheckpoint `8de3148`:
      Fork-CI 36802563431 und Dockerprobe 36802563450 erfolgreich.
      830 reguläre Tests sowie 15 separate native DB-Ausführungen, Lint,
      Typecheck, Format und Build bestanden. Beide Newznabadressen laufen
      im gebauten Image über echtes RSS/NZB bis zur geprüften synthetischen
      Datei und History; native SQLite-/PG-Persistenz, Restart, tatsächliches
      jobisoliertes Remove/Retry und Ausfall-/Recoveryprobe grün. DB-Reads
      sind auf drei Sekunden begrenzt, Mutationen ausdrücklich nicht mit
      einem scheinbar retry-sicheren Timeout versehen. Acht Desktoprouten
      mit Pointer/Keyboard, Light/Dark, 32 gematchten Bildern und zusätzlichen
      Fehler-/Save-/Secret-/Dialogzuständen geprüft; gesunde Routen ohne
      Konsolen-/Pagefehler. B/O-Owner und genaue Grenzen stehen in
      `docs/proxy-retirement-parity.md` und im Review. Reale Arr-Versionen/
      Interoperabilität sind nicht attestiert und bleiben separate isolierte
      Freigabe; keine echten Auto-Grabs oder Produktion. P10.2–P10.7 bleiben offen.
      Wieder geöffnet 01.10.2026 nach ausdrücklicher Genehmigung eigener
      Arr-Testinstanzen: Sonarr 4.0.20.3014, Radarr 6.4.4.10685, Prowlarr
      2.6.5.5623 über tatsächlich laufende APIs verifiziert. Sonarr-Newznab,
      Prowlarr-Newznab sowie Sonarr-/Radarr-SAB-Verbindungstests bestanden.
      Radarrs nativer Indexertest verlangt Ergebnisse in Filmkategorien und
      lehnt den ehrlichen leeren Feed ohne Filmkontext mit HTTP 400 ab.
      Owner: `fetchMovieSearchForRssSync`, Newznab-Movie-Route und tatsächlicher
      Radarr-Setupvertrag. Vor Schließen einen unterstützten Einrichtungsweg
      ohne erfundene Filme, obligatorische lokale Metadaten, neue Credentials
      oder getrennte manuelle/automatische Endpunkte belegen. Keine erfolgreiche
      Aufnahme/Weiterleitung/Importkette behauptet; diese Verbraucherprobe bleibt
      offen. Reproduzierbarer isolierter Aufbau und Grenzen in
      `docs/arr-test-instances.md`; keine Bibliothek, kein echter Grab, keine Produktion.
      Erneut abgenommen 02.10.2026 auf unverändertem Produktstand `8de3148`:
      deaktivierte Neuanlage plus unterstütztes `forceSave`-Update belegt,
      Empty-Feed-Test ehrlich weiterhin HTTP 400. Native direkte/vermittelte
      Film-/Episodensuche, echter Arr-Release→NZB→SAB→Completed→Import und
      native Quellhistoryentfernung bei erhaltener physischer Importdatei geprüft.
      Unüberwachte synthetische Fixtures mit privatem Backup; Fremdsuche leer,
      falsche Keys 401, externe Fetchziele gesperrt. Frische vermittelte Kette
      auf dem bekannten Entwicklungsrechner ohne andere Checkouts/Dienste
      zu verändern. Keine automatische Prowlarr-Application-Sync-Abnahme;
      zusätzlicher Arr-Lauf SQLite, bestehende native PG-/UI-Gates wiederverwendet.
      Securitybefund gehört ausdrücklich zum weiterhin offenen P10.2;
      dessen npm-Checkpoint wurde anschließend abgenommen (siehe unten).
      Keine Produktionsabnahme behaupten.
      Lokale technische Abnahme 03.10.2026 am tatsächlich servierten Main
      `0c139f3`: dieselben verifizierten Arr-Versionen, direkte/vermittelte
      Suche und negative Auth-/Fremdsuch-/Netzwerkfälle nach explizitem Restart
      bestanden. Gespeicherte Settings, Indexer/SAB-Konfiguration und Hashes
      der bereits importierten synthetischen Film-/Episodendateien erhalten;
      automatische Suche/RSS weiterhin deaktiviert. Alle vier SQLite-DBs
      mit `integrity_check` geprüft, fünf abgeschlossene Pingufunk-Migrationen,
      keine aktive Downloadqueue. RSS→NZB-Vertrag, neutrale Sprache,
      Aliasgleichheit und leere Folgeseite am servierten Bundle geprüft.
      Desktop: positive/negative Suche sowie Settings-Save/Reload/API-Readback
      und Wiederherstellung des Ausgangswerts; keine Konsolenfehler.
      Separater echter MediathekView-Katalog liefert Treffer, blockiert alle
      geprüften Download-/Settings-Writes mit 503 und bleibt nach Restart
      integer und downloadfrei. Keine echten Mediendownloads.
      Die vorherige synthetische native Importkette auf demselben Main-Image,
      unveränderte Main-CI/PG-/Mediengates und vollständige Screenshotmatrix
      werden ausdrücklich wiederverwendet, nicht als frische Ausführung
      ausgegeben. Details und Abnahmegrenzen im Review. Kein automatischer
      Prowlarr-Application-Sync-Nachweis; P10.2–P10.7 bleiben offen.
- [x] **P10.2 — Produktionsparameter und Rollbacks vor Freigabe konkretisieren.**
      Installationsbezogene Abnahme 04.10.2026: Backend, unterstützte tatsächliche
      Serverversion, Primary, ausdrücklich unverschlüsselter Transport, eigene
      DB-/Schema-/Rollenidentität, Rechte, Secret-Mounts und Ausführungs-UID
      verifiziert. Exakte App-/Migratorimages aus `c727fc4` und das separate
      PG-kompatible Rollbackimage frisch ohne HIGH/CRITICAL gescannt; zusätzlich
      mit synthetischer aktueller Quelle auf derselben PG-Serverversion Import,
      semantischen Vergleich, ersten Write, Backuprestore und immutable
      Post-write-Rollback erfolgreich geprobt. Fork-CI `37161051635` und
      Dockerabnahme `37161051630` erfolgreich; npm-Audits ohne Befunde.
      Private Betriebswerte, unveränderliche Artefakte und vollständige
      Befehls-/Rückwegbelege ausschließlich im privaten Betriebsrunbook.
      Originalquelle, Snapshots, Dumps und Images bleiben erhalten; keine
      Cleanup- oder allgemeine Deploymentfreigabe. Folgende Entwicklungs- und
      Securitynotizen sind historische Zwischenstände, keine aktuellen Blocker.
      Transportentscheidung 03.10.2026: ausdrücklicher unverschlüsselter Betrieb
      ist freigegeben; URL `sslmode=disable` statt zwingendem TLS. App und
      Migrationsrunner müssen denselben Transport benutzen; kein automatischer
      TLS-Fehlerfallback, keine gemeinsame Clusteränderung erforderlich.
      Implementiert auf `96e3082`: gemeinsamer URL-Transportowner, ungültige/
      doppelte Modi gesperrt, Secret-Preflight und echte Klartext-CLI-Abnahmen
      einschließlich Sequences. 842 reguläre Tests und 15 disposable PG-Tests
      grün; aktueller Fork-CI erfolgreich. Docker-/TLS-Neuabnahme fand fehlenden
      Helper im expliziten Migrator-COPY/Buildcontext; in `1f5bfb5` korrigiert.
      Neue lokale App-/Migratorbuilds und TLS-Containerprobe danach erfolgreich;
      aktueller Docker-Forklauf noch laufend,
      produktive Images unverändert. Frischer unveränderter Lockfile-Audit:
      sechs HIGH in Entwicklungsabhängigkeiten, Production-Audit null; Build-/
      Migratorreichweite und genaue neue Images vor Rollout prüfen. Keine
      Rollen-/DB-Anlage, Datenmigration oder gemeinsame Clusteränderung.
      Runbooks/GitOps-Änderungsentwurf ohne Deploy an tatsächlichem Image-/Task-/
      Gitstand prüfen: gewählter Backendtyp und seine Network-/Secret-/Mount-/
      Pfad-/Rechtekonvention; bei PG-Wahl Serverversion/Primary/Transport/TLS,
      eigene Rolle/DB/Schema, Sourcefingerprint,
      Größe/Importzeit, Wartungsfenster, Backupablage/Retention und die
      Image-/Scanpolicy der gewählten Installation. Weder HAProxy noch Swarm
      voraussetzen; konkrete private Routen und Zugangswerte bleiben außerhalb
      des öffentlichen Git. Nur bei PG-Wahl: PG-Cutoverimage mit unverändertem
      Matching sowie spätere Feature-/Schema-Aktualisierung trennen; fehlender
      kompatibler Dual-Backend-Checkpoint sperrt den PG-Cutover, nicht den
      SQLite-Proxy-Ausstieg. Keine privaten Werte im öffentlichen Git. Passendes
      Rollbackimage des gewählten Providers festhalten; bei PG-Cutover auch das
      bisherige SQLite-Image. Vor PG-Schreibfreigabe ein
      PG-kompatibles Rollbackimage mit erhaltenem PG-Datenstand testen;
      PG→SQLite-Rückschaltung nur nach separater P11.9-Abnahme. Unbekannte Werte
      stoppen den PG-Cutover. Abnahme: ausführbarer
      redigierter Operationsentwurf und getestete Rückwege, keine Cleanupfreigabe.
      Neuer offener Scanbefund 02.10.2026: unverändertes Lockfile meldet
      26 npm-Paketbefunde (3 critical/17 high/5 moderate/1 low), darunter
      Next 16.1.6 und Vitest/Coverage 4.0.18. Vor Release/Nutzer-Rollout einen
      separat freigegebenen Security-/Kompatibilitätscheckpoint abnehmen:
      Runtime und Build/Test/Migrator-Reichweite trennen, Maintainer-Advisories
      verifizieren, kompatible Fixversionen/Lockfile mit npm erzeugen und beide
      DB-Clients samt Produkt-, DB-, Build- und betroffenen Desktop-/Arr-Gates
      prüfen. Kein blindes `audit fix --force`, Prisma-Downgrade auf den
      Scanner-Vorschlag 6.12.0 oder beiläufiger Majorwechsel. Befund/Owner
      unter `docs/proxy-retirement-review.md`; kein Release aus grünem CI ableiten.
      Sicherheitscheckpoint nach ausdrücklicher Nutzerfreigabe abgeschlossen
      02.10.2026 auf `04d6b95`: Next/Env/ESLint 16.3.8, Vitest/Coverage 4.1.11,
      Prisma CLI/Client 6.19.3 und geprüfte transitive Updates. Eng begrenzter
      Deepmerge-Override mit echtem Prisma-Konfigurationsload und rekursiver
      Regression. Frisches npm ci, beide Clients, vollständiger und Production-
      Audit null; 832 Tests, Lint, Types, Format und Build grün. Neue native
      PG-, isolierte Arr- und Desktopnachprüfung; Fork-CI 37061130068 und
      Dockerprobe 37061129957 erfolgreich, einschließlich TLS, post-write
      Rollback, SQLite-Persistenz und Medienabschluss auf beiden Backends.
      Einmaligen Radarr-Startphasenbefund nicht als behoben behaupten;
      Details und Grenzen im Review. Npm-Audit ersetzt weder OCI-/Scanpolicy
      noch installationsbezogene Betriebsabnahme. Historische Rollbackimages
      sind isolierte Testinputs, keine freigegebenen Sicherheitscheckpoints.
      Zum damaligen Checkpoint blieb P10.2 wegen der noch fehlenden
      Betriebsabnahme offen; diese wurde am 04.10.2026 wie oben abgeschlossen.
- [x] **P10.3 — Optionale freigegebene PG-Übernahme, Proxy unverändert.**
      Installationsbezogene Abnahme 04.10.2026 nach ausdrücklicher Freigabe:
      leere API-Queue und keine aktiven persistierten Jobs geprüft; Writers
      gesperrt und App tatsächlich vollständig gestoppt. Konsistenter
      SQLite-Backup-API-Snapshot mit Integrity-/FK-Prüfung und Sourcehash,
      eigene native PG-Migrationskette, typisierter Import aller sechs Modelle,
      unabhängiger vollständiger semantischer Vergleich und Korrektur der real
      schemaeigenen Sequence erfolgreich. Originalquelle unverändert; ihre
      Migrationshistorie nicht in PostgreSQL übernommen. Private Reports und
      Backups erhalten. Kein gemeinsamer Clusterumbau, kein Matching-/Routing-
      Wechsel oder Servarr-Stopp. Der frühere TLS-Blocker wurde durch den
      separat implementierten und geprüften expliziten Klartextmodus gelöst,
      nicht durch Fehlerfallback oder Abschwächung der Datenprüfungen.
      **Nur bei ausdrücklicher PostgreSQL-Wahl; hier
      anhalten bis zur ausdrücklichen Datenmigrations-/Deploymentfreigabe für
      genau diese Installation.** P11-Runbook ausführen: read-only Preflight,
      Aufnahme sperren/aktive Jobs kontrolliert auslaufen/unimportierte History
      erfassen, alle Pingufunkwriter stoppen; konsistentes Backup+Integrity/FK,
      eigener leerer PG-Zielaufbau, typisierter Import, echte Sequences und
      semantischer Vergleich. Servarrdienste/Proxy nicht pauschal stoppen,
      bei Fehler kein Appstart oder automatische Bereinigung. Abnahme: Sourcehash/
      Ziel-/Schema-/Imageversion und redigierter Vollvergleich dokumentiert,
      unveränderte SQLitequelle/Backups erhalten; danach Pause vor Appstart.
- [x] **P10.4 — Optionaler kontrollierter PG-Start, noch keine Writers.** **Nur nach
      Validierung von P10.3 und zugehöriger Startfreigabe** neues Image/Secret im
      Maintenancegate starten; DB-/Schema-Readiness, Settings/Queue/History nur
      lesen, null Cache-/Setting-/Workerwrites nachweisen. Nicht allein Probe-200
      akzeptieren. Abnahme: korrekter PG-Bestand erreichbar, Single-Worker, kein
      SQLitefallback; Ergebnisse prüfen und erneut anhalten. Fehlerrollback vor
      tatsächlichem erstem PG-Write auf immutable SQLiteimage+Originalquelle,
      PG-Ziel erhalten; keine alten/neuen Images an falschen Provider anschließen.
      Abnahme 04.10.2026: Tatsächlichen PID-1-Provider und Writergate statt nur
      Compose geprüft; genau eine gesunde Instanz auf dem freigegebenen Image.
      Settings/History/Regeln und öffentliche API-Verträge lesend geprüft,
      erster Write-Checkpoint leer und semantische Datenprüfung erneut grün.
      Vor Writerfreigabe separaten geschützten PG-Dump gesichert und angehalten;
      Nutzer hat danach ausdrücklich den PostgreSQL-Schreibbetrieb freigegeben.
- [x] **P10.5 — Optionalen PG-Schreibbetrieb separat abnehmen.** **Nur nach expliziter
      Abnahme/Schreibfreigabe von P10.4** Aufnahme/Writer öffnen; ersten echten
      PG-Write einschließlich automatischer Caches/Settings erfassen. Restart/
      Persistenz und freigegebenen isolierten synthetischen Job-/Retry-/Importfall
      prüfen, keine realen Bibliotheksgrabs ohne Auftrag. Abnahme: aktiver Betrieb
      auf PG belegt, Proxy bleibt unverändert, stabile Beobachtung statt simultanem
      Matching-/Routing-/Replicacutover. Nach neuen PG-Writes nur Writerstopp+
      PG-Backup+geprüftes PG-kompatibles Rollbackimage; Rückschaltung zu SQLite
      nur nach P11.9, niemals still auf alten Snapshot.
      Abnahme 04.10.2026: Normalen Writer-/Queuebetrieb aktiviert, echten
      Anwendungsschreibzugriff über Settings mit unverändertem Wert und
      dauerhaftem First-write-Checkpoint nachgewiesen. Kontrollierter
      Taskersatz über den vorhandenen Deploymentweg: neuer gesunder Container,
      richtiger PG-Provider, aktiver Writer, identischer Checkpoint und erhaltene
      Settings/History; SQLite-Quellhash unverändert. Isolierte synthetische
      Queue-/Medienabschluss-/Retry-/Persistenz- und DB-Ausfallfälle aus dem
      erfolgreichen Dockerlauf für exakt `c727fc4` wiederverwendet, keine
      produktiven Testgrabs. Native Indexer-/Downloadclientrouten nach Restart
      lesend erneut bestätigt; bestehende autorisierte Filmimporte physisch
      geprüft. Zusätzlich geschützten Post-write-Dump mit lesbarem Archivindex
      gesichert; kein Restore auf Produktion. Private Vollabnahme persistiert.
      Dies schließt nur den gewählten PG-Betriebsablauf, nicht die weiterhin
      offenen Sprach-/Qualitätsbefunde oder die gesamte Proxy-Produktabnahme.
- [ ] **P10.6 — Indexer und SAB gleichzeitig auf native Wege umstellen.**
      Betriebsnachtrag 03.10.2026: Freigegebener nativer SQLite-Proxy-Ausstieg
      ausgeführt, lokal übertragenes App-Image ohne Registrypublikation.
      Separate geprüfte Bootstrap-Baseline statt Änderung der Originaldatei;
      sechs Modelle erhalten, Queue leer und zwei abgeschlossene Historyeinträge
      abgeglichen. Native Prowlarr-Indexerprüfung und drei SAB-Clientprüfungen
      bestanden; bestehende Consumer/Mapping-IDs, Keys und öffentliche Kategorien
      beibehalten. Originale Automatikflags nach Umschaltung per API bestätigt.
      Sonarr verarbeitet den echten TVDB-/S02E01-Treffer korrekt und verweigert
      den Doppelgrab wegen vorhandener Datei; negative Textsuche leer.
      Keine produktiven Testgrabs. Proxy bleibt bei null Replikaten erhalten.
      Weitere stabile Betriebs-/Jobbeobachtung und private Rückwegabnahme nicht
      allein aus Verbindungstests behaupten; Punkt daher noch nicht vollständig
      geschlossen. Täglicher Registry-Scanner deckt lokale Image-Tags nicht ab;
      frische genaue Archivscans sind bestanden, kein neuer Zeitplan angelegt.
      **Erst nach stabiler Abnahme des gewählten Backends und ausdrücklicher
      Routing-/Deploymentfreigabe** geprüfte native Funktionsversion samt
      separat geprüften append-only Schemaerweiterungen des ausgewählten
      Providers einführen; die andere Datenbank wird dabei nicht angelegt oder
      verbunden. Indexer- **und**
      Downloadclient-URLs, Host/Key, relative NZB-URLs und Remote-Path-Mapping
      gemeinsam umstellen. Aktive/nicht importierte Jobs und Legacy-Privatekategorien
      vorher abgleichen, GUID-/Feed-Wiederauftauchen berücksichtigen; eine aktive
      RSS-/Downloadroute, keine Doppelgrabs. Abnahme: freigegebene komplette
      Consumerkette sicher, Mapping/öffentliche Kategorien korrekt. Bei Problemen
      Routing/backendkompatibles Image zurück, gewählter Provider bleibt aktiv;
      DB-Rollback nur nach dem passenden getesteten Vertrag, neue Findings
      öffnen ihren Ownerpunkt wieder.
- [ ] **P10.7 — Proxy erst nach letzter eigener Freigabe entfernen.** Nach
      funktionaler/betrieblicher Abnahme und dokumentiertem DB-/Routing-/Jobzustand
      **anhalten und explizite Proxy-Entfernungsfreigabe abwarten**. Erst dann
      obsolete Proxyservice-/Routingkonfiguration gezielt aus GitOps nehmen,
      bestehende Networks/Secrets/Volumes anderer Consumer unangetastet lassen.
      Abnahme: native Indexer-/SAB-Verbindungen und gewählter DB-Betrieb bleiben gesund,
      Rückweg dokumentiert, kein zweiter Proxy, keine Datenbank-/Backup-Löschung.

## Phase P12 — Konsistente Toleranzen und verlässliche Settings-GUI

Ergebnis: Film-Laufzeit, Serien-Laufzeit und Film-Erscheinungsjahr separat unter
`/settings` → Matching konfigurierbar und serverseitig konsistent wirksam.
Höchste Priorität des Folgeauftrags; keine Abhängigkeit von der vollständigen
P03.4-Abdeckung. Bestehende Werte erhalten: Produktdefaults Laufzeit jeweils
10 %, vorhandene Installationswerte unverändert; Jahr default ±1, mindestens
±1 wie bereits entschieden. Laufzeiten weiterhin ganze 0–25 % inklusive exaktem
0-%-Modus. Für den neuen Filmjahresregler zunächst ganze 1–5 Jahre als begrenzter
Konfigurationsbereich, keine pauschale Erweiterung des Defaults. Das Filmjahr
ist kein Serien-Ausstrahlungsdatum; weder Vorabverfügbarkeit noch S/E-Bindung
wird damit aufgeweicht.

- [x] **P12.1 — Typisierter, atomarer Settingsvertrag mit bestätigtem Readback.**
      Owner: `src/app/api/settings/route.ts`, `src/lib/settings.ts`,
      `sonarr-settings.ts`, `radarr-settings.ts`, `language-policy.ts`,
      `src/contexts/settings-context.tsx`
      und vorhandene Settingsconsumer. Alle aktuell schreibbaren Produktkeys
      mit Typ, Einheit, Default, Grenzen und Normalisierung inventarisieren;
      eine gemeinsame Definition statt API-/UI-/Consumer-Kopien verwenden.
      `matching.movie.tolerancePercent` und `matching.sonarr.tolerancePercent`
      behalten; `matching.movie.yearTolerance` neu aufnehmen. Historische
      unbekannte DB-Keys bleiben erhalten/lesbar, aber neue unbekannte oder
      malforme Schreibwerte nicht per `String(object/null)` akzeptieren.
      Validiertes Batch als eine DB-Transaktion committen, danach Consumer
      generationensicher invalidieren und kanonische normalisierte Werte
      zurückgeben; SettingsContext übernimmt die bestätigten Werte statt des
      ungeprüften Submitobjekts. Ungültige vorhandene Matchingwerte sichtbar
      melden/fail closed, nicht still überschreiben. Commit-Ungewissheit darf
      weder Erfolg noch retry-sicheren Fehlschlag vortäuschen; kontrollierten
      Readback ermöglichen. Secretdateien/-umgebung bleiben serverseitig,
      Maskierung/Legacy-Erhalt/Write-Gate unverändert.
      Abnahme: echte disposable SQLite-/PG-Batches, Fehler beim zweiten Write
      hinterlässt keinen Teilstand; Normalisierung `015`→`15`, Null/Objekt/
      unbekannter Key/Rangefehler ohne Write, Secret-Negativfälle und
      Cache-Readback nach Erfolg/Rollback getestet. API-/Settingscontext-
      Regressionen kausal; P05.2 erst danach erneut schließen. Keine neue DB
      oder Backendumschaltung zum Speichern von Settings.
      Entwicklungscheckpoint 08.10.2026: gemeinsamer typisierter Owner,
      Gesamttransaktion und bestätigte Responseordnung umgesetzt. Echte
      SQLite-/PG-Fehler beim zweiten Write hinterlassen keinen Teilstand;
      verlorene Commitbestätigung wird als ungewiss mit kontrolliertem Readback
      behandelt. Abschließende Fork-/Containerabnahme unten bestanden;
      Settings-/Jobvertrag in `docs/settings-contract.md` dokumentiert.
- [x] **P12.2 — Ein Policy-Snapshot pro Suche und expliziter Job-Dauervertrag.**
      Abhängigkeit P12.1. Owner: `movie-matcher.ts`, `movie-search-context.ts`,
      `sonarr-matcher.ts`, `mediathek.ts`, `content-search.ts`,
      `release-media-expectations.ts`, `media-expectations.ts`, `nzb-release.ts`,
      `download.ts`, `download-manager.ts`, `media-probe.ts`. Film-/Serien-
      Laufzeit und Filmjahr einmal validiert für die Anfrage erfassen und an
      alle einschlägigen Owner einschließlich Text/ID/Staffel/RSS übergeben.
      Statische `MOVIE_YEAR_TOLERANCE` durch denselben Snapshot in Queryparser,
      Zielprüfung und Quellvergleich ersetzen. Jedes Jahr direkt gegen das
      kanonische Filmjahr prüfen, keine kumulierte ±N+±N-Abweichung. Titel/
      Alias, Remakekonflikte, unbekannte Laufzeit und Identitätsguards erhalten.
      Cachekeys und Late-response-Abbruch binden die tatsächlich verwendete Policy.
      Dateiabschluss gegen konkrete Quelldauer ist eine andere Prüfung als
      Identität gegen Film-/Episodenmetadaten: Herkunft, Referenzart, belegte
      Medienart und angewandte Regel explizit trennen; Serienwert nicht pauschal
      für Film-/Genericjobs lesen. Generische Quellen bleiben unbekannte
      Medienart, keine Klassifikation aus Kategorie, Titel oder Dateiendung.
      Anfangsvertrag für neue Jobs: Vergleich gegen `source_catalogue` als
      technische Assetprüfung mit festgehaltenen 10 % gemäß bisherigem
      Produktgrundwert, unabhängig von Film-/Serien-Matchingreglern; Vergleich
      gegen belegte `episode_metadata` mit festgehaltener Serienregel. Wenn
      beide Referenzen bekannt sind, beide samt Herkunft behalten statt
      Quelldauer durch Metadaten zu ersetzen. Unbekannte Referenz bleibt NULL.
      Für neue Jobs eine nächste versionierte Erwartungsstruktur gemeinsam in
      allen Produzenten, Parsern, DB-Persistenz, Retry und Worker einführen;
      relevante Policy beim Auftrag festhalten. Späteres GUI-Speichern ändert
      Jobs der neuen Version nicht. v1/v2/unversionierte Jobs weiterhin nach ihrem
      dokumentierten Altvertrag behandeln, nicht umschreiben oder als neue
      Version interpretieren; deren bisher dynamischen Serienwert ausdrücklich
      als Legacygrenze dokumentieren, Rollback-Kompatibilität benennen.
      Technische Byte-/Exit-/Audio-/Video-/Auflösungs-/Truncationchecks werden
      durch größere Matchingtoleranz nicht ersetzt oder abgeschwächt.
      Abnahme: synthetischer Film- und Serienpfad mit absichtlich verschiedenen
      Werten; Metadaten- und Assetreferenz werden unabhängig geprüft, veränderte
      Matchingwerte lockern die Assetprüfung nicht; beide Jahresgrenzen
      inklusive Query-/Quellkonflikten; persistierter
      neuer Policy-Snapshot über SQLite/PG, Neustart und Retry, Settingswechsel
      während wartendem Job ohne Neuberechnung. Generic/Legacy, falsche Version,
      unbekannte Dauer, Sample, EXDEV und HLS weiter geschützt. Neue Erwartungen
      möglichst im vorhandenen versionierten Textfeld; nur bei tatsächlichem
      Schemabedarf append-only Migrationen beider Provider. P09.2 danach erneut
      abnehmen; kein vorzeitiges Completed und kein Test gegen Produktionsjobs.
      Entwicklungscheckpoint 08.10.2026: ein Suchsnapshot einschließlich
      Filmjahr und neue v3-Joberwartungen in Producer/Parser/Persistenz/Retry/
      Worker. Keine DDL. Beide realen disposable Backends sichern Restart,
      Retry und Settingswechsel; neue v3-Mediencontainerprobe auf beiden
      Backends ebenfalls bestanden. Legacygrenze und v3-kompatibler Rollback
      dokumentiert; keine zusätzliche Schemaänderung.
- [x] **P12.3 — Drei unabhängige Toleranzregler in Matching bedienbar machen.**
      Abhängigkeit P12.1/P12.2. Owner: `src/app/settings/page.tsx`,
      Settingscontext und bestehende UI-Komponenten. Film-Laufzeit ±%,
      Serien-Laufzeit ±% und Film-Erscheinungsjahr ±Jahre als getrennte,
      beschriftete Felder mit Einheiten, Grenzen, Default und Erklärung
      darstellen. Serienfeld aus der optionalen Sonarr-Karte herauslösen;
      Speichern dieser Regeln darf nicht an deaktivierter Arr-Anbindung oder
      deren unvollständiger URL scheitern. Keine drei redundanten Speicherorte,
      kein neuer Browsermatcher. Prozentgrenzen, 5-Sekunden-Boden mit 25-%-Deckel
      und 0-%-Exaktmodus verständlich von absoluter Mindestdauer unterscheiden.
      Vorhandene Werte, unabhängige ungespeicherte Formulare und Fehlerzustände
      erhalten. Abnahme: tatsächliches disposable Desktopbundle in Light/Dark,
      Pointer/Keyboard, getrennte Änderungen/Speichern/Reload/API-Readback,
      ungültige/zu große/leere Werte und API-/DB-Fehler ohne Erfolgsmeldung;
      Matchingconsumer verwenden exakt die angezeigten bestätigten Werte.
      Gematchte Screenshots und Konsole nach `pingufunk-visual-qa`, beide
      Backend-Persistenzketten; keine produktiven Settingsänderungen.
      Entwicklungscheckpoint 08.10.2026: drei getrennte Regler bedient,
      normalisiert gespeichert, neu geladen und gegen SQLite/PG gelesen.
      Desktop-Light/Dark samt echten DB-Fehlern, ungültigen Werten, erhaltenen
      unabhängigen Dirty-Formularen und sauberer frischer Konsole geprüft.
      Dark über temporäre reine Root-Themefixture, danach entfernt; keine
      browserseitige DOM-Manipulation. P12.2-Containerabnahme ebenfalls bestanden.
- [x] **P12.4 — Optionale Radarr-Konfiguration ohne Secretfelder vervollständigen.**
      Abhängigkeit P12.1, unabhängig von P12.2/P12.3. Owner: Settings-GUI,
      `radarr-settings.ts`, `src/services/radarr-provider.ts` und GET-only-Arr-Client.
      Bereits unterstützte Aktivierung, Base-URL mit Unterpfad und Inventarlimit
      1–64 MiB/default 10 in einer eigenen optionalen Karte darstellen; Status
      der serverseitig konfigurierten Credentialquelle nur als vorhanden/
      fehlend/ungültig anzeigen. Sonarr/Radarr-Metadaten bleiben optional und
      keine zweite Suchroute. Abnahme: deaktiviert ohne Key nutzbar, validierte
      Save/Reload-/Fehlerjourney und gemockte lesende Verbindung mit Unterpfad;
      keine Keys/Dateipfade/URLs mit Credentials in Browserantworten oder Bildern.
      Entwicklungscheckpoint 08.10.2026: optionale Radarr-Karte mit URL-
      Unterpfad, Inventarlimit und ausschließlich Credentialstatus umgesetzt;
      deaktiviert ohne Key sowie ungültige serverseitige Quelle geprüft.
      Save/Reload auf beiden Backends und bestehende GET-only-Consumerfälle grün.

Gemeinsame Entwicklungsabnahme P12.1–P12.4 am 08.10.2026, Produktstand
`4dc280c89db2a5d34e07bc1aed3d61bc99f561bf`: 1.074 reguläre Tests,
Lint/Typecheck/Format/Productionbuild bestanden; zusätzlich 14/14 echte
disposable SQLite-/PG-Settings-/Erwartungsfälle. Tatsächlich servierte
Desktop-Light-/Dark-Journeys mit Pointer/Keyboard, Save/Reload/Readback,
DB-Fehlern, gematchten Screenshots und sauberer frischer Konsole bestanden.
[Fork-CI 37704788531](https://github.com/superions/pingufunk/actions/runs/37704788531)
einschließlich vollständiger PostgreSQL-Integration und
[Containerkette 37704788439](https://github.com/superions/pingufunk/actions/runs/37704788439)
grün: native Arr-Consumer direkt/via Prowlarr, Runtimewerkzeuge, TLS-Migration
und post-write-Rollback in Wegwerfumgebung, SQLite-Persistenz sowie tatsächliche
Legacy-/v3-Medienabschlüsse auf beiden Backends. Keine Imagepublikation,
Produktion, realen Bibliotheksoperationen oder Main-/Upstreamänderungen.
Die alten Jobversionen bleiben unverändert; v3 verlangt ein kompatibles
Rollbackimage. P13–P16 und P03.4 bleiben offen. Review durch den Implementierer,
keine unabhängige Peerreview oder pauschale Sicherheitsabnahme behauptet.

## Phase P13 — Erklären können, warum ein Treffer oder Import fehlt

Ergebnis: begrenzte fachliche Diagnose statt Dockerlogs, pauschalem „nicht
gefunden“ oder vermuteter Ursache. P03.4-Abdeckung bleibt eigenständig.

- [x] **P13.1 — Gemeinsame typisierte Entscheidungsgründe und Belegstatus.**
      Owner: bestehende Film-/TV-Matcher, `content-search.ts`, `source-audio.ts`,
      `mp4-audio-language.ts`, `rendition-quality.ts`, `media-probe.ts` und
      `download-failure.ts`. Geschlossenen Diagnosevertrag mit Stage, Reason,
      belegter/fehlender/widersprüchlicher Evidenz, Budget-/Coverage-Status und
      begrenzten Zählern einführen. Leerer Katalog, Alias-/S/E-/Jahrkonflikt,
      Runtime-Abweichung, unbekannte Audiosprache, ungeprüfte Rendition und
      benötigte fehlgeschlagene Folgeseite dürfen nicht derselbe Grund sein.
      Match-Score nicht als Identitäts-/Sprachbeweis umdeuten. Bestehende
      sichere Transfercodes weiterverwenden; Medienprobe um fachliche Gründe
      ergänzen, keine rohen Exceptions. Begrenzte Request-Korrelation mit
      Kapazität/TTL, keine dauerhafte Liste privater Suchen und keine URLs,
      Token, DB-Verbindungsdaten, Response-Bodies, argv, lokalen Pfade oder
      freien Exceptiontexte. Kein blindes Confidence-Attribut, das Newznab-
      Consumer angeblich vor Auto-Grabs schützt. Abnahme: positive und negative
      Entscheidungen bis tatsächlicher Route/Worker kausal assertiert,
      Timeout/Coverage vom echten Nichtfund unterscheidbar, Redaction-/Overflow-
      Regressionen; bisheriger RSS-/SAB-Fehlervertrag bleibt kompatibel.
      Entwicklungscheckpoint 08.10.2026: geschlossener Stage-/Reason-/Evidenz-
      Owner mit AsyncLocalStorage, 128 Collectors/Berichte, 64 Eventkombinationen,
      fünf Minuten TTL und bounded Counts. Film-/Sonarrmatcher, Quellenabruf,
      Audio-/Rendition-/MP4- und lokale Probe-/Workerconsumer instrumentiert.
      Routen liefern nur neue zufällige Antwortkennung, keine XML-/SAB-Umschreibung
      oder öffentliche Diagnoseliste. Lokale Medienfehler behalten validierte
      Ursache über Catch/Persistenz, vorhandene Transfercodes weiter genutzt.
      Kausale Routen-/Matcher-/Worker-, Isolation-/Overflow-/TTL-/Redactiontests
      und lokale Gates grün; finale Fork-/Backendcontainerabnahme noch offen.
      Vertrag `docs/decision-diagnostics-contract.md`; UI-/Logs-/Zugriffschutz
      und Arr-Importdiagnose bleiben vollständig P13.2, Checkbox noch offen.
      Finale Abnahme auf `9ed044aa1f2f32a834702a3f1a7d5d30277d3e9d`:
      [Fork-CI 37709955459](https://github.com/superions/pingufunk/actions/runs/37709955459)
      samt PG-Gate und
      [Containerkette 37709955519](https://github.com/superions/pingufunk/actions/runs/37709955519)
      vollständig erfolgreich: native Arr direkt/via Prowlarr, Tooling,
      TLS-Migration/post-write-Rollback, SQLitepersistenz und reale
      Medienconsumer beider Backends. 1152 lokale Tests, Lint, Typecheck,
      Formatcheck, Build und Diffcheck grün. Keine UIänderung dieses Pakets;
      P13.2 weiterhin offen, kein öffentlicher Reader, keine Gesamt-/Sprachabnahme.
- [x] **P13.2 — Sichere Diagnose in Suche, Downloads und Logs bedienbar machen.**
      Abhängigkeit P13.1. Owner: `/search`, `/movies`, `/shows`, `/downloads`,
      bisheriger `/logs`-Platzhalter und zugehörige API-Owner. Relevante Gründe
      und Belegstatus anzeigen, mit klaren Zuständen Katalogtreffer → passende
      Rendition → Job → geprüfte Datei; Arr-Import ausdrücklich getrennt.
      Optional konfigurierten Arr-Zugriff nur lesend für zugeordneten Import/
      Blockgrund nutzen, ohne Anbindung „Importstatus unbekannt“ zeigen.
      Completed allein ist niemals „in Sonarr/Radarr importiert“. Kein
      öffentlicher Docker-/Shelllogreader, Rohantwortviewer oder API-Keyfeld;
      Diagnosezugriff gegen die tatsächlichen bestehenden Zugriffskontrollen
      prüfen, nicht allein durch einen vermeintlich privaten Routennamen schützen.
      Abnahme: Desktop-Leer-/Timeout-/Konflikt-/Unknown-/Completed-/Importblocked-
      Zustände im servierten Testbundle mit Readback, Fokus, Screenshots und
      sauberer Konsole; Mock-Import muss passende Download-ID und Datei verlangen.
      Keine Diagnosebuttons mit implizitem Retry, Grab, Override oder Löschung.
      Entwicklungscheckpoint 08.10.2026: geschlossene Anfrageberichte in
      Suche/Filmen, selektiver Job-/Dateireader und GET-only Arr-Importdiagnose
      mit exakter Download-ID, gepaarter History und aktueller Dateizuordnung.
      API-Importmeldung ausdrücklich kein physischer Arr-Hostdateibeweis.
      `/logs` zeigt nur tablokalen Kurzzeitbericht, keine Rohlogs oder globale
      Liste. Bestehende Oberfläche ohne eigenen Login: UUID ist kein Schutz,
      tatsächliche Installations-Lesegrenze dokumentiert. Desktop-Light
      1280×720, Pointer/Keyboard, Leer-/Timeout-/Konflikt-/Unknown-/Completed- /
      Importblocked-Journeys, gematchte Screenshots und Readback geprüft;
      Diagnoseausfall entfernt vorherigen Dateibeleg. Im Review historische
      Medienchecks beschriftet, Queue-Textfit und verlorenen Tastaturfokus
      korrigiert. Abschließende frische Bundle-/Fork-/Containerabnahme noch
      offen, Checkbox unverändert. Vertrag `docs/decision-diagnostics-contract.md`.
      Finale Entwicklungsabnahme 08.10.2026: tatsächlich serviertes Desktopbundle
      samt Fokus/Einzelread/Readback/5min-Expiry geprüft, keine unerwarteten
      Konsolenfehler oder mutierenden Diagnoseoperationen. Fork-CI
      [37720415235](https://github.com/superions/pingufunk/actions/runs/37720415235)
      und kumulative Containerkette
      [37720415340](https://github.com/superions/pingufunk/actions/runs/37720415340)
      auf `75b3318cb414218c624aee7c195084dda39d1d17` erfolgreich, einschließlich
      PostgreSQL, nativer Arr-Consumer und echter Medien-/Restartzustände beider
      Backends. 1300 reguläre Tests auf diesem Stand; keine Live-Importabnahme.

## Phase P14 — Gemeinsame Quellenfakten statt divergierender Suchpfade

Ergebnis: breite, budgetierte Kandidatensuche mit enger Schlussprüfung;
GUI und Indexer nutzen dieselben Quellen-/Renditionfakten, nicht zwangsläufig
dieselbe fachliche Zielprüfung. Kein Senderseitencrawler und kein Voll-Download
für jeden Kandidaten. Bestehende MediathekView-, ORF-/SRF- und Arr-Verträge erhalten.

- [x] **P14.1 — GUI-/Provider-Suche auf gemeinsamen Rendition-/Budgetowner bringen.**
      Abhängigkeit P12.1. Owner: `src/app/api/search/route.ts`,
      `content-search.ts`, `src/providers/registry.ts`, `src/types/provider.ts`,
      `rendition-quality.ts` und `ui-nzb.ts`. Ganzeintrag-HLS-Filter entfernen;
      eligibility pro konkreter URL vor Limit/Dedupe auswerten. Standard-HLS
      darf nutzbares HD-MP4 nicht verlieren; Standard-URL nicht als erfundene
      HD-Rendition auffüllen. Beide GUI-Abfrageformen nutzen denselben
      begrenzten Quellenabruf/-adapter, gemeinsame Deadline/Versuchszähler,
      strict begrenzte Query-/Limitparameter und ehrliche Coverage/Counts.
      Im Provideradapter URL-gebundene Audio-/Dimensionsherkunft erhalten.
      Generic-UI-Browsing braucht keinen erzwungenen Film-/TV-Identitätsstempel;
      automatische Indexerzuordnung bleibt streng. Provider-Partialantworten
      in der GUI explizit unvollständig, Newznab bei benötigtem Sourcefehler
      weiter fail closed; keine stillschweigende Änderung der Endpointsemantik.
      Abnahme: HLS-standard/MP4-HD und umgekehrter Fall bei deaktiviertem HLS,
      nur tatsächliche Auswahl klickbar, genaue NZB-URL/Erwartungen, Multi-
      Provider-Fehler und Budgetüberlauf, negative/NaN/extreme Limits;
      Desktop-Suche mit HD/SD/Low und kausalem RSS/NZB-Consumervergleich.
      Native Arr direkt/via Prowlarr weiterhin auf demselben Endpoint; isolierte
      Fremdconsumerprobe nur nach passender Freigabe. P10.1 danach erneut schließen.
      Entwicklungscheckpoint 08.10.2026: beide GUI-Formen verwenden denselben
      begrenzten Quellenowner mit einem zehn-Versuche-/15-Sekunden-Budget;
      per-URL-Eligibility vor Dedupe/Limit, keine erfundene HD-URL und exakte
      Audio-/Dimensionsbindung im Adapter/NZB. GUI-Partialantworten und
      begrenzte Fenster ausdrücklich sichtbar, Indexerwrapper weiter streng.
      Desktop 1280×720 Light, tatsächlich serviertes Productionbundle:
      vor/nach 2→3 Treffer bei Standard-HLS/HD-MP4, nur erlaubte HD/SD/Low-
      Buttons, Keyboard/Pointer, Leer-/Fehler-/50-von-70-/Partialzustände und
      frische saubere Konsole. Write-Gate und externe Netzsperre, keine Jobs.
      Kausale Routen-/NZB-/RSS-/Budget-/Redactiontests und reale SQLite-
      Persistenzfälle grün; finale Fork-/PG-/Containerabnahme noch ausstehend.
      Vertrag in `docs/bounded-search-contract.md`; P13/P14.2/P14.3 und P03.4
      hierdurch nicht abgenommen. Review durch Implementierer, kein Peerreview.
      Finale Abnahme auf `7d9893299a807458ffa550374a6359adf0849cab`:
      [Fork-CI 37707678742](https://github.com/superions/pingufunk/actions/runs/37707678742)
      einschließlich vollständigem PG-Gate und
      [Dockervalidierung 37707678881](https://github.com/superions/pingufunk/actions/runs/37707678881)
      erfolgreich. Native Sonarr-/Radarr-Consumer direkt/via Prowlarr,
      Werkzeugprüfung, TLS-Migrations-/post-write-Rollback, SQLitepersistenz
      und tatsächliche Legacy/v1/v2/v3-Medienworker auf beiden disposable
      Backends grün. Lokale finale 1121 Tests und Desktopzustände separat
      geprüft; die letzte Leerantwort nennt ausdrücklich das abgerufene Fenster.
      Keine DDL, öffentliche Images, Main-Integration, produktive Grabs oder
      Liveänderung. Ausschließlich der enge P10.1-Folgeauftrag ebenfalls geschlossen.
- [x] **P14.2 — Frische URL-gebundene Quellenbelege mit begrenztem Cache.**
      Abhängigkeit P13.1. Owner: `source-audio.ts`, `mp4-audio-language.ts`,
      ARTE-/ARD-Belegowner, `cache.ts` und ihre Such-/Workerconsumer.
      Katalogantwort, Identitätsmetadaten und konkrete Assetbelege typisiert
      trennen; keine ganze RSS-Antwort als Ersatz für aktuelle Medien-URL oder
      frischen Beleg behandeln. Bounded Coalescing/TTL für wiederholte Belege
      mit exakter Rendition, Provider-/Credentialkontext und Parserversion.
      Mehrere Rangefenster an dieselbe Assetversion binden, verfügbare starke
      ETag-/geeignete Last-Modified-/If-Range-Validatoren prüfen; gleiche
      Content-Length allein beweist keine unveränderte Datei. Ohne belastbaren
      Versionsnachweis keine über Zeit wiederverwendete bewiesene Assetidentität
      behaupten; konservative Unknown-/Nichtcache-Policy dokumentieren.
      Flüchtige Signaturparameter nicht für beliebige Medienidentität ignorieren;
      beweislose Probe-/Budgetfehler nicht als definitiven Nichtfund cachen.
      Frische Workerbelege und lokale Abschlussprüfung nicht wegoptimieren.
      Bestehende 32-TV-/10-Film-RSS-Versuche, 15-Sekunden-Deadline und vier
      1-MiB-Probenfenster unverändert; jede Erhöhung braucht eigenen Auftrag.
      P03.4 bleibt alleiniger Abdeckungsowner, dieses Paket liefert gemeinsame
      Frische-/Cachemechanik statt eine zweite Sprachimplementierung.
      Abnahme: gleich große geänderte Assetversion zwischen Ranges, Rotation,
      Expiry, parallele Requests, Timeout/Unknown und erneuter erfolgreicher
      Beleg; keine Belegübertragung auf fremde URL/Track/Fassung, keine neue
      GUID nur durch bessere Fakten. Gemessene Request-/Byteersparnis benennen,
      nicht vollständige Sprachabdeckung aus Cachetreffern behaupten.
      Entwicklungscheckpoint 08.10.2026: ganze RSS-Bodies und positive
      Katalog-/Sonarr-Treffercaches entfernt; Sonarr hält nur Metadatenziele
      für Pagination/Cursor, Quellen/URLs/Rechte werden erneut abgerufen.
      Leere erfolgreiche Katalogfenster maximal 15 Sekunden. Typisierter
      MP4-Faktencache (256/5min) und begrenzte Flights (128) binden exakte
      URL, serverseitigen Kontext und Parserversion; jeder zeitliche Treffer
      validiert frische erste Rangebytes/starken ETag/Gesamtgröße. Weitere
      Fenster nur mit gleichem starken ETag/If-Range, sonst Unknown. Fehlende/
      schwache Validatoren, gleich großer Versionswechsel, Rotation/Expiry,
      Timeout/Unknown→Erfolg und unabhängige Coalescingbudgets kausal geprüft.
      ARD-/ARTE-JSON weiterhin nur anfrageintern, Workerprüfung nicht gecacht.
      Vierfensterfixture 4→1 Requests, 3.145.744→1.048.576 Bytes; kein allgemeines
      Produktionsmaß. Echte RSS→NZB-Regression erneuert URL/Audio/Rechte,
      keine GUIDänderung allein durch Signaturrotation. Vertrag
      `docs/source-proof-freshness.md`. 1228 lokale Tests (19 separate
      Backendtests nicht lokal aktiv), übrige Produktgates grün; neue Fork-/
      Backend-/Containergates vor finaler Abnahme offen. Keine DDL/UIlayout-
      änderung, neuen Grabs oder Produktionsmutationen.
      Finale Abnahme auf `2f98a1a25c3c42002fd09428652d793c7a30b9f8`:
      [Fork-CI 37713227718](https://github.com/superions/pingufunk/actions/runs/37713227718)
      inklusive PostgreSQL und
      [Containerkette 37713227755](https://github.com/superions/pingufunk/actions/runs/37713227755)
      erfolgreich. SQLite/PG-Medien- und Arr-Consumerketten sowie Restart/
      Rollback bestanden; Frischefälle über kausale synthetische Range-/RSS-
      Regressionen geprüft, nicht als Produktionsmessung dargestellt.
- [x] **P14.3 — Verfügbarkeit und verschiedene Datumsarten explizit modellieren.**
      Abhängigkeit P13.1/P14.1. Owner: Provider-/`ApiResultItem`-Adapter,
      TV-Matcher, `mediathek.ts` und Search-/RSS-Serializer. Filmproduktionsjahr,
      Episoden-Airdate, Katalogtimestamp und belegte Medienverfügbarkeit nicht
      über ein unspezifisches `timestamp` gleichsetzen. Nur tatsächlich gelieferte
      strukturierte Verfügbarkeits-/Rechteinformationen übernehmen, sonst unknown;
      keine erfundenen Daten aus HTML/TV-Termin oder pauschalem HEAD-Erfolg.
      Vorabfolgen in expliziter Einzel-/Staffelsuche anhand vorhandener Quelle
      und sicherer Identität nutzbar halten, kein zusätzlich nötiger RSS-Grab.
      Abnahme: synthetisch bereits verfügbar/future Airdate, abgelaufene Rechte,
      fehlende Verfügbarkeitsangabe und widersprüchliche Datumswerte; RSS behält
      sein bisheriges eigenes Vergangenheitsfenster. Eine automatische RSS-
      Vorabfreigabe wäre eine eigene Produktentscheidung, nicht dieses Refactoring.
      Entwicklungscheckpoint 08.10.2026: Quellenbroadcast, Katalogupdate,
      unspezifizierte SRF-Date, Metadaten-Airdate und Filmjahr getrennt;
      bestehende IDs/RSS-pubDate erhalten. ARTE-/ARD-Rechte aus vorhandenen
      JSON-Ownern als exakte URL-gebundene Fakten, unmögliche/reverse Daten
      abgelehnt; expired/not-yet nicht serialisiert, fehlende Rechte unknown.
      Mehrfach identische Episodentitel nicht mehr über Katalogtimestamp/
      neueste Episode zugeordnet. Tatsächlicher Newznab→NZB-Regressionstest
      bestätigt zukünftiges Airdate in Einzel-/Staffelsuche, kein RSS-Advance.
      Keine UIlayoutänderung, neuen Sendercrawler, Budgeterhöhung oder DDL.
      Vertrag in `docs/content-date-contract.md`. Ganze alte RSS-Antwortcaches
      können erneute Rechteprüfung umgehen; Frischegrenze P14.2 und finale
      Fork-/Backend-/Containerabnahme bleiben offen, Checkbox nicht geschlossen.
      1212 finale lokale Tests (19 separate Backendtests lokal nicht aktiv),
      Lint, Typecheck, Formatcheck, Productionbuild und Diffcheck erfolgreich.
      Neue Beobachtungszeit im Order-Invariant-Test auf gleichen Moment
      fixiert; Edition-/URL-/Rechteassertions nicht abgeschwächt.
      Finale kumulative Abnahme auf dem unverändert enthaltenen Datumsvertrag
      in `2f98a1a25c3c42002fd09428652d793c7a30b9f8`: dieselben oben verlinkten
      Fork-/PG-/Containergates erfolgreich. P14.2 entfernt den beschriebenen
      Whole-RSS-Frischeumweg; keine automatische RSS-Vorabfreigabe eingeführt.

## Phase P15 — Robuster Einzelworker und begrenzte Betriebsoberfläche

Ergebnis: sichere Jobbesitzgrenze, skalierende Historyreads und verlässlicher
Runtimezustand. Keine Erlaubnis für mehrere Worker, Redis oder Replikazahlerhöhung.

- [x] **P15.1 — Jobbesitz und Shutdown im Single-Worker-Vertrag absichern.**
      Owner: `download-manager.ts`, `instrumentation.ts`, `download.ts`,
      `scripts/application-entrypoint.mjs` und bei Bedarf beide Prisma-Ketten.
      Prozesslokales `processingPromise`/Semaphore verhindert keinen zweiten
      Prozess gegen dieselbe DB. Einen expliziten exklusiven Workerbesitz mit
      atomarem Claim/Fencing und begrenzter Lease/Recovery implementieren;
      zweiter Prozess darf weder denselben Job starten noch aktive fremde
      Jobs durch Startup-Recovery failed markieren. Writes-/Maintenancegate
      bleibt vorgeschaltet. Signalweiterleitung um kontrolliertes Drain/Abort
      eigener Transfers/Kindprozesse und persistierten Endzustand ergänzen.
      Kein blindes Wiederholen nach ungewissem Commit oder Crash, kein
      PG-only-SKIP-LOCKED-Vertrag für ein weiter unterstütztes SQLiteprodukt.
      Abnahme: zwei disposable Prozesse auf beiden Backends, Workercrash/
      Leaseablauf/verspäteter alter Besitzer/Shutdown im Mux/DB-Ausfall;
      höchstens ein wirksamer Besitzer, keine fremde Datei beschädigt, vorhandene
      Jobs/IDs und folgender Queuefortschritt erhalten. Falls neue Spalten nötig,
      append-only Migrationen und Maintenance-/post-write-Rollback beider Provider
      prüfen. Neue Entwicklungsprobe ist kein Produktionsrestart.
      Entwicklungscheckpoint 08.10.2026: exklusiver Config-CAS/Fenceowner auf
      beiden Backends ohne neue DDL; Recovery/Status-/Progress-/Completionwrites
      hinter Besitz-/Wartungsgrenze. Signal durch HTTP/Quellenbeleg/Probe/yt-dlp/
      FFmpeg, tatsächliches Child-close vor Release; Next-Signalowner und
      begrenztes Drain. Echte SQLite-Zweiprozessprobe mit Heartbeat, altem Fence,
      Crash/30s-Expiry, aktivem HTTP-Abbruch, Folgequeue und unverändertem Nachbarn
      bestanden. 1263 lokale Tests vor den abschließenden Reviewkorrekturen grün.
      PG-Ausfall/Zweiprozess- und tatsächlicher Container-Muxshutdowngate neu
      angeschlossen, noch nicht abgenommen. Vertrag
      `docs/worker-ownership-contract.md`; alte/neue Writer nicht mischen,
      unverändert Parallelität eins, kein Produktionsrestart oder Gesamtabschluss.
      Erste Fork-PG-Probe bestätigt beide echten Zweiprozess-/Crash-/Expiry-
      Backends und den neuen Besitzverlust bei DB-Ausfall. Der anschließende
      bestehende Denied-role-Test scheiterte an der durch diese neue Writerprobe
      erzeugten Checkpointzeile im gemeinsam genutzten Testschema. Reconnect
      erhält deshalb ein eigenes disposable Schema; die wichtige Null-Checkpoint-
      Assertion der verweigerten Rolle bleibt unverändert. Frische Gesamtprobe
      erforderlich, P15.1 bleibt offen.
      Der native Mux-Shutdowngate auf `4c44255` erreichte tatsächlichen FFmpeg,
      scheiterte aber am unmittelbar gelesenen terminalen Jobzustand nach Restart.
      Der servierte Next-Build bündelt Download-Manager in getrennten Modulgraphen;
      Instrumentation-Signalowner und Route dürfen keine getrennten leeren
      Prozesszustände besitzen. Versionierter gemeinsamer Prozessslot samt
      Reload-Regression ergänzt; DB-Lease/Fence und unveränderte terminale
      Assertion bleiben verbindlich. Neue native Containerabnahme nötig.
      Finale Abnahme 08.10.2026 auf `75b3318cb414218c624aee7c195084dda39d1d17`:
      [Fork-CI 37720415235](https://github.com/superions/pingufunk/actions/runs/37720415235)
      mit beiden echten Zweiprozess-/Crash-/Expiry-/Ausfallgates und
      [Containerkette 37720415340](https://github.com/superions/pingufunk/actions/runs/37720415340)
      erfolgreich. Tatsächlicher FFmpeg-Mux unter SIGTERM auf SQLite/PG beendet,
      Status sofort failed ohne Validierung, Exit 143, Restart/Folgejob mit
      regulärer fertiger Datei und unverändertem Nachbarhash; PG-Ausfall samt
      Fehlerwrite-Pause/Reconciliation ebenfalls bestanden. Keine schwächere
      Assertion. Erstversuch wegen Registry-429 gescheitert; genau ein
      kontrollierter Wiederlauf nach dieser externen Pullstörung. Einzelworker,
      keine gemischten alten/neuen Writer oder produktiver Restart freigegeben.
- [x] **P15.2 — History-/Queue-Reads und Polling begrenzen, ohne Arr-Einträge zu verlieren.**
      Owner: `download.ts::{getHistory,getQueue}`, `sab-api.ts`,
      `/downloads` und beide DB-Querypfade. Aktuell wird die gesamte History
      alle fünf Sekunden gelesen. Native SAB-Paging-/Filter-/ID-Verträge vor
      Änderungen an Sonarr/Radarr-Consumern verifizieren; gültige Parameter
      serverseitig begrenzen, stabile Sortierung/Paging und benötigte gezielte
      Jobreads anbieten. GUI mit Paging, serverseitigen Counts und an Sichtbarkeit/
      aktive Jobs angepasstem Polling; keine Retentionlöschung oder blinde
      Default-Abschneidung unimportierter Altjobs. Mutationstimeouts bleiben
      ausdrücklich nicht als retry-sicherer 3-Sekunden-Read behandelt.
      Abnahme: große synthetische History auf SQLite/PG, gleiche Zeitstempel,
      paralleler neuer Abschluss, gezielte alte Download-ID und Arr-Consumer
      verlieren keinen Import-/Failed-Eintrag. Reale Desktopfilter/Paging,
      stale/error-Zustände und gemessene Query-/Antwortgrenzen; keine Löschung.
      Entwicklungscheckpoint 08.10.2026: validierte SAB-Seiten-/Kategorie-/
      Status-/Such-/ID-Parameter, ausdrückliches `limit=0`/fehlendes Limit
      weiterhin alle passenden Jobs; keine neue Defaultabschneidung.
      Gemeinsamer Snapshot für Counts/Zeilen, stabile Timestamp-/ID-Sortierung,
      historische NULL-Abschlüsse zuletzt. GUI höchstens 50 Zeilen pro Seite,
      generationensichere Reads, sichtbarkeits-/aktivitätsabhängiges Polling,
      explizite stale/error-Zustände. Desktop 1280×720 Light im tatsächlich
      servierten Bundle: 1050→50 Zeilen, Seite zwei, Keyboard-/Pointerfilter,
      alter Treffer, Kategorie/Failed, Leerantwort und nativer DB-Fehler/Recovery.
      Konsole sauber; IAB meldet Vergleichtabs weiterhin visible, daher keine
      tatsächliche hidden-Tab-Abnahme behauptet. Pollentscheidung kausal getestet.
      Native SQLiteprobe mit 1050 History-/60 Queuezeilen und gleichzeitigem
      Abschluss grün; Antwort am GUI-Testserver 176798→8499 Bytes, alte ID
      weiter gezielt lesbar. Finale PG-/Fork-/Containerabnahme bleibt offen.
      Vertrag in `docs/download-read-contract.md`; kein Job/History gelöscht.
      Finale Abnahme auf `0d2d10745760cff7f2fdba63751d18af09825539`:
      [Fork-CI 37711382041](https://github.com/superions/pingufunk/actions/runs/37711382041)
      einschließlich eigener großer PG-Historyprobe und
      [Containerkette 37711382103](https://github.com/superions/pingufunk/actions/runs/37711382103)
      vollständig grün: native Arr direkt/via Prowlarr, Tooling,
      TLS-Migration/post-write-Rollback, SQLitepersistenz und tatsächliche
      Medienabschlüsse auf beiden Backends. 1175 finale lokale Tests,
      Lint/Typecheck/Format/Build/Diffcheck und tatsächliche Desktopzustände
      separat geprüft. IAB-Visibilitygrenze bleibt transparent, keine mobile
      oder simulierte native hidden-Tab-Abnahme. Kein Produktivzugriff.
- [x] **P15.3 — Nichtblockierende Runtimeprüfung und schonender Volume-Start.**
      Owner: `/api/system`, vorhandener Healthvertrag, tatsächliche FFmpeg/
      ffprobe-/yt-dlp-Auflösung und `entrypoint.sh`. Synchrone bis zu zweimal
      fünf Sekunden lange Toolchecks im Request durch begrenzte asynchrone,
      kurz gecachte Capabilitychecks der tatsächlich genutzten Binaries ersetzen.
      Liveness, DB-/Schema-Readiness, Write-Gate und Workerzustand unterscheiden;
      historische TVDB-Tabellen nicht als aktiven Metadatencache darstellen.
      Kein Installieren, Queue-Start oder DB-Migrieren durch Health-GET.
      Recursive `chown/chmod` bei jedem schreibenden Boot ersetzen durch gezielte
      Initialisierung/Prüfung der eigenen benötigten Verzeichnisse; bestehende
      Medien-/Nachbarrechte nicht umschreiben. Unbeschreibbare eigene Pfade
      klar diagnostizieren, nicht pauschal jeden Volumeinhalt reparieren.
      Abnahme: fehlende/langsame/abweichend konfigurierte Tools ohne Eventloop-
      Blockade, DB-Ausfall/Readonly/Single-Worker-Status; synthetische gemountete
      Sentinels behalten Owner/Mode/Inhalt über Start/Restart/Maintenance,
      eigene Downloads bleiben möglich. Beide Backend-Containerketten prüfen.
      Entwicklungscheckpoint 08.10.2026: asynchrone, begrenzte Capability-
      Prüfungen tatsächlicher Binaries, eigene Healthroute mit Liveness/
      aktueller DB-Erreichbarkeit/kurz gecachter voller Schemaprüfung und
      explizit prozesslokalem Workerzustand; kein P15.1-Besitznachweis.
      Eigener Volumehelper erstellt/chownt nur neue benötigte Verzeichnisse,
      prüft als tatsächlicher User und lässt bestehende Medien-/Nachbarrechte
      unangetastet. Maintenance ohne Dateisystemwrites. Containerharnesses
      um Start-/Restart-/Readonly-Sentinels auf beiden Backends erweitert.
      Tatsächlich serviertes Desktopbundle 1280×720 Light: gematchter
      Vorher-/Nachherzustand, Pointer/Keyboard, kontrollierter nativer DB-Fehler
      entfernt alte gesunde Anzeige; langsame ffprobe zeigt Timeout, Konsole
      sauber und keine Jobs. Vertrag `docs/runtime-readiness-contract.md`.
      Finale Fork-/PG-/Containerabnahme noch offen, daher Checkbox unverändert.
      Finale Abnahme auf `c8ccdcc91f8bb42c2d99d8790c12c6b5c3f90853`:
      [Fork-CI 37709293171](https://github.com/superions/pingufunk/actions/runs/37709293171)
      samt vollständigem PG-Gate und
      [Containerkette 37709293111](https://github.com/superions/pingufunk/actions/runs/37709293111)
      erfolgreich. Eigene gemountete Owner-/Mode-/Inhaltssentinels über
      Start/Restart/Maintenance, Readonlywriter-Abbruch vor Queue sowie reale
      Medienabschlüsse beider Backends nachgewiesen; native Arr-Consumer,
      Tooling und TLS-Migrations-/PG-post-write-Rollback ebenfalls grün.
      1141 finale lokale Tests, Lint/Typecheck/Format/Diff grün; Build für
      unveränderten Quellstand wiederverwendet. Die zuvor fehlende explizite
      `.dockerignore`-Helperfreigabe korrigiert; gescheiterter erster Build
      bleibt als Befund dokumentiert. P15.1-Besitzgrenze hierdurch nicht erledigt.
- [x] **P15.4 — Bestätigte Enqueues von ungewissen Wiederholungen unterscheiden.**
      Owner: `sab-api.ts::POST`, `download.ts::addToQueue`, UI-NZB-Consumer und
      bei Bedarf beide append-only DB-Ketten. Requestbody/Parameter vor Parsing
      begrenzen; kompatible NZB-Versionen und Endpoints erhalten. Eigene UI
      erhält einen optionalen stabilen Auftragsschlüssel, damit ein verlorener
      Response nach erfolgreichem Commit beim bewussten Wiederholen genau dieselbe
      Job-ID zurückliefert, ohne zweiten Transfer. Schlüssel an Kategorie und
      exakten normalisierten Auftrags-/Erwartungspayload binden, abweichender
      Inhalt unter gleichem Schlüssel wird Konflikt. Keine automatische
      Zusammenlegung nur nach Titel, ähnlicher URL oder Film-/Serien-ID;
      absichtliche neue Grabs und unterschiedliche Fassungen bleiben möglich.
      Native SAB-Clients ohne diesen zusätzlichen Schlüssel behalten ihren
      bisherigen Vertrag; nach ungewissem Ergebnis nicht automatisch retryen.
      Begrenzte Schlüssel-Retention ohne Job-/History-/Dateilöschung dokumentieren.
      Abnahme: parallel gleicher Auftrag, verlorene Commitantwort, Restart,
      fremder Payload mit gleichem Schlüssel und expliziter neuer Auftrag auf
      SQLite/PG; exakt eine Einreihung pro belegtem Schlüssel. Malformer/
      übergroßer Body erzeugt keinen Job; bestehende native addfile-Clients
      und Legacy/v1/v2/neue Erwartungen bleiben kompatibel.
      Entwicklungscheckpoint 08.10.2026: optionale UI-Auftragsschlüssel mit
      sieben Tagen Gültigkeit, maximal 64 pending Browserkeys ohne URLs/NZBs;
      kanonischer Payloadfingerprint bleibt über NZB-Transportzeitstempel stabil.
      Atomic Receipt-/Jobtransaktion auf beiden append-only Ketten, unabhängige
      Bestätigung überlebt History-Delete/Retry; keine native URL-/Titeldedupe.
      Body-/Query-/UTF8-/Deadlinegrenzen vor Parsing; 409 bei Payloadkonflikt,
      keine automatische Retrymutation. Desktop 1280×720 Light Suche/Filme:
      Pointer/Keyboard, HD/SD/Low, verlorene Antwort/Reload/same-ID-Readback,
      Cancel/Confirm des neuen Auftragsdialogs; Konsole leer, keine realen Jobs.
      1257 lokale Tests, Lint/Typecheck/Format/Build erfolgreich; separate PG-
      und Container-Restart-/Rollbackgates noch ausstehend, Checkbox bleibt offen.
      Review korrigierte Receiptverlust bei History-Delete und zeitabhängige
      XML-Fingerprints. Historisches Image ist nach neuer DDL nicht kompatibel:
      sichere Ablehnung, vollständiges Backup/Restore und kompatible Maintenance
      werden geprüft, kein behaupteter historischer Code-Rollback.
      Vertrag `docs/enqueue-intent-contract.md`; P15.1-Workerbesitz separat.
      Erste Fork-CI `37715047688` scheiterte an einem realen parallelen
      SQLite-Schreibkonflikt und einer veralteten PG-Driftfixture. Serieller,
      begrenzter SQLite-Admissionpfad ergänzt; weder BUSY-/Commitretry noch
      abgeschwächte Parallelassertion. PG-Fixture wendet beide späteren DDLs
      vor dem vollständigen Schema-Gate an. 1259 lokale Tests und übrige Gates
      erneut erfolgreich; frische Fork-/Backend-/Containerabnahme offen.
      Folgeprüfung `37717534652`: vollständige PG-CI einschließlich echter
      Zwei-Prozess-/Crash-/Ausfallproben grün. Containerlauf `37717534667`
      scheiterte am veralteten SQLite-Ledgerzähler (fünf statt sechs
      Migrationen); jetzt gesamte tatsächliche append-only Kette samt Namen,
      Checksummen und abgeschlossenen Zuständen verglichen. Kein gelockerter
      Schemaguard, frischer Containerlauf weiterhin erforderlich.
      Finale kumulative Abnahme 08.10.2026 auf `75b3318` mit Fork-CI
      [37720415235](https://github.com/superions/pingufunk/actions/runs/37720415235)
      und Containerkette
      [37720415340](https://github.com/superions/pingufunk/actions/runs/37720415340)
      bestanden: parallele Receipt-/Jobatomarität beider Backends, verlorene
      ACK/Restart mit gleicher Job-ID, Payloadkonflikt und bewusst neuer Auftrag,
      Legacy/v1/v2/v3 sowie vollständiges Receipt-Backup/Restore. Historische
      Imageablehnung und kompatible aktuelle Maintenance geprüft, kein
      funktionaler historischer Code-Rollback behauptet. Desktopgates und
      vorhandene Produktgates wiederverwendet; keine neue DDL seit diesem Stand.

## Phase P16 — Ownergrenzen bereinigen, ohne das Produkt neu zu schreiben

Ergebnis: verständliche gemeinsame Pipeline statt weiterer Sonderpfade und
leichter überprüfbare künftige Upstreamübernahmen.

- [ ] **P16.1 — Bewiesene Verträge entlang ihrer Owner extrahieren und bereinigen.**
      Abhängigkeit P12.1/P12.2, P13.1 und P14.1; P14.2/P15.1 nur vor Refactoring
      ihrer konkreten neuen Owner. `mediathek.ts` nach Abrufkoordination,
      fachlicher Zuordnung und Releaseassembly aufteilen; `newznab.ts` bleibt
      Transport-/Titel-/GUID-Serializer statt zweiter Matcher. Transfer,
      Queuebesitz und Medienabschluss in `download-manager.ts` klar trennen;
      Settingskarte/Formzustand in kleine bestehende UI-Owner extrahieren.
      Typisierte Cache-/Providerwerte statt unbeschränktem `Record<string, any>`;
      obsolete bestätigte Zweige und falsche Kommentare gezielt entfernen.
      Kein generisches Pluginframework, neue Microservices, neuer Proxy,
      permanente Titel-Allowlist oder großflächige Namens-/Ordner-Umsortierung.
      Upstream pro kohärentem Paket erneut prüfen; veröffentlichte IDs/GUIDs,
      URL-Selektoren, Kategorie/Paths, v1/v2/neuer Jobvertrag und SQLite-/PG-
      Semantik bleiben durch Consumerregressionen gesichert. CI-Matrix an
      repräsentativen bekannten Lücken ausrichten: GUI-HLS/MP4, verschiedene
      Toleranzen/Jahrgrenzen, TBA/Vorabfolge, Sourcefehler, Retry/Restart und
      sichere File-/Importzustände; keine behauptete Qualität allein aus Testzahl.
      Abnahme: buildbare kleine Checkpoints, kein doppelter fachlicher Owner,
      vollständiger Read-/Call-/Writepfad erneut reviewt, relevante reguläre
      Gates und tatsächliche Backend-/Container-/Consumerketten grün. Erhaltene
      historische Vertragsdokumentation klar als solche markieren, aktuellen
      Einstieg über diesen TODO halten; kein zweiter Plan oder Done-Archiv.
      Erster Entwicklungscheckpoint 08.10.2026: bestehende Abruf-/Koordinaten-/
      Ruleset-/Releaseowner getrennt, versionierter NZBparser beim Releasevertrag,
      Series/Filmcache als echte Union ohne `any`. Keine neue Matcherpolitik,
      IDs/GUIDs/Kategorien und Parser-Versionen unverändert; 33 verschobene
      Functionbodies zusätzlich mechanisch abgeglichen. Settingsdraft und vier
      Matchingkarten extrahiert, Fremdkarten-/Samekey-Race geschützt; Busy-Save/
      Reloadfokus korrigiert. Tatsächliches Desktopbundle, gematchte Karten,
      12/15/2-Save/Reload, API-/DBreadback, Sprachpräferenz und verweigerter Write
      unter echter disposable SQLite-Sperre geprüft. Keine neuen Jobs/externer
      Providerzugriff. 1303 reguläre Tests/übrige Gates grün; Transfer/Completion-
      Extraktion und finale Containerabnahme bleiben offen, Checkbox unverändert.
      Zweiter Entwicklungscheckpoint nach nativer P15.1-Abnahme:
      `download-transfer.ts` für exklusive Bytes/Finish/geschlossene Fehler,
      `download-completion.ts` für Ownjob-Veröffentlichung und gefenceten
      Probe-/Dateiabschluss. Manager behält Scheduling, HLS/Muxkoordination und
      Failure-Reconciliation; 14 Functionbodies identisch und genau einem Owner
      zugeordnet. Vollständiger Call-/Read-/Writepfad erneut geprüft, keine neue
      DDL/API/Versions-/Pathsemantik; obsolete Inaktivitäts-/Cachekommentare
      korrigiert. 143 fokussierte und 1303 reguläre Tests, Lint/Typecheck/Format/
      Productionbuild/Diffcheck grün. 21 separate Backendfälle laufen im eigenen
      PG-Gate, nicht als lokal ausgeführt gezählt. Finale Fork-/Containerkette
      dieses Extraktionsstands steht noch aus; Checkbox bleibt offen.
