# Filmquellen und gemeinsamer Arr-Indexer-Vertrag

Stand 03.10.2026. Die Nutzerentscheidung ersetzt die vorherige Strategie:
keine neuen Senderseiten-/HTML-/Flight-/Gateway-Filmparser. Der isolierte
ARTE-Filmversuch ist aus dem aktiven Code entfernt und in der Git-Historie
wiederherstellbar. Der allgemeine bounded Bodyreader und die unabhängig
abgenommene P07-Player-/Fassungsintegration bleiben erhalten.

## Identität der Quelle und Identität des Suchziels

| Quelle                           | Nutzbare Angaben                                                            | Nicht daraus ableiten                                                                     |
| -------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| MediathekView                    | Quelltitel, Topic, Dauer in Sekunden, Medien-/Website-URL                   | Produktionsjahr aus Ausstrahlungsdatum; Film-ID oder Genre aus Suchanfrage                |
| Optionale lokale Radarr-API      | Titel, Originaltitel, Alternativtitel, IMDb/TMDB, Jahr, Laufzeit in Minuten | Identität jedes zurückgegebenen Mediathekvideos; deutsche Tonspur aus lokalisiertem Titel |
| Bestehende optionale Sonarr-API  | Verifizierter Serienkontext und überwachte Episoden gemäß P06               | IDs/Koordinaten an beliebige gleichnamige Videos stempeln                                 |
| Ausdrücklich konfiguriertes TMDB | Bestehende kanonische Metadaten                                             | Erstes Text-Suchergebnis als sichere Videozuordnung                                       |

Die [MediathekViewWeb-Indexdefinition](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/OpenSearchDefinitions.ts)
belegt keinen allgemeinen Produktionsjahr-/IMDb-/TMDB-Feldvertrag.
Die freigegebene Korrelation ergänzt kanonischen Titel, Metadatenjahr und IDs
nur bei exakt passendem vollständigem Quelltitel oder dokumentiertem Alias
und bestätigter Laufzeit. Der erste Default ist **±10 %**, inklusive Grenzen,
bezogen auf die Metadatenlaufzeit (Minuten werden einmal in Sekunden umgerechnet).
Ein vorhandenes Quelljahr und das Suchjahr dürfen **±1 Jahr** vom Metadatenjahr
abweichen; größere Abweichungen bleiben Konflikte. Ein fehlendes Quelljahr
darf aus den verifizierten Metadaten ergänzt werden, nicht aus Ausstrahlung
oder beiläufigen Jahreszahlen in der Beschreibung. Bekannte Fassungszusätze
werden nur für den Titelvergleich entfernt; Quellfassung/Sprache/GUID bleiben
erhalten. Fuzzy-, Topic-only-, Clip-, unbekannte Laufzeit- und konkurrierende
RSS-Remakefälle erhalten keine ergänzte Identität. Ihre Quellkandidaten bleiben
ohne angefragte IDs/Jahresstempel sichtbar, soweit der Verbraucher sie annimmt.
Die RSS-Kategorie dient
dem Film-Suchkanal, nicht dem Nachweis, dass jeder Kandidat ein Spielfilm ist.

## Direkte Anbindung und Prowlarr

Ein gemeinsamer Newznab-Vertrag, kein manueller/automatischer Zweitmodus.
Die bestehende Route samt kompatiblem /api-Alias nutzt denselben Handler.
Sonarr/Radarr können Pingufunk direkt als Newznab-Indexer verwenden oder den
Indexer über Prowlarr beziehen. Keine Pflicht zu besonderen Sync-Profilen.

Der versionierte [Radarr-Requestgenerator](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs)
trennt RSS/Recent von gezielter Suche. RSS verwendet eine Anfrage ohne
konkretes Suchziel. Gezielte Suche nutzt eine ID-Stufe und ggf. eine weitere
Titel-/Jahr-Stufe; das ist kein obligatorischer zusätzlicher RSS-Lauf.
Es gibt dort kein zuverlässiges Newznab-Flag für interaktiv/automatisch.
Der [Sonarr-Requestgenerator](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/NzbDrone.Core/Indexers/Newznab/NewznabRequestGenerator.cs)
verwendet ebenfalls den gemeinsamen Suchvertrag. Caller-IP, User-Agent,
Weiterleitung und t=search dürfen nicht als manuelle Freigabe interpretiert werden.

[Radarrs Decision-Owner](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/NzbDrone.Core/DecisionEngine/DownloadDecisionMaker.cs)
behält bei konkretem Suchkontext auch nicht parsebare Treffer als abgelehnte
Suchentscheidung; ohne Suchkontext kann ein nicht parsebarer Titel entfallen.
[Sonarrs Decision-Owner](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/NzbDrone.Core/DecisionEngine/DownloadDecisionMaker.cs)
enthält ebenfalls den Suchkontext-Fallback. Das ist eine Consumer-Grenze,
keine Behauptung, dass jedes beliebige Indexerergebnis in jeder Arr-Version
sichtbar bleibt oder automatisch verworfen wird. Bereits davor greifen
Indexerparser, Kategorien und Limits.

Die vorhandenen GUI-Override-Dialoge erlauben eine bewusste Zuordnung:
[Radarr](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/frontend/src/InteractiveSearch/OverrideMatch/OverrideMatchModalContent.tsx),
[Sonarr](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/frontend/src/InteractiveSearch/OverrideMatch/OverrideMatchModalContent.tsx).
Die daraus resultierende bewusste Grab-Aktion bleibt Sache des Nutzers.
Fehlende IDs/Jahre sind kein garantierter Auto-Grab-Schutz: Arr kann selbst
über Titel oder andere verfügbare Angaben zuordnen.

[Prowlarrs Anleitung](https://wiki.servarr.com/prowlarr/quick-start-guide)
beschreibt Indexer-/App-Synchronisation. Prowlarr ist nicht automatisch ein
Proxy für die lokale Sonarr-/Radarr-Metadaten-API und überträgt deren lokale
API-Keys oder Bibliothek nicht im Newznab-Request. Optionaler Metadatenzugriff
wird daher separat an der tatsächlichen Arr-Instanz konfiguriert, unabhängig
vom Indexer-Zugriffsweg.

## Optionale Radarr-Metadatenanbindung

Standardmäßig aus. Eine explizit konfigurierte Instanz, aktuell Radarr 6.x
mit API v3; andere Hauptversionen werden nicht ohne Feld-/Versionsevidenz
zugelassen. Produktregressionen verwenden ausschließlich synthetische Daten;
installationsbezogene Betriebsprüfung und Secrets bleiben außerhalb dieses Repos.

Nichtgeheime serverseitige Settings über die vorhandene Settings-API:

    integration.radarr.enabled = true
    integration.radarr.url = http(s)://<eigene-instanz>/<optionaler-base-url-pfad>
    integration.radarr.inventoryMaxMiB = 10
    matching.movie.tolerancePercent = 10

Die URL darf keine Zugangsdaten, Query oder Fragment enthalten. Kein
HAProxy-/Swarm-/Hostname-Layout wird vorausgesetzt. Der API-Key liegt in
PINGUFUNK_RADARR_API_KEY_FILE als gemountete, absolute Secretdatei oder
alternativ in PINGUFUNK_RADARR_API_KEY; nicht beide gleichzeitig. Keine
Credential-Schreibvorgänge über den Browser; kein Key in Beispielen,
Anfrage-URLs, Git oder Fehlertexten. Die vorhandene Settings-Maskierung gilt
auch für api.radarr.key. Es gibt noch keine neue Radarr-UI-Bedienoberfläche.

GET-only: system/status und zuerst movie?tmdbId für gespeicherte Metadaten;
nur bei gültiger leerer Liste folgt movie/lookup/tmdb, IMDb nutzt movie/lookup/imdb.
Der [versionierte Radarr-6-Controller](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/Radarr.Api.V3/Movies/MovieController.cs)
belegt den lokalen TMDB-Filter. Fehlerhafte/mehrdeutige lokale Antworten
werden nicht durch einen externen Lookup kaschiert.
Für Recent/RSS zusätzlich GET movie: nur überwachte Filme, maximal 2.000
Bibliothekszeilen innerhalb des konfigurierbaren Listenlimits (Default 10 MiB,
ganze MiB von 1 bis 64), da Listen auch Cover-/Overview-Felder enthalten;
einzelne Metadaten behalten 5 MiB. Das nichtgeheime Setting ist über die
bestehende Settings-API schreibbar und invalidiert Caches; ungültige persistierte
Werte brechen vor Secret-/HTTP-I/O ab, kein unbegrenzter Fallback. Monitoring muss ein
Boolean sein, doppelte überwachte TMDB-IDs und unschemahafte Metadaten brechen
den Snapshot ohne Teilergebnis ab. Keine realen Bibliotheksdaten im Git.
Der [API-v3-Controller](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/Radarr.Api.V3/Movies/MovieLookupController.cs)
und die [MovieResource](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/Radarr.Api.V3/Movies/MovieResource.cs)
sind die überprüften Feldowner. Kein Film wird hinzugefügt oder verändert.
Lookup-IDs sind externe IMDb/TMDB-IDs, keine lokale Radarr-Library-ID.
Unschemahafte Angaben und widersprüchliche IDs werden abgelehnt.
Ein fehlendes gültiges Jahr verhindert diesen Metadatenlookup; eine unabhängig
mögliche Textsuche kann trotzdem ehrliche Quellkandidaten ausgeben.

Alle Lookups, Suchbegriffe, Folgeseiten und Retries teilen das vorhandene
P05-Budget: höchstens zehn HTTP-Versuche und 15 Sekunden insgesamt.
Einzelne Arr-Metadaten sind auf 5 MiB begrenzt (Bibliothek siehe oben); TMDB-Film/Find auf 1 MiB,
Serien-/Staffeldetails auf 5 MiB, TVDB-Serie und Showkatalog auf 8 MiB.
Positive Radarr-Metadaten bleiben höchstens zehn Minuten im begrenzten
Prozesscache (256 Einträge). URL, Credential, DB-/Settingkontext und
Rotation invalidieren den Bezug; Ausfälle werden nicht als Empty-Success gecacht.
Deaktiviert erfolgt kein Radarr-Secret-I/O oder HTTP.
Bei Ausfall ist ID-only ein Fehler; eine unabhängige Textsuche darf bei noch
verfügbarem Gesamtbudget fortsetzen, aber keine fehlgeschlagenen IDs übernehmen.

Sonarrs bisheriger P06-Vertrag bleibt unverändert. Kein zusätzlicher persönlicher
TVDB-/TMDB-Account ist für die lokale Arr-API-Anbindung erforderlich. Die
eigenen Arr-Cloud-Anbieter werden nicht als neue Pingufunk-Runtime aktiviert,
und im Arr-Quellcode enthaltene Projektschlüssel werden nicht kopiert.

## Recent/RSS und neutrale TV-Kandidaten

Film-Recent über t=movie ohne Suchziel und t=search mit Filmkategorie verwendet
denselben Owner. Die optionale Radarr-Liste liefert überwachte Suchziele;
ein auf höchstens 5.000 aktuelle Sourcezeilen begrenztes Mediathekfenster wird
gegen vollständige Film-/Aliastitel geprüft. Partielles Wort-Ranking aus
gezielter Suche wird nicht als Recent-Ankündigung übernommen. Identität bleibt
Quellidentität. Nur die oben ausdrücklich freigegebene exakte Titel-/Alias-,
Jahr-/Laufzeitkorrelation ergänzt kanonische Namen/IDs. Bei mehreren passenden
Werken bleibt RSS generisch statt vom ersten Bibliothekseintrag abzuhängen.
Bibliotheks-Snapshots leben höchstens 60 Sekunden; Sourcefenster und RSS-Cache
sind zusätzlich minutengebunden. Sprache/Fassung, Rendition und Dedupe werden
vor total/Pagination ausgewertet; Folgeseitenfehler ergeben 503 ohne
Partial-Success-Cache. Das ist ein begrenztes Recentfenster, kein vollständiger
Katalogscan und kein Neuheitsnachweis für jedes Video.

Ohne aktivierte Radarr-Anbindung oder bei leerer überwachter Filmliste bleibt
Film-Recent ehrlich leer. Keine erfundene Test-Veröffentlichung und kein
Ausweichen auf beliebige lange TV-Beiträge. Text-/ID-Suche bleibt unabhängig
nutzbar. Ein Client, der für seinen Indexertest zwingend einen RSS-Treffer
verlangt, kann einen leeren Feed beanstanden; tatsächliches Clientverhalten ist
vor dem produktiven Cutover gesondert zu prüfen. Kein manueller Zweitmodus
wird zur Unterscheidung eines solchen Tests erfunden.

Bei TV-Text-/ID-Suche dürfen plausible Quelltitel ohne Episodenkoordinaten
neutral erscheinen, wenn der Serienname/Topic passt. Es werden keine
Request-Koordinaten oder Serien-IDs übernommen. Bereits erkannte fremde
Koordinaten und der genaue Daily-Date-Vertrag bleiben geschlossen. Verifizierte
Sonarr-Zuordnungen dürfen nicht zusätzlich als unbekannte Kandidaten erscheinen.
Der zentrale Quellparser erkennt sowohl S02/E12 als auch S02E12, damit bekannte
Nachbarfolgen nicht irrtümlich als koordinatenlos durchgehen.

## Offene Abnahmegrenzen

P08.1–P08.4 sind nach vollständigem Ownerreview und synthetischen
Vertragsproben abgenommen. Film-Text/ID-Kontext und RSS→NZB→Queue sind synthetisch
prüfbar, aber nicht dasselbe wie eine laufende Arr-/Prowlarr-Verbraucherprobe.
Film-Recent/RSS und neutrale TV-Kandidaten sind implementiert und synthetisch
prüfbar. Serienanbieter, Show-/Regelkataloge, Regel-Metadaten und
automatische Regelgenerierung erhalten jetzt dasselbe Callerbudget.
TVDB-Login/Serie und TMDB-Find/Details/sämtliche Staffeln nutzen begrenzte
Bodyreader. Fehlgeschlagene und falsche Identitäten werden nicht als leere
Metadaten gecacht. TVDB-Ausfall kann innerhalb des verbleibenden Budgets
durch explizit konfiguriertes TMDB oder Sonarr aufgefangen werden.
Vordergrund-RSS reserviert fünf Versuche für sein Haupt-Sourcefenster,
statt einen unabhängigen Sonarr-Budgetscope zu starten.
TV-Suche verwendet maximal drei vollständige Suchnamen/Aliase, bei genau
einer gewünschten Episode auch deren belegten Titel; gemeinsame Umlaut-/
Wortvarianten sind reine Retrievalbegriffe. Pro TV-Suchbegriff höchstens
1.500 Sourcezeilen; Union, Zuordnung, Sprache/Fassung und Pagination danach.
Keine anderen Serien werden durch einen passenden Episodentitel umbenannt.
Offizieller TVDB-v4-Feldvertrag: [Swagger](https://github.com/thetvdb/v4-api/blob/main/docs/swagger.yml).
Die nameTranslations-Sprachcodeliste wird nicht als übersetzter Titel
interpretiert; bereits unterstützte benannte Übersetzungsobjekte bleiben lesbar.
Diese Grenzen nicht durch Änderung der Kriterien als erledigt ausgeben.
P09 und die separate produktive P10-Freigabe bleiben nachgelagert.

## RSS-Transportreview und absolute NZB-Links

Die versionierten Newznab-RSS-Parser von
[Sonarr](https://github.com/Sonarr/Sonarr/blob/cab419ade8ac7fcab5bf80394ee492abd35d5f5a/src/NzbDrone.Core/Indexers/Newznab/NewznabRssParser.cs)
und [Radarr](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/NzbDrone.Core/Indexers/Newznab/NewznabRssParser.cs)
bevorzugen Usenet-Enclosures; die ID-Felder bleiben ohne Attribut unbekannt.
Radarr prüft die Downloadadresse ausdrücklich als absolute URI. Der bisherige
relative Pingufunk-NZB-Link war deshalb unzureichend; der Integrationstest
hatte die fehlende Base-URL unzulässig selbst ergänzt.

Der bestehende NZB-Linkowner erzeugt innerhalb des tatsächlichen GET-/Alias-
Scopes absolute HTTP(S)-Adressen. Ohne öffentliche URL-Konfiguration gilt
der Request-Origin. Optionale PINGUFUNK_PUBLIC_URL setzt den tatsächlich
erreichbaren öffentlichen Root einschließlich Deployment-Unterpfad.
Keine Credentials/Query/Fragment; leere optionale Variable bedeutet unset.
Forwarded-Host/Proto/IP und User-Agent werden nicht zur Auswahl herangezogen.
Ein Reverse-Proxy, dessen interner Request-Origin extern nicht erreichbar ist,
muss den öffentlichen Root konfigurieren; keine konkrete Proxyarchitektur
wird vorausgesetzt. Die Plattform muss ihre Host-/Routinggrenze selbst sichern.

Request-lokale URL-Kontexte bleiben auch parallel isoliert; RSS-Responsecaches
enthalten den URL-Kontext in ihrem Fingerprint. Quell- und Fassungs-GUIDs
ändern sich dabei nicht. Hash-GUIDs sind keine Permalinks. MIME, positive
Enclosurelänge, absolute Adresse, fehlende unbelegte IDs/Sprache und gleicher
RSS→NZB→Queue-Pfad werden geprüft. Caps/Limit haben denselben Default 100
und maximal 5.000; negative, unvollständige oder doppelte Paginationparameter
werden vor Providerarbeit abgelehnt.
