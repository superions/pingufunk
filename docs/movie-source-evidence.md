# Filmquellen: belegte und fehlende Identität

Quellenreview 30.09.2026 für P08.1; kein neues Konto, Metadatenservice oder
Radarr-Adapter eingerichtet. Keine private Bibliothek oder Medienquelle abgefragt.
Dies ist ein Evidenzbefund, keine Abnahme eines noch fehlenden Filmadapters.

| Bestehende Quelle                           | Preserve                                                                   | Unknown                                                                   | Reject als Identitätsersatz                                       |
| ------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| MediathekView-Filmliste/API                 | Titel, Topic, Dauer in Sekunden, Medien-/Website-URL                       | Filmklassifikation, Produktionsjahr, IMDb/TMDB, kanonische Filmaliasnamen | Topic, Laufzeit allein, Listen-/Ausstrahlungszeit                 |
| ARTE-Player v2                              | Video-ID, Player-Titel, Dauer in Sekunden, versionspezifische Audioevidenz | gesicherter Filmtyp, Produktionsjahr, externe Film-IDs                    | deutsche Seitenlocale, Rechtebeginn                               |
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

P08.1 benötigt für einen positiven accountfreien Filmfallback noch eine
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
