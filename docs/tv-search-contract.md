# Breite TV-Suche ohne erfundene Identität

Stand: 01.11.2026. Technischer Vertrag; ausführbare Abnahme ausschließlich
in [P06.4/P09.5/P19](../todo/proxy-retirement.md). Entwicklungs-/native Abnahme und
der noch offene breite produktive Bestandsaudit bleiben getrennt. Ein neuer
Produktionsrollout braucht weiterhin eine gesonderte, konkrete Freigabe.
Instanzbezogene Rollout-Abnahme und Sicherungen bleiben im privaten Betriebsrunbook.

## Mehr Kandidaten finden, danach dieselben strengen Belege verlangen

Einzel- und Staffelsuchen benutzen bis zu sechs unabhängige OR-Abfragen:
Suchtext/primärer Serienname, eindeutig gebundene Regel-Themen, deutscher Name,
kanonischer Name, verifizierte Aliasse und anschließend konkrete Episodentitel
oder vorhandene verkürzte Suchbegriffe. Ein abschließendes Jahresqualifizierungs-
Suffix `(2026)` wird nur für die Abfrage entfernt. Doppelte Begriffe werden vor
dem Limit zusammengeführt; regelgebundene Themen stehen vor langen Aliaslisten.
Dies ist begrenzte Verbreiterung, keine vollständige Suche aller denkbaren Namen.

Alle Abfragen und Folgeseiten teilen das vorhandene Budget: explizite TV-Suche
maximal 32 Versuche und 15 Sekunden, RSS zehn Versuche und 15 Sekunden. RSS nutzt
freie Versuche für zusätzliche Namen, reserviert aber die übrigen Serienlookups
und die primäre RSS-Abfrage. Ein Fehler einer benötigten Abfrage veröffentlicht
kein Teilergebnis. OR-Duplikate werden vor dem Matcher zusammengeführt.
RSS-Snapshots binden den Regel-Fingerprint; während des Aufbaus geänderte Regeln
dürfen keinen alten Snapshot veröffentlichen.

Suchwörter sind keine neuen Identitätsaliasse. Nur dedizierte Themen, deren
sämtliche Regeln dieselbe TVDB-Serie referenzieren, dürfen die Serienbindung
ergänzen. Sammelthemen und Themen mit mehreren Serien bleiben ausgeschlossen.
Metadaten-, Staffel-, Folgen-, Jahres- und Laufzeitkonflikte werden nicht durch eine
breitere Abfrage beseitigt. Sprache stammt weiterhin aus Quellenbelegen, nicht
aus Sender, Suchsprache oder einem pauschalen Deutsch-Default.

## TBA ist kein Episodentitelbeleg und kein konkreter Titelkonflikt

`TBA`, `TBD`, `To be announced`, `To be determined` sowie passende `Episode N`/
`Folge N` sind Platzhalter. Automatische Zuordnung verlangt gemeinsam:

- gesicherte Serie bzw. eindeutiges Regel-Thema;
- explizite vollständige und übereinstimmende Quellkoordinaten;
- validierten Sonarr-Episodenbestand für diese Koordinaten;
- positive bekannte Solllaufzeit und Quelllaufzeit innerhalb der eingestellten
  Serientoleranz;
- keinen konkreten Titel-, Datum- oder Koordinatenkonflikt.

Ein lokalisierter Quelltitel ist nicht allein ein Metadatenkonflikt: Bei unabhängig
verifizierter Serie, vollständigen einzelnen Quell-S/E im validierten Sonarr-
Bestand und positiver passender Laufzeit darf ein deutscher Quelltitel von einem
englischen Episodentitel abweichen. Basiswerte bleiben unverändert; Konflikte
zwischen Metadatenprovidern bleiben gesperrt. Fehlende Staffel/Folge wird nicht
aus der Anfrage übernommen und Dauer entscheidet nicht zwischen mehreren Folgen.
Explizite Bereiche wie `S02E03–E05` werden nicht auf eine Folge verkürzt; mehrfach
oder widersprüchlich genannte Koordinaten sind kein Einzelzuordnungsbeleg.
Abweichender konkreter Titel plus Laufzeitkonflikt eröffnet keinen kombinierten
manuellen Ausnahmeweg. Ein bestätigter TBA-Fall bleibt separat prüfbar.

Ein bestehender Basis-Platzhalter bleibt unverändert; der Merge vermerkt nur
transient seine bestätigten Koordinaten. RSS benennt die Episode mit dem tatsäch-
lichen Quelltitel und den belegten S/E-Koordinaten, nicht mit TBA. Keine Sonarr-
Bibliotheksänderung, neuen Datenbankfelder oder Titel-Overrides. Die bisherigen
engen ARTE-Bruchteilregeln bleiben bestehen; fehlende Metadaten werden nicht
durch eine geratene Staffel ersetzt.

## Explizite einzelne Mediathek-Programme (P19.2)

`mediathekProgrammes` ergänzt den bestehenden Showkatalog optional um eine
öffentliche Programmseite, erwarteten Sender/Titel und Publisher-S/E sowie ein
getrenntes kanonisches Einzelziel. „Sommersonnenwende“ behält Quell-S2019E01 und
bindet ausschließlich das bestätigte lange Ziel S08E01. Ein unbekanntes Ziel,
die kurze Specialfassung, geänderte Quelle, AD/OV/Sonderfassung oder ein Sprach-/
Laufzeitkonflikt aktiviert keine Bindung. Es gibt keine allgemeine Umrechnung
von Jahresstaffeln und keine Zuordnung allein anhand von Titel oder Dauer.

Der gemeinsame Bindungsconsumer prüft die tatsächliche Quelle und validierte,
nicht blockierte Instanzkoordinaten. Für registrierte Programme ist dieser Weg
auch gegenüber alten Regeln exklusiv; eine widersprüchlich gewordene Quelle
darf nicht nach einem fehlgeschlagenen Bindungsversuch über normale Koordinaten
zurückkehren. Ohne frischen sicheren Zielbestand erscheint kein gebundener
Release. Quelle und kanonischer Metadatentitel bleiben unverändert gespeichert.

Nach einer expliziten Mediathek- oder YouTube-Bindung filtern ID- und Textsuche
die kanonische Episode. Publisherkoordinaten dürfen einen dabei abgelehnten
Release nicht erneut zulassen, selbst wenn dieselben Nummern als eigene
Instanzfolge vorhanden sind. Die bestehende Suche nach Ausstrahlungsjahr bleibt
erhalten; sie prüft das kanonische Ausstrahlungsdatum.

Nur die belegte deutsche Standardrendition mit gemessenen Pixeln erhält das
strikte v6-Payload im vorhandenen Joberwartungsfeld. Kalte Medienbelege bleiben
ausstehend und nutzen den bestehenden Hintergrund-/RSS-Nachlieferweg. GUI und
Arr verwenden dieselbe kanonische Titel- und Erwartungsausgabe; mehrere
Renditionbelege vervielfachen keine GUI-Quellzeile. NZB-Abruf und neue Annahme
prüfen aktuelle Bindung, frische Instanzmetadaten und geltende Toleranz erneut.
Der angenommene Job behält danach seine eingefrorene Quellen-/Zielbindung.
Der Worker prüft frisch genau Programm und Rendition; eine spätere
Katalogänderung schreibt den angenommenen Auftrag nicht um.

Der erste kanonische Release hat eine ausdrücklich zielgebundene GUID; eine
frühere neutrale GUID wird nicht rückwirkend umgeschrieben. Der vorhandene
GUID-Algorithmus und alle anderen Identitäten bleiben unverändert. Die native
Übergangsprüfung unterscheidet einen ungegriffenen neutralen Kandidaten von genau
einem späteren kanonischen Grab und erhält diese Trennung über RSS/Neustart.
Der v6-fähige Lesercheckpoint wird vor dem Producer festgeschrieben und im
isolierten nativen Post-Write-Rückweg geprüft. Ein v1–v5-only Image ist nach
Annahme eines v6-Jobs kein kompatibler App-Rückweg. Die direkte und via Prowlarr
geführte native Abnahme auf SQLite/PG18 ist erfolgreich, einschließlich genau
einer S08E01-Dateibindung und gepaarter History. P19.2 ist seit 01.11.2026 live;
exakte Release-, Rückweg- und Erhaltungsbelege stehen im Strukturreview.

## Ganze Programme für zwei Episoden (P19.3, abgenommen)

Der vorbereitende v7-Leser erhält v1–v6 unverändert. Zwei Katalogzeilen mit
derselben öffentlichen Programm-/Quellenidentität und verschiedenen Zielen
beschreiben genau zwei benachbarte Episoden derselben Staffel. Die bestehende
Katalogform bleibt erhalten; ein alter Einzelzielleser weist die Mehrdeutigkeit
sicher zurück. Beide Ziele müssen unabhängig frisch validiert, nicht blockiert
und mit positiver bekannter Laufzeit vorhanden sein. Quelllaufzeit und Summe der
Ziellaufzeiten bleiben getrennt; jede einzelne Referenz wird im angenommenen
Job eingefroren. Eine Laufzeiteinzelfreigabe erlaubt keine Mehrfolgenbindung.

Der bestehende Bindungsowner prüft neue v7-Annahme, der Worker prüft die exakte
eingefrorene ganze Quelle erneut. Es gibt keinen zweiten Job, keine Dateiteilung,
keine SQL-Migration und keine spätere Umschreibung durch Katalog-/Metadatenwechsel.
Die Importdiagnose verlangt beide exakten Zielkoordinaten derselben TVDB-Serie,
dieselbe aktuelle FileId samt Pfad und jeweils gepaarte Grab-/Importhistory.
Ein Teilimport bleibt unbestätigt. Der v7-fähige Lesercheckpoint
`2e72a284e17d4a31031012c5acce64f0cfe623aa` ist vor dem Producer festgeschrieben;
ein v6-only Image kann angenommene v7-Jobs nicht abarbeiten. Für neue
CDN-unabhängige ARD-Belege und die Quellenpriorität aus P19.5 ist der
fortgeschriebene kompatible Lesercheckpoint
`3e13fd7363641e342f7cdc4498ab47d347baeee0` erforderlich; die bestehende native
Rückwegstrecke qualifiziert ihn gemeinsam mit dem Producer.

Der Producer bindet „Der Tod ist groß“ von Quell-S10E13 an S00E02 und S00E03.
Titel/GUID/NZB und Job tragen denselben vollständigen Umfang; beide Einzelsuchen
liefern denselben einen Release. Die GUI verwendet dessen opakes NZB und zeigt
die ganze Metadatenlaufzeit. Eine Quelle wird auch dann über den vorhandenen
RSS-Nachlieferweg erhalten, wenn nur das zweite Ziel überwacht ist und noch
fehlt; die gespeicherte Discoverykoordinate bleibt stabil. Sonarr entscheidet
weiter selbst über Download und Import. Die isolierte native Abnahme prüft
alte TBA-Metadaten getrennt von einem tatsächlichen Unknown-Date-TBA-Blocker
und dessen ausdrücklich bestätigter nativer Zweizielzuordnung, ohne Metadaten
oder globale Profile umzuschreiben. Alle neun nativen Fälle auf SQLite/PG18
bestehen; PR #23/#24 und die Live-Übernahme sind seit 01.11.2026 abgenommen.

Alte Einzelfolgenregeln dürfen einen ungebundenen Quellbereich nicht auf ihren
ersten Regex-Capture verkürzen. Solche Bereiche erhalten darüber keine
kanonische Einzelfolgenfreigabe; die ungebundene Quellanzeige behält weiterhin
den vollständigen Bereich. Bestätigte ganze Programme verwenden den oben
beschriebenen Bindungsowner statt einer Teilfreigabe durch alte Regeln.

## Laufzeitkonflikte sichtbar machen, nicht automatisch übergehen

Nutzerentscheidung 10.10.2026: Eine konkrete Quelle darf bei gesicherter Serie,
eindeutigen vollständigen S/E-Koordinaten und positiver bekannter Metadaten- und
Quelldauer als Prüfkandidat sichtbar bleiben, obwohl die Serientoleranz verletzt
ist. Fremdserien, Trailer, konkrete Titel-/Jahres-/Koordinatenkonflikte, fehlende
Dauer und mehrdeutige Episoden bleiben ausgeschlossen. Die Identität wird **vor**
der Laufzeit geprüft: Eine passende Dauer darf keine gleichnamige Episode aus
mehreren möglichen Identitäten auswählen. Die Toleranz wird nicht erhöht und
Sonarrs TBA-Laufzeit wird nicht ohne Beleg durch die Quelldauer ersetzt.

Eindeutige vollständige Textnamen bzw. serienweite Aliasse aus der optionalen
Sonarr-Instanz verwenden denselben ID-Suchowner; Punkte/Leerzeichen und Groß-
schreibung dürfen sich unterscheiden. Mehrere Aliasowner liefern keinen
permissiven Textfallback. Nicht zuordenbare Suchwörter bleiben ungebundene
Textsuche; sie sind keine neue Serienidentität. Ist die Integration abgeschaltet,
bleibt der bisherige Textvertrag ohne Sonarr-Netzwerkzugriff erhalten.

Identitätsübergang: Ein zuvor ungebundener generischer Texttreffer kann nach
dieser eindeutigen Zuordnung erstmals die bestehende TVDB/S/E-GUID der ID-Suche
erhalten. Die integrierte Exact-/Staffel-/ID-/Textprüfung verlangt eine einzige
Identität für dieselbe Quelle. Das ist keine Zusage, dass die alte generische
GUID gleich bleibt. Persistierte Altjobs/History werden nicht umgeschrieben;
die Quellen-/Slot-GUID-Owner selbst bleiben unverändert. Vor einem Rollout
bestehende Dateien/History und native Upgradeentscheidungen prüfen; keine
erneuten Grabs aus dieser Entwicklungsabnahme ableiten.

Prüfkandidaten tragen die wirklichen Quellkoordinaten und belegten Medienfakten.
Ihre RSS-Beschreibung nennt beide Laufzeiten, die eingefrorene Toleranz und die
Downloadsperre. **Eine RSS-Beschreibung ist kein Sonarr-Rejection-Flag**; Newznab
unterscheidet bei demselben Endpunkt nicht verlässlich manuell/automatisch.
Deshalb ist die Sperre serverseitig: NZB-Abruf HTTP 409, SAB-addfile und direktes
Enqueue HTTP 409 bzw. typisierter Fehler **vor** Job-/Intent-Schreibzugriff und
Workerstart. Ein Consumer kann einen Grab versuchen, erhält aber keinen
Download. Auch ein normaler manueller Grab hebt diese Sperre nicht auf. Erst
geklärte Metadaten/eine separat beauftragte Ausnahmeregel erlauben einen Download.
v1/v2-Altprotokolle behalten ihren bestehenden Vertrag; sie enthalten nicht
beide Referenzen. Der neue Vergleich nutzt denselben inklusiven Dauerowner
einschließlich vorhandener Sekundenuntergrenze. Kein neuer Datenbankzustand,
Profiloverride, zweiter Indexer-Endpunkt oder automatischer Retry.

RSS-Sync übernimmt diese Prüfkandidaten nicht; seine bisherige strenge
Laufzeit- und Datumspolitik bleibt erhalten. Eine erfolgreiche Quellenprobe ist
kein Download-/Importnachweis. Budgetgrenzen können weiterhin einzelne
Renditions neutral lassen; unbekannte Qualität darf nicht als 1080p erscheinen.

## Begrenzte Hintergrundbelege statt dauerhaft neutraler Staffelseiten

Die vorhandenen Suchbudgets bleiben unverändert. Bereits gefundene, bekannte
öffentliche MP4-URLs der bestehenden Allowlist dürfen zusätzlich einen einzelnen
prozessweiten Metadatenworker nutzen. Er liest ausschließlich bis vier 1-MiB-
Range-Fenster je Quelle, höchstens 32 HTTP-Versuche je 15-Sekunden-Batch auch über
kurze getrennte Läufe, maximal 128 wartende Quellen und 512 Cacheeinträge.
Standardfassungen und HD-Renditions werden vor alternativen Fassungen geprüft.
Keine Senderseiten, zusätzlichen Hosts, Voll-Downloads, Medien-Dateischreibzugriffe,
persistierten Sprach-/Pixelbelege oder zweite Downloadqueue. Das nachfolgend
beschriebene Entdeckungsjournal nutzt vorhandene Config-Zeilen, kein DDL.
Ausfälle werden nicht automatisch retried.
Kalte MP4-Proben laufen nicht synchron im TV-Such-/RSS-HTTP-Pfad. Eine bereits
erfolgreiche Katalog-/Metadatensuche darf nicht durch eine einzelne langsame oder
abgelaufene Medienfassung scheitern und dadurch den nativen Indexer sperren.
Frische Einzelquellenfreigaben und Transferprüfungen umgehen diese Suchhinweise
weiterhin. Fehlgeschlagene gehaltene Quellen bleiben auch beim normalen
RSS-Aufwärmen gesperrt; andere Fassungen derselben Folge werden weiter geprüft.

Suchhinweise binden die komplette URL inklusive stabiler und kurzlebiger
Auswahlparameter. Positive Belege verfallen nach fünf Minuten, unbelegte Quellen
nach 30 Sekunden; Transportfehler werden nicht als negative Fakten gespeichert.
Neue Belege invalidieren Ergebnis-Caches, abgelaufene Hinweise dürfen höchstens
30 Sekunden in einem bereits aufgebauten Ergebnis nachlaufen. Der Rohkatalogcache
bleibt unabhängig davon erhalten. Unvollständige Sprache/Pixel bleiben neutral.
Cacheinvalidierung bricht nur den eigenen Worker ab und verwirft späte Antworten.
Freigabe, Bestätigung und Workerrevalidierung prüfen stets frisch und konsumieren
keinen Suchhinweis. Eine kalte Suche darf neutral sein; nach abgeschlossener
Prüfung konsumiert die nächste Suche die Belege ohne erfundene Sprache/Auflösung.
Der Hintergrundworker startet keine erneute Sonarr-Suche und keinen Grab.

Historischer, inzwischen in der Entwicklung behobener Verbraucherbefund:
Sonarr verarbeitet eine abgeschlossene Staffelsuche nicht nochmals, nur weil
dieser Cache später HD-Belege enthält.
Die Nachlieferung zuvor gefundener alter Episoden wird deshalb durch den
folgenden Journalvertrag abgesichert; eine bloße warme Folgeabfrage wäre kein
Nachweis vollständiger automatischer Beschaffung. Der ursprüngliche Befund
und der ausdrücklich beauftragte Readiness-/Nachliefervertrag stehen im
[Review](proxy-retirement-review.md#erneut-offener-verbraucherbefund-kalte-suche-ohne-nachlieferung).

Der neue Owner `tv-search-delivery.ts` hält höchstens 128 überwachte, noch fehlende
und identitätsgesicherte Quellen für zwei Stunden in einem internen Config-Journal
(maximal 2 MiB, beide Backends, kein DDL). Entdeckungs-/Bereitschaftszeitpunkt sind
keine dauerhaft gültigen Sprach-/Pixelbelege. Der bestehende einzelne Worker
erneuert nur erfolgreiche Hinweise vor Ablauf; nicht belegbare/fehlgeschlagene
Quellen werden nicht automatisch wiederholt. Vor der Nachlieferung werden frische
vollständige MP4-Belege, aktuelles Monitoring/Dateibestand und der gemeinsame
Matcher geprüft. Das vorhandene RSS veröffentlicht alte bereits ausgestrahlte
Folgen mit dem ersten tatsächlich zulässigen Veröffentlichungszeitpunkt je
Release-GUID, unveränderten GUIDs und konkreten Medien-URLs. Eine zuvor belegte
fremdsprachige oder ungeeignete Rendition bestimmt diesen Zeitpunkt nicht;
späteres HD nach SD ist ein eigenes Releaseereignis. Gespeichert werden maximal
sechs GUID-Hashes/Zeitpunkte pro Quelleneintrag, keine Medienbelege oder ACKs.
Feedleser sind keine ACKs; 60s-Snapshots stabilisieren die komplette
Pagination. Sonarr entscheidet weiterhin selbst über Queue, Profil und Import.
Vorab-RSS ist dadurch nicht pauschal freigegeben. Die Entwicklungsabnahme umfasst
den kalten nativen Mehrstaffellauf ohne zweite Suche bis zu realen Dateiimporten,
direkt und über Prowlarr, einschließlich Restart/Fehler-/Kapazitätsnegativen.
Diese Gates bestehen im aktuellen geprüften Produktstand; P06.4 führt den noch
offenen installationsbezogenen Bestands-/Importaudit getrennt. Die Abnahme
einzelner anderer Folgen ersetzt diesen breiten Audit nicht.

## Abgrenzung zu MediathekArr

Geprüft wurde [MediathekArr v1.0-beta.12, Suchowner](https://github.com/PCJones/MediathekArr/blob/v1.0-beta.12/MediathekArrServer/Services/MediathekSearchService.cs):
weitere Regel-Themen als alternative Suchabfragen und weniger einschränkende
Serienbegriffe sind sinnvoll. Die Umsetzung hier ist unabhängig und benutzt
Pingufunks bestehende Matching-/Budgetowner. Nicht übernommen werden pauschale
Slot-Auflösungen, Deutsch ohne Beleg oder der großzügigere unsichere Fallback
des [Fallbackowners](https://github.com/PCJones/MediathekArr/blob/v1.0-beta.12/MediathekArrServer/Services/MediathekSearchFallbackHandler.cs).
Upstream `rundfunkarr/rundfunkarr` wurde auf `4ebaa8e8` erneut geprüft; dessen
Regel-Themenabfragen ersetzen nicht die hier benötigten Sonarr-, TBA- und
quellenbelegten Dimensionsverträge.

## Vorabveröffentlichungen und getrennte Betriebsabnahme

Nutzerklarstellung 06.10.2026: Bereits in der Mediathek verfügbare Folgen dürfen
in der Einzel-/Staffelsuche nicht wegen eines zukünftigen TV-Termins fehlen.
Die vorhandene explizite Suche übernimmt den validierten Episodenbestand ohne
Filter auf bereits vergangene Ausstrahlungsdaten. Sie sucht die Medien im
Mediathek-Katalog und prüft die konkreten Quellen; ein zukünftiger TV-Termin ist
für sich kein Ausschlussgrund. Der Katalogzeitstempel wird nicht als identisch
mit TV-Ausstrahlung oder als erfundenes Veröffentlichungsdatum ausgegeben.
Identitäts-, Laufzeit-, Sprach- und Renditionsbelege bleiben erforderlich.

Ein zusätzlicher RSS-Grab, ein zweiter Endpunkt oder ein Bibliotheks-/Titel-
Override sind dafür nicht nötig. Ein Indexer liefert Treffer auf Anfragen;
er startet nicht selbständig Sonarr-Suchen oder Downloads. Ob Sonarr eine
Suche auslöst und einen Treffer akzeptiert, bleibt Sonarrs Entscheidung.

Das getrennte Sonarr-RSS-Fenster enthält weiterhin nur bereits ausgestrahlte
Episoden mit gültigem UTC-Datum. Diese bestehende Fensterpolitik ist kein
Blocker der expliziten Suche und wird durch diesen Rollout nicht verändert.
Eine weitergehende RSS-Erweiterung wäre ein eigener Auftrag mit Regressionen,
nicht Voraussetzung für bereits verfügbare Vorabfolgen in der Staffelsuche.

Entwicklungsprüfungen verwenden ausschließlich synthetische Metadaten und Medien.
Echte Trefferprüfung, Produktivrollout, neue Grabs und Importabnahme sind eigene
Schritte; erfolgreiche Tests behaupten keine vollständig importierte Bibliothek.

## Einmalige manuelle Laufzeitentscheidung

Ein vollständiger, identitätsgesicherter S/E-Treffer mit zwei positiven
Laufzeitreferenzen bleibt in expliziten Suchen sichtbar, auch bei Konflikt.
RSS behält seine strengen automatischen Laufzeit-/Zeitfenstergrenzen.
Unklare Titel, Serien, Koordinaten oder fehlende Laufzeit erhalten diesen Weg
nicht. Textsuche mit eindeutigem Sonarr-Namen/Serienalias und ID-Suche benutzen
denselben Kandidaten-/Matcherowner; ein Providerselector darf die Sperre nicht
umgehen. Ohne optionale Sonarr-Anbindung bleibt das ungebundene Browsing unverändert.

Normale NZB-/SAB-Anfragen unterscheiden manuell/automatisch nicht zuverlässig.
Konflikt-NZBs liefern daher HTTP 409. Die Suche bietet stattdessen „Quelle prüfen“:
ausgewählte Rendition, volle S/E, beide Laufzeiten, unveränderte Serientoleranz,
frisch belegte Pixel und Sprache. Abbrechen erzeugt keinen Auftrag. Erst
„Diese Quelle einmal freigeben“ bestätigt genau eine erneut geprüfte Entscheidung.
API nimmt nur strikte Koordinaten, opaque Source-/Belegfingerprints und Intent-ID
entgegen, niemals vom Client gelieferte Medien-URL oder fertige Erwartungen.
Same-origin Header, begrenzter Body/Deadline und Maintenance-Gate gelten auch
auf HTTP ohne SSL. Dies ist kein zusätzlicher Indexer-Endpunkt.

Der Server speichert den v4-Vertrag mit beiden originalen Laufzeitreferenzen,
Zeitpunkt, Quelle/Rendition, Belegfingerprint und exakter Job-ID. Auditreceipt
und queued Download entstehen atomar in den vorhandenen Tabellen Config und
Download. Interne Receipts sind über die Settings-API weder lesbar noch
änderbar. Keine neue Schema-Migration, globale Einstellung oder Profiländerung.
Ein existierendes Receipt liefert denselben Job, auch nach Reload, verlorener
Antwort oder parallelem Klick. Entfernte Historie wird als `history_removed`
gemeldet und nicht neu gegrabt. Eine fehlgeschlagene Einzelentscheidung wird
nicht durch normalen History-Retry geklont; derselbe Beleg bleibt dieselbe
Entscheidung. Ein neuer Retryworkflow ist dadurch nicht behauptet.

Vor Transfer prüft der Worker Identität und alle Belege nochmals, einschließlich
exakter URL und MP4-Assetfingerprint. Mehrfenster-Proben verlangen denselben
starken ETag; bis vier 1-MiB-Fenster teilen weiterhin 32 Versuche/15 Sekunden.
Bei verändertem Beleg kein Transfer. Die fertige Datei muss die Quelllaufzeit,
Audio- und Auflösungsverträge weiterhin erfüllen. Nur die ausdrücklich
bestätigte Metadatenlaufzeit wird als `explicitly_exempted` dokumentiert;
„completed“ ist nicht gleich Sonarr-Import.

### Rollbackgrenze

Vor dem ersten v4-Write kann bei leerer Queue der bisherige, schemaidentische
Runner wiederverwendet werden. Danach darf kein v1/v2-only Runner neue v4-Jobs
verarbeiten oder interne Receipts unmaskiert ausgeben. Sicherer Stop: derselbe
v4-kompatible Runner mit Schreibgate aus; Daten/Audits unverändert erhalten,
Aufträge kontrolliert abnehmen und einen kompatiblen Fix vor Wiederfreigabe
prüfen. Kein SQLite-Rückfall, kein Restore eines alten Datenstands, keine
History-/Auditlöschung und keine Profil- oder Toleranzkorrektur als Rollback.

### Bedienung und Abnahme

In **Suche** den eindeutigen Sonarr-Seriennamen eingeben, die konkrete Folge
und Rendition wählen und **Quelle prüfen** anklicken. Erst der frische Dialog
belegt Sprache, Pixel, Quelllaufzeit und abweichende Metadatenlaufzeit.
**Diese Quelle einmal freigeben** erzeugt einen auditierten Einzelauftrag in
Kategorie `sonarr`; **Abbrechen** erzeugt keinen Auftrag. Eine erneute Bestätigung
derselben Entscheidung liefert dieselbe Job-ID, keinen zweiten Grab. Ein
generischer Download oder der manuelle Sonarr-/Prowlarr-Grab ersetzt diesen
Dialog nicht. Bei fehlgeschlagener frischer Prüfung nicht blind wiederholen:
Queue und Belegänderung prüfen bzw. eine andere konkrete Rendition neu prüfen.

Abgenommen am 10.10.2026 auf `0a37363`: echte synthetische Datei-/Workerkette auf
beiden Backends und desktop-only Interaktion am servierten Node-24-Container,
inklusive Fehler, Abbruch und Reload-Dedupe; Fork-CI 38041269044 sowie Docker-
Validierung 38041269045 grün. Der separat autorisierte Produktionsrollout und
frische Live-Dialogprüfung sind im privaten Betriebsrunbook belegt. Keine
globale Laufzeit-/Profil-/Schemaänderung und keine Live-Grabs für UI-QA.
Eine breite Staffelsuche teilt ihr Budget zwischen allen Fassungen: neutral
gebliebene Sprache/Qualität wird nicht erfunden. Die einzelne GUI-Prüfung bindet
dagegen nur die bewusst gewählte Quelle und prüft sie erneut.
