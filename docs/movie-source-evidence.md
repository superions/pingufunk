# Filmquellen: belegte und fehlende Identität

Quellenreview 30.09.2026 für P08.1; kein neues Konto, Metadatenservice oder
Radarr-Adapter eingerichtet. Keine private Bibliothek oder Medienquelle abgefragt.
Dies ist ein Evidenzbefund, keine Abnahme eines noch fehlenden Filmadapters.
Das ergänzende Detailseitenreview unten findet eine begrenzte ARTE-Quelle;
die anfängliche Lücke der Listen-/Player-APIs wird dadurch nicht wegdefiniert.

| Bestehende Quelle                           | Preserve                                                                   | Unknown                                                                   | Reject als Identitätsersatz                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| MediathekView-Filmliste/API                 | Titel, Topic, Dauer in Sekunden, Medien-/Website-URL                       | Filmklassifikation, Produktionsjahr, IMDb/TMDB, kanonische Filmaliasnamen | Topic, Laufzeit allein, Listen-/Ausstrahlungszeit                 |
| ARTE-Player v2                              | Video-ID, Player-Titel, Dauer in Sekunden, versionspezifische Audioevidenz | gesicherter Filmtyp, Produktionsjahr, externe Film-IDs                    | deutsche Seitenlocale, Rechtebeginn                               |
| ARTE deutsche Haupt-Programmdaten der Detailseite | Video-ID, voller Titel, expliziter Filmtyp, `PRODUCTION_YEAR`, Sekunden | IMDb/TMDB, Originaltitel-/Aliasvertrag, andere Sprachseiten | Empfehlungen/Trailer, Magazinuntertitel, Rechte-/Ausstrahlungsdatum |
| ARTE-Katalog im betrachteten MServer-Parser | Originaltitel, Kategorie/Subkategorie, Video-ID, Dauer in Sekunden         | in diesem Parser nicht belegtes Produktionsjahr oder IMDb/TMDB            | `SHOW` als Kino-/Fernsehfilmbeleg; auch Clip/Bonus sind enthalten |
| Bestehender SRF-Adapter                     | URN, Titel, Quelle; Millisekunden werden zentral in Sekunden umgerechnet   | sichere Filmklassifikation/Produktionsjahr/externe Film-IDs               | VIDEO/EPISODE oder 60 Minuten als Filmbeleg                       |
| Bestehender ORF-Adapter                     | indexierter Titel, Quelle, Dauer in Sekunden                               | Filmklassifikation/Produktionsjahr/externe Film-IDs                       | Topic oder 60 Minuten als Filmbeleg                               |
| Ausdrücklich konfiguriertes TMDB            | bestehende Titel-/ID-/Release-/Runtime-Metadaten                           | Identität eines nur ähnlich benannten Mediathekvideos                     | Anfrage-ID an beliebigen Kandidaten stempeln                      |

## Primärbelege und Grenzen

Die [MediathekViewWeb-Indexdefinition](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/OpenSearchDefinitions.ts)
und der bestehende Adapter liefern keinen hier belegten Filmtyp, kein
Produktionsjahr und keine externe Film-ID. Eine Filmrubrik ist keine kanonische
Identität jedes enthaltenen Videos.

Der [ARTE-Katalogparser](https://github.com/mediathekview/MServer/blob/b30c9227482e4afdcfece48f3b593855502a083f/src/main/java/mServer/crawler/sender/arte/json/ArteVideoInfoDeserializer.java)
kennt Originaltitel, Laufzeit, Kategorie und Ausstrahlungsdaten, verarbeitet
aber auch Clips/Bonus. Im überprüften Feldvertrag ist kein Produktionsjahr
belegt. Die Player-Grenze ist im [ARTE-Vertrag](arte-edition-contract.md) separat
dokumentiert; daraus wird kein Filmvertrag abgeleitet.

Das offizielle [ARD-Entwicklerportal](https://developer.ard.de/) bezeichnet die
Core API v1 als intern. Die sichtbare Core-v2-Übersicht verlinkte auf eine
„Page Not Available“-/Anmeldeansicht. Kein accountfrei überprüfter
Produktionsjahr-/Filmtypvertrag wird daraus behauptet. Der versionierte
[ARD-Extractor](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/ard.py)
liest unter anderem `broadcastedOnDateTime` und `durationSeconds`; ein
Ausstrahlungsdatum ersetzt kein Produktionsjahr.

Der [ZDF-Detailparser](https://github.com/mediathekview/MServer/blob/b30c9227482e4afdcfece48f3b593855502a083f/src/main/java/mServer/crawler/sender/zdf/json/ZdfFilmDetailDeserializer.java)
liest Titel/Untertitel, Kategorie, Dauer und Ausstrahlungs-/Editorialdatum.
Er ist als `Old`-DTO-Pfad benannt und belegt keinen vollständigen aktuellen
accountfreien Filmvertrag. Daraus wird keine neue Runtimeintegration erzeugt.

## Offene, ausdrücklich begrenzte Arbeit

### Ergänzender ARTE-Detailseitenbefund

Die öffentliche deutsche Detailseite von
[Souleymans Geschichte](https://www.arte.tv/de/videos/124739-000-A/souleymans-geschichte/)
liefert am 30.09.2026 in ihren eigenen serverseitig eingebetteten Seitendaten
einen `program_content_<Video-ID>`-Bereich. Dessen einzelner vollständiger
Programm-Datensatz bindet `programId`, `player.id`, `id` mit Locale, Seitentitel
und die eigene Video-URL. `credits` enthält ausdrücklich den Code
`PRODUCTION_YEAR`; das ist etwas anderes als Ausstrahlung oder Rechtebeginn.
`duration` ist in Sekunden angegeben. `genre.id=2` mit dem ausgewiesenen
Filmtyp, `type=program`, `kind.code=SHOW`, `standaloneContent=true`, leere
Episodenangaben und kein Clip bilden einen begrenzten Standalone-Filmvertrag.
Empfehlungs-, Bonus-, Trailer- und nächste-Video-Bereiche sind keine Belege
für das angefragte Programm und dürfen nicht durchsucht/adoptiert werden.

Gegenprobe:
[Richard Gere aus der Sicht von Laetitia Masson](https://www.arte.tv/de/videos/117679-060-A/richard-gere-aus-der-sicht-von-laetitia-masson/)
ist ebenfalls als Film mit Produktionsjahr ausgewiesen, hat aber den
Serien-/Magazinuntertitel `Blow up`. Eine bloße Anfrage nach dem Magazin-
Topic oder einem darin erwähnten Kinofilm darf diesen Beitrag nicht erhalten.
Der erste Adapter begrenzt sich daher zusätzlich auf leeren Untertitel und
gesicherte volle Programmtitel. Das ist eine bewusste Reichweitenbegrenzung,
keine Behauptung, der Beitrag sei kein Film. Ein vorhandener Trailer-Verweis
am Vollfilm macht umgekehrt nicht das ganze Programm zum Trailer.

Die HTML-Seite ist kein zugesagtes stabiles API. Ein eng begrenzter Reader
kann ausschließlich JSON-Argumente der Next-Flight-Pushs lesen, niemals
JavaScript ausführen. Die Framing-Regeln für JSON-Zeilen und längencodierte
UTF-8-Textblöcke wurden gegen den
[React-19-Flight-Reader](https://github.com/facebook/react/blob/v19.0.0/packages/react-client/src/ReactFlightClient.js)
verifiziert. Unbekanntes Framing, fehlender/equivoker Hauptdatensatz oder
abweichende Identität müssen abbrechen. Keine frei rekursive Suche nach
irgendwelchen Jahreszahlen; keine Übernahme von Seitenkonfiguration oder
SSO-Daten. Synthetische reduzierte Fixtures statt HTML-Vollkopien.

Dieser Befund erlaubt die technische Prüfung eines accountfreien, zunächst
ARTE-only Standalone-Filmadapters. Andere Provider bleiben ohne Beleg unknown.
Externe IMDb-/TMDB-IDs liefert diese Quelle nicht; eine Query-ID darf weiterhin
erst nach verifiziertem kanonischem Metadatenkontext plus Titel-/Jahresgleichheit
an ein Ergebnis gelangen. ID-only ohne vorhandene konfigurierte Auflösung
ist dadurch nicht auf magische Weise accountfrei auflösbar.

Der neue isolierte Adapter `arte-movie-metadata.ts` wurde zunächst gegen
reduzierte synthetische Hauptdaten-/UTF-8-Flight-Fixtures geprüft. Ein zusätzlich
read-only abgerufener öffentlicher Vollfilm bestätigte die echte Readerkontur,
ID, ausdrücklichen Jahrescode und Sekundenwerte; kein Player/Medienstream,
kein Login, keine private Bibliothek und keine gespeicherte HTML-Vollkopie.
Beim ersten Readerlauf wurde ein regulärer `null`-Modellrecord als unbekanntes
Framing gestoppt; JSON-Primitive werden nun gelesen und als Nichtmetadaten
ignoriert, der Fall ist in der synthetischen Probe enthalten.
Das ist noch kein Anschluss an die Film-Such-/RSS-/NZB-Consumer oder eine
Abnahme von P08.2/P08.3.

Andere Provider benötigen weiterhin eine
reproduzierbar belegte Quellidentität mit Filmklassifikation und disambiguierendem
Jahr bzw. anderer sicherer Identität. Fehlende Angaben bleiben unbekannt;
synthetisch erfundene zusätzliche API-Felder wären kein Providerbeleg.
Dieser konkrete Fallback bleibt offen. Neue externe Dienste oder lokale
Radarr-Metadaten werden nicht eigenmächtig eingesetzt.

Im bestehenden Filmcode wurden zusätzlich die im TODO bereits adressierten
Defekte bestätigt: fuzzy/partial Matching, Ausstrahlungsjahr im Releasetitel,
ungeprüftes ID-Stempeln bei Textsuche und reine Dauerschwellen. Diese sind
**nicht** als sicher abgenommen. P08.2/P08.3 bleiben offen; der P07-Checkpoint
ist keine Freigabe dieser Pfade für eine Proxyabschaltung.
