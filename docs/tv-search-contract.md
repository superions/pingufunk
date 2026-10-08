# Breite TV-Suche ohne erfundene Identität

Stand: 06.10.2026. Technischer Vertrag; ausführbare Abnahme ausschließlich
in [P06.4/P09.5](../todo/proxy-retirement.md). Instanzbezogene Rollout-Abnahme
und Sicherungen werden ausschließlich im privaten Betriebsrunbook geführt.

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
