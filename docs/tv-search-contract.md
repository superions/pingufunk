# Breite TV-Suche ohne erfundene Identität

Stand: 10.10.2026. Technischer Vertrag; ausführbare Abnahme ausschließlich
in [P06.4/P09.5](../todo/proxy-retirement.md). Ein Produktionsrollout braucht
weiterhin eine gesonderte, konkrete Freigabe.

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
Titel-, Staffel-, Folgen-, Jahres- und Laufzeitkonflikte werden nicht durch eine
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

Ein bestehender Basis-Platzhalter bleibt unverändert; der Merge vermerkt nur
transient seine bestätigten Koordinaten. RSS benennt die Episode mit dem tatsäch-
lichen Quelltitel und den belegten S/E-Koordinaten, nicht mit TBA. Keine Sonarr-
Bibliotheksänderung, neuen Datenbankfelder oder Titel-Overrides. Die bisherigen
engen ARTE-Bruchteilregeln bleiben bestehen; fehlende Metadaten werden nicht
durch eine geratene Staffel ersetzt.

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

## Getrennte offene Entscheidung und Betriebsabnahme

Das Sonarr-RSS-Fenster enthält weiterhin nur bereits ausgestrahlte Episoden mit
gültigem UTC-Datum. Vorab in der Mediathek veröffentlichte, erst später im TV
ausgestrahlte Folgen sind explizit suchbar, werden dadurch aber nicht automatisch
ins RSS-Fenster aufgenommen. Eine Änderung dieser Politik braucht die noch
offene Nutzerentscheidung und eigene Regressionen.

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
