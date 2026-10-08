# Gemeinsamer begrenzter Quellenabruf für GUI und Indexer

## Owner und Erhaltungsgrenze

`content-search.ts::queryContentWindow` ist der Quellenowner für die normale
GUI-Suche, `providers=true`, den expliziten `provider` und den bisherigen
Indexerwrapper `queryContent`. Es gibt keine zweite Suchroute oder XML-
Umschreibung. MediathekView und opt-in ORF teilen eine paginierte Katalogabfrage;
SRF behält seinen bestehenden API-/Credential-/HLS-Vertrag. Keine Senderseiten
abgrasen oder fremde Daten aus HTML als Sprach-/Identitätsbeleg übernehmen.

GUI-Browsing kennt ohne geprüften Film-/TV-Kontext keine sichere Medienidentität.
Kategorie, Titel und Katalogslot erfinden keinen Film, keine Folge, Sprache oder
Pixelmaße. Die beiden ausgelieferten GUI-Abfrageformen behalten ihre IDs:
Kanal/Topic/Titel/Katalogtimestamp bzw. die ursprüngliche SRF-URN im Providerform.
Die normale SRF-GUI-ID bleibt unverändert. Untrusted Katalog-IDs dürfen keine
Providerherkunft liefern; nur der interne SRF-Adapter setzt deren Herkunft.
Indexer-GUIDs und aktuelle NZB-Medien-URLs bleiben beim bisherigen Owner.

`ProviderContentItem` und `providers/content-item.ts` erhalten explizite Audio-
und exakte URL-gebundene Dimensions-/Quellaudiobelege aus internen Adaptern.
Die Raw-MediathekView-Whitelist akzeptiert solche Felder weiterhin nicht.
Eine HD-URL wird niemals aus einer fehlenden HD-URL und der Standard-URL erfunden.

## Bounded GUI-Vertrag

`GET /api/search` akzeptiert einen getrimmten Suchtext mit 2–256 Zeichen, ohne
Steuerzeichen, `limit` als ganze 1–100 (default 50), optionale Typen all/movie/
series und ausschließlich mediathekview/orf/srf als explizite Provider.
Widersprüchliche doppelte Scopeparameter, Teilzahlen, NaN, extreme/negative
Limits und unbekannte Provider/Typen ergeben 400 vor dem Quellenabruf.
Zu kurze Texte behalten die bisherige leere Antwort mit „Query too short“.
Keine Suchtexte, rohe Exceptions oder Providerantworten in Providerlogs.

Eine GUI-Anfrage verwendet genau ein HTTP-Budget mit zehn Versuchen und
15-Sekunden-Deadline, einschließlich parallelem SRF und aller Folgeseiten/
Retries. MediathekView liefert höchstens fünf Seiten à 1.000 Rohkandidaten;
SRF liefert sein bestehendes begrenztes Fenster bis 100. Kein Aufweiten des
32-Versuche-Vertrags expliziter TV-Identitätssuchen oder der vier MP4-Fenster.
Eine übergroße Providerseite wird verworfen, nicht nachträglich unbemerkt
abgeschnitten. Die API liefert keine Gesamtzahl des entfernten Katalogs.

Renditioneligibility wird pro tatsächlicher URL vor Sprachfassungsdedupe und
Ergebnislimit geprüft. Erlaubt sind HTTP/HTTPS ohne Userinfo oder Leerzeichen;
HLS und stabile SRF-Streamreferenzen benötigen weiterhin HLS-opt-in. Standard-
HLS kann nutzbares HD-/Low-MP4 nicht verstecken; HD-HLS entfernt kein Standard-
MP4. `createUiNzbDownloads` verwendet denselben `selectRenditions`-Owner wie
RSS und bietet dieselbe exakte URL nur einmal an. GUI-Buttons behandeln die
serververfassten NZBs als opak. HD/SD/Low bleiben Katalogslots, keine neue
Auflösungszusage. Ein Quellaudiobeleg für eine andere Rendition wird nicht
übertragen; deren Erwartung bleibt unbekannt. Vorhandene exakte Dimensionen
werden nur bei der zugehörigen URL in v3 übertragen.

`type=movie` verwendet weiterhin die konfigurierte absolute Mindestdauer,
keinen erfundenen 60-Minuten-Filmstempel. Generic-/Serien-Browsing erfordert
keine automatische Film-/TV-Schlussprüfung. Provider-spezifische alte interne
Suchhelpers bleiben kompatibel, steuern aber die GUI nicht mehr separat.

## Coverage und Fehler

`coverage.complete` bedeutet: der ausgewählte begrenzte Abruf hat keinen
benötigten Quellfehler. Es bedeutet nicht „alle Mediatheken erschöpfend geprüft“.
Jede ausgewählte Quelle hat complete/failed/disabled und einen Kandidatenzähler;
`candidateWindowLimited` markiert ein erreichtes Abruffenster,
`eligibleCount` die nach Eligibility/Editionwahl nutzbaren Zeilen darin,
`returnedCount` die tatsächliche Antwort und `resultLimitReached` deren Limit.
Providercounts zählen eligible Zeilen, nicht einen behaupteten Gesamtbestand.
Der Client bestätigt diese geschlossenen Felder und Widerspruchsfreiheit gegen
die tatsächliche Ergebniszahl, übernimmt keine freien Fehlermeldungen.

GUI-Teilantworten erfolgreicher anderer Quellen sind mit ausdrücklichem
Unvollständigkeitshinweis erlaubt. Schlägt eine benötigte Folgeseite fehl,
werden frühere Seiten dieser Quelle verworfen, nicht als vollständiger Bestand
ausgegeben. Nur komplett ausgefallene ausgewählte aktive Quellen ergeben 502;
Konfigurations-/Snapshotfehler 503. Ohne aktivierte Quelle erscheint „kein
Katalog abgefragt“, kein bestätigter Nichtfund. Ein leeres Teilfenster wird
ebenfalls nicht als „keine Ergebnisse“ ausgegeben. Antworten sind no-store.

Automatische Indexer-/Rulesetconsumer verwenden weiterhin `queryContent`:
bei einem benötigten Quellfehler NULL/fail closed, keine GUI-Teilantwort und
keine als leerer Erfolg gespeicherte Störung. Begrenztes In-flight-Coalescing
ohne explizite Deadline bleibt erhalten; eine fremde Anfrage erbt nicht das
Restbudget eines anderen Calls. Der Settingssnapshot gilt für den ganzen Call.

## Abnahme und offene Folgearbeit

Kausale Routen-/Quellen-/Adapter-/NZB-Tests sichern beide GUI-Formen, einzelne
Provider, HLS/MP4 in beiden Richtungen, fehlende/doppelte Slots, tatsächliche
RSS→NZB-Consumerparität, Audio-/Dimensionsbindung, Bad-Scope-/Budgetgrenzen,
Folgefehler/Recovery und explizite Teilantworten bei strengem Indexerwrapper.
Die Runtimeprobe erhält den tatsächlichen GUI→NZB→SAB→DB-Pfad auf SQLite/PG,
keine bloßen XML-/Statuscodeassertions. Desktopjourneys am wirklich servierten
synthetischen Testbundle prüfen Pointer/Keyboard, erlaubte Buttons, Leer-
und Fehlerzustand, 50-von-70-Fenster und Partialhinweis mit Readback.
Keine realen Grabs; UI-Write-Gate und externe Netzsperre schützen die Probe.
Ausführung und Abnahme stehen ausschließlich bei P14.1/P10.1 im Phasen-TODO.

P13 ergänzt fachliche Gründe und Importstatus; P14.2 liefert gemeinsame
Assetfrische-/Cachemechanik, P14.3 getrennte Datumsarten. Diese Quellen-
Vereinheitlichung ist keine allgemeine Sprachvollabnahme P03.4, kein neues
Authentifizierungssystem oder Produktionsrollout. Keine DDL/Providerumschaltung
oder Umschreibung bestehender Jobs, History, Dateien oder Consumerprofile.
