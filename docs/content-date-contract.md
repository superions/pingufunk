# Quellenzeit, Metadaten und Rechte

Entwicklungsvertrag P14.3; Status und Abnahme ausschließlich im
[Phasen-TODO](../todo/proxy-retirement.md). Kein Deploymentauftrag.

## Vier getrennte Fakten

- `ApiResultItem.filmlisteTimestamp` bleibt der bisherige **Katalogupdate**-
  Zeitwert für IDs, Sortierung und RSS-pubDate. Keine Umschreibung alter IDs/GUIDs.
- `contentDates.broadcastAt` übernimmt ausschließlich den validierten numerischen
  MediathekView-`timestamp`. `catalogueUpdatedAt` bezeichnet unabhängig davon den
  Katalogstand. Null/0/ungültig bleibt unbekannt. Der SRF-Adapter bezeichnet seine
  ansonsten unspezifizierte API-Date nur als `providerDate`; keine erfundene Rechte-
  oder Filmjahrsemantik. Provideradapter behalten diese transienten Fakten.
- `TvdbEpisode.aired` bleibt das Metadaten-Airdate, `TmdbMovieData.productionYear`
  bzw. belegtes Releasejahr das Filmjahr. Weder Katalog- noch Sendetag erzeugt ein
  Filmproduktionsjahr. Der ältere Provider-Filenamehelper ergänzt ein Jahr nur
  aus expliziter Produktionsjahrmetadaten, nicht mehr aus seinem Sorttimestamp.
- `sourceAvailability` beschreibt **deklarierte Rechte**, nicht einen bewiesenen
  erfolgreichen Medienabruf. Bestehender ARTE-Player liefert begin/end; der
  bestehende ARD-JSON-Owner liefert availableTo. Kein neuer Senderseitencrawler,
  HEAD-Test oder zusätzlicher Netzwerkversuch. Ohne diese Felder `unknown`.

MediathekViews [FilmlisteParser](https://github.com/mediathekview/mediathekviewweb/blob/master/server/FilmlisteParser.ts)
liest den Sendetimestamp der Filmzeile; der
[Indexerworker](https://github.com/mediathekview/mediathekviewweb/blob/master/server/MediathekIndexerWorker.ts)
fügt davon unabhängig den Listentimestamp hinzu. Der
[SearchEngine-owner](https://github.com/mediathekview/mediathekviewweb/blob/master/server/SearchEngine.ts)
wendet `future=false` auf den Sendetimestamp an. Diese Semantik wurde am
08.10.2026 gegen die Primärquellen geprüft, nicht aus dem bisherigen Forkkommentar
abgeleitet. ARD/ARTE-Felder werden nur innerhalb der bereits vorhandenen,
identitätsgeprüften JSON-Verträge angenommen, nicht als neue allgemeine API-Zusage.

## Verfügbarkeit ist kein Identitäts- oder Sprachbeweis

Rechtefakten binden den geprüften Programmowner und seine **exakten** Medien-URLs,
einschließlich Signaturen/Selektoren. Datumstrings brauchen einen echten
Kalendertag und explizite Zeitzone; unmögliche Daten und begin>end sind Konflikte,
kein Date.parse-Normalisierungserfolg. End-/Startgrenzen werden bei Auswahl/
Serialisierung erneut geprüft. Expired/not-yet/conflicting wird nicht publiziert.
Eine andere URL erbt weder Rechte noch Audio-/Dimensionsbelege. `rights_current`
beweist keine Erreichbarkeit, Geoverfügbarkeit, Sprache oder korrekte Episode.
Fehlende Rechte beweisen umgekehrt keinen Nichtfund; bestehende strenge
Identitäts-/Laufzeit-/Rendition-/Sprachprüfungen bleiben erforderlich.

ARDs abgelaufene deklarierte Rechte bleiben über die Audioanreicherung erhalten:
der Serializer kann den Treffer verwerfen, statt daraus einen scheinbar nur
sprachneutralen Kandidaten zu machen. Die frische Worker-Audioverifikation lehnt
abgelaufene Deklarationen ebenfalls ab. Nichtrechtebasierte ältere Login-/Geo-
Prüfungen behalten ihre bisherigen Grenzen. Rechtefakten werden nicht in alte
Jobs hineingeschrieben, keine DDL oder neue Jobversion.

## Explizite Vorabsuche, konservatives RSS

Eine bereits gelistete Quelle mit sicherer Serien-/Episodenidentität bleibt bei
zukünftigem Airdate in exakter oder Staffelsuche nutzbar. Kein Warten auf RSS
oder TV-Termin; Quelle und Metadaten beschreiben verschiedene Ereignisse.
Sonarr-RSS behält seine inklusive UTC-Vergangenheitsgrenze und schließt
future/missing/invalid Airdates weiterhin aus. Der native Endpoint behält bei
wirklich leerem TV-RSS sein bestehendes synthetisches Validationitem; dies ist
kein Grab einer Vorabfolge. Versuchs-/Zeit-/Bytebudgets bleiben unverändert.

Bei mehrfach identischen Episodentiteln darf ein **eindeutiger** Quell-Sendetag
die Auswahl klären. Katalogrefresh und „neueste Episode“ reichen nicht. Ohne
eindeutigen Beleg keine Identitätsstempel; neutrale Kandidaten bleiben gemäß
bisherigem Endpointvertrag zulässig. Legacy-Regelfeld `timestamp` bleibt aus
Kompatibilitätsgründen unverändert und ist kein neuer Airdateowner.

## Gates und verbleibende Frischegrenze

Kausale Tests prüfen Adapter-/Raw-Whitelist, fehlende Rechte, unmögliche/reverse
Zeiten, Ablauf und exakte URL-Bindung; tatsächliche Film-/TV-/Generic-Serializer,
gleichbleibende GUIDs, Zukunftsfolge durch Newznab→NZB ohne Enqueue und erhaltene
RSS-Grenze. Kein UIlayout dieses Pakets geändert, keine Live-Grabs.

Die bisherige ganze RSS-Antwort im Cache kann erneute Serialisierung umgehen;
das ist ein gesondert zu beseitigender Frischebefund in **P14.2**, kein Beleg
aktuell geprüfter Rechte. Die finale P14.3-Abnahme bleibt bis zur geschlossenen
Cachegrenze und neuen Fork-/Backend-/Containerketten offen.
