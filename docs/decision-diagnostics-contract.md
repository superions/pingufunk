# Geschlossene Entscheidungsdiagnose

Entwicklungsvertrag P13.1/P13.2. Status und Abnahme im
[Phasen-TODO](../todo/proxy-retirement.md), kein Produktionsauftrag.

## Bedeutung und Grenzen

`src/lib/decision-diagnostics.ts` besitzt das geschlossene Transportvokabular:
Stage, Reason, Evidenzstatus und begrenzter Zähler. Serverentscheidungen in
Film-/Sonarrmatchern, Quellenabruf, Rendition-/Audiobeleg und lokalem Medien-
abschluss zeichnen kategoriale Fakten auf. Der Retrievalscore bleibt unverändert
und ist kein Beleg. Diagnosen ändern weder Matchpolitik noch RSS-/NZB-Identität.

Bestätigt leer im erfolgreich gelesenen **begrenzten Quellenfenster**, fehlende
benötigte Folgeseite, Quellenfehler, Versuchslimit und Deadline sind verschiedene
Fälle. Ebenso Alias-/Koordinaten-/Jahrkonflikt, fehlende Identität, Ambiguität,
Runtime-Abweichung, fehlender Audiobeleg und ungeprüfte Rendition. Neutral heißt
weiterhin nicht Deutsch. Zähler zählen ausgeführte Ownerprüfungen, **nicht**
deduplizierte Filme/Episoden; mehrere geprüfte Metadateneinträge/Renditions dürfen
mehrere Prüfungen ergeben. Überlauf bleibt sichtbar, keine Vollständigkeitsbehauptung.

`recorded` bedeutet abgeschlossene Berichtserstellung, nicht vollständigen
Katalogabruf, erfolgreiche Zuordnung, Download oder Import. Abgefangene
HTTP-Fehler stehen als Gründe im Bericht. Ein aus dem Scope entweichender Fehler
setzt `failed`, ohne seinen Text aufzunehmen. Eine cached RSS-Antwort meldet
`cached_response`: keine erfundene neue Match-/Assetprüfung. Allgemeine
Sprachabdeckung bleibt P03.4; Cachefrische wird gesondert in P14.2 bearbeitet.

## Begrenzte, kurzlebige Korrelation

AsyncLocalStorage isoliert gleichzeitige Operationen. Jede erhält eine neue
servergenerierte UUIDv4; eingehende Header wählen keinen fremden Bericht.
128 gleichzeitige Collectors, höchstens 64 verschiedene Eventkombinationen
pro Bericht, Zähler maximal 1.000.000; höhere Last liefert ausdrücklich
unvollständige statt unbegrenzt wachsende Diagnose. Nach Scopeabschluss sind
auch später laufende asynchrone Tasks vom Bericht ausgeschlossen.

Höchstens 128 fertige Berichte, TTL fünf Minuten, nur im Prozessspeicher;
Expire/Eviction und Neustart dürfen Diagnose entfernen. Keine DB-Tabelle,
persistierte Suchhistorie, Suchtexte, Content-/Arr-IDs, URLs, Tokens, Pfade,
DB-Verbindungen, Bodies, argv, freie Fehlertexte oder Confidence-Attribute.
Transportparser erstellen eine neue geschlossene Form und entfernen fremde
Felder. Zugriff auf zurückgegebene Objekte verändert den gespeicherten Bericht
nicht.

GUI-Suchroute und derselbe direkte/Prowlarr-Newznabhandler liefern die
zusätzliche Antwortkennung `X-Pingufunk-Diagnostic-Id`. Die GUI-JSON-Antwort
enthält außerdem den geschlossenen Bericht genau dieser Anfrage. RSS-/SAB-Body
und bisherige Fehlerstatus bleiben kompatibel. Kein HTTP-Reader zum Abruf
anderer Suchberichte und keine globale Diagnoseliste.
Ein womöglich entfernter Header über Prowlarr ist kein behaupteter diagnostischer
Forwardingnachweis. Der internen Kennung folgt keine neue automatische Aktion.

## Workerfehler ohne verlorene Ursache

`MediaProbeError` erhält den bisherigen sicheren Exceptiontext und trägt
zusätzlich ausschließlich validierten Reason/Evidenzstatus. Container/Streams,
Dauer, fehlende/widersprechende Sprache, falsche Dimensionen, unsicherer oder
veränderter Dateipfad und Tool-/Probeausfall werden nicht mehr an der äußeren
Catchgrenze pauschal plattgedrückt. Quellenbelege tragen ebenfalls geschlossene
Facts über sichere Exceptions; ihre bisherigen konstanten Messages bleiben.

Der echte Worker persistiert neue lokale Medienfehler als begrenzten JSON-
Suffix nach `Local media validation failed: `. Vor dem Write wird die Form
erneut validiert; beliebige Exceptiontexte/-eigenschaften werden nie kopiert.
Bestehende sichere Transfercodes/Byte-/Phasenangaben, historische Fehlermeldungen
und SAB-`fail_message` als String bleiben unverändert lesbar. Positive lokale
Medienprüfung bleibt im bestehenden `mediaValidation`-Vertrag. Keine DDL,
Job-/Historyumschreibung, Retryfreigabe oder Importbehauptung.

Die Diagnose macht nicht sämtliche historischen Dockerlogs privat. Es gibt
keine Shell-/Dockerlog-API oder Rohantwortanzeige. Entscheidungen werden an
ihren Ownern aufgezeichnet, nicht aus Logtexten zurückgeraten.

## Bedienung und tatsächliche Zugriffsgrenze

Suche und Filme zeigen die Gründe der gerade ausgeführten Anfrage, auch bei
Fehlerantworten. Die Route `/logs` (Navigation „Diagnose“) ersetzt den alten
Dockerlog-Platzhalter. Sie liest ausschließlich den letzten geschlossenen
Suchbericht dieses Browser-Tabs aus optionalem Sessionstorage, maximal fünf
Minuten/32 KiB. Kein Suchtext oder Quellen-/Bibliotheksinhalt wird dort gespeichert.
Ein neuer Versuch entfernt zuerst den alten Bericht. Fehlende/abgelaufene
Berichte heißen unbekannt, nicht bestätigt leer. Historische Shows sind keine
Suchdiagnose; die Oberfläche verweist auf Anfrage und Download.

Downloads bieten einen ausdrücklich lesenden Button pro bestehendem Job.
`GET /api/downloads/<UUID>/diagnostics` erlaubt weder frei gewählte URLs,
Dateipfade, Provider noch Queryparameter. Der Read ist begrenzt/coalesced
(maximal acht aktive Jobs, keine globale Liste). Neue Diagnosen bestehen nur
aus geschlossenen Enums und Zählern; alte freie `fail_message`-Texte werden in
der GUI nicht übernommen. Native SAB-Antworten bleiben kompatibel.

**Pingufunk besitzt derzeit keinen eigenen Login.** Die Route hat dieselbe
bestehende Lesegrenze wie History und Jobdaten; eine UUID oder ein vermeintlich
privater Routenname ist keine Authentifizierung. Installationen müssen die
vorhandene Oberfläche und APIs über ihren tatsächlich gewählten Zugang schützen.
Es wird weder ein bestimmter Proxy noch TLS vorausgesetzt. Kein globaler
Docker-/Shell-/HTTP-Reader wird freigeschaltet. Diagnosebuttons führen keine
Grabs, Retries, Overrides, Löschungen oder Imports aus.

## Datei und optionaler Arr-Import sind getrennte Belege

Für Completed wird der bestehende Kategorie-/Mapping-/Pfadowner **lesend**
verwendet: sichere reguläre lokale Datei, keine Symlinks, positive Größe genau
wie im Job. „Geprüfte Datei vorhanden“ benötigt zusätzlich gültige gespeicherte
Medienfakten. Die Medienchecks stammen vom Abschluss, keine neue Probe oder
aktueller kryptografischer Inhaltsnachweis. Alte Jobs ohne Fakten bleiben
unverifiziert. Eine native Arr-Verschiebung darf unsere lokale Datei entfernen;
das ist getrennt vom Importstatus zu prüfen.

Optionale Sonarr-/Radarr-Anbindung verwendet ausschließlich vorhandene
serverseitige Secretquellen und den GET-only-Client mit Unterpfad/HTTP-Support.
Deaktiviert bedeutet unbekannt ohne Secret-/Netz-I/O. Maximal zehn Versuche,
acht Sekunden, keine HTTP-Retries; Kontextwechsel, Fehler und unvollständige
Fenster bleiben unavailable/unknown. Unterstützte API-Verträge: Sonarr 3/4,
Radarr 6. Die Prüfung beruht auf den offiziellen API- und Versionsquellen,
insbesondere [Sonarr v4.0.20.3014 HistoryController](https://github.com/Sonarr/Sonarr/blob/v4.0.20.3014/src/Sonarr.Api.V3/History/HistoryController.cs)
und [Radarr v6.4.4.10685 HistoryController](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/History/HistoryController.cs),
ergänzt durch [Sonarr API](https://sonarr.tv/docs/api/) und
[Radarr API](https://radarr.video/docs/api/).

Die importierte History muss die **exakte Download-ID** und passende gepaarte
Grab-/Importereignisse besitzen. Import-File-ID/Path müssen zur aktuellen
Episode-/MovieFile, Episode-/Movie-ID, hasFile und positiven API-Dateigröße
passen. Maximal 100 History-/Queuerecords und vier Importbindungen; nicht
vollständig gelesene Fenster beweisen keine Abwesenheit oder Vollständigkeit.
Fremde Download-IDs/Titel werden niemals zugerechnet. Queue-Importblocker werden
aus deren Nachrichten auf geschlossene Gründe projiziert; Rohtexte/Pfade
werden nicht ausgeliefert.

„Arr-API meldet einen zugeordneten Import“ ist ein begrenzter **API-Beleg**,
kein physischer Dateinachweis am fremden Arr-Host. Completed, leere Queue,
Command-200 oder ein beliebiges hasFile sind kein Importbeleg. Remote-Dateien
werden nicht per SSH/Docker gelesen, keine Infrastrukturroute eingebaut.

## Kausale Gates

Parallele Scopes, Kapazität/TTL/Overflow, Late-Taskguard, Clone-/Redactiontests;
realer GUI-Routenabruf mit leerem Fenster versus fehlender Folgeseite; positive/
negative Film-/Serienmatcher; Medienprobe und tatsächlicher Workerfailure-Write
werden asserted. Unveränderte RSS-/NZB-/SAB-Consumer bleiben in den vorhandenen
regulären und disposable SQLite-/PG-/Containerketten. Neue Fork-/Containerläufe
ersetzen keine ausstehende P13.2-Desktop-/Arr-Importdiagnose.
