# Geschlossene Entscheidungsdiagnose

Entwicklungsvertrag P13.1. Status und Abnahme im
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

GUI-Suchroute und derselbe direkte/Prowlarr-Newznabhandler liefern nur die
zusätzliche Antwortkennung `X-Pingufunk-Diagnostic-Id`. RSS-/SAB-Body und bisherige
Fehlerstatus bleiben kompatibel. Noch kein HTTP-Reader, globale Diagnoseliste
oder UI-Logviewer: P13.2 besitzt deren Zugriffsschutz und Desktopbedienung.
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

P13.1 macht nicht sämtliche alten Dockerlogs privat: deren vorhandene freie
Ausgaben und bedienbarer Diagnosezugriff sind ausdrücklich P13.2. Es gibt keine
Shell-/Dockerlog-API. Entscheidungen werden an ihren Ownern aufgezeichnet,
nicht aus Logtexten zurückgeraten.

## Kausale Gates

Parallele Scopes, Kapazität/TTL/Overflow, Late-Taskguard, Clone-/Redactiontests;
realer GUI-Routenabruf mit leerem Fenster versus fehlender Folgeseite; positive/
negative Film-/Serienmatcher; Medienprobe und tatsächlicher Workerfailure-Write
werden asserted. Unveränderte RSS-/NZB-/SAB-Consumer bleiben in den vorhandenen
regulären und disposable SQLite-/PG-/Containerketten. Neue Fork-/Containerläufe
ersetzen keine ausstehende P13.2-Desktop-/Arr-Importdiagnose.
