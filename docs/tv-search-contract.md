# Breite TV-Suche ohne erfundene Identität

Stand: 10.10.2026. Technischer Vertrag; ausführbare Abnahme ausschließlich
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
