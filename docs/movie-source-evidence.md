# Filmquellen und gemeinsamer Arr-Indexer-Vertrag

Stand 01.10.2026. Die Nutzerentscheidung ersetzt die vorherige Strategie:
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
Daher bleiben Filmkandidaten im aktuellen Suchpfad Quellkandidaten: IDs und
Anfragejahr werden nicht ausgegeben, auch wenn das Suchziel sicher aufgelöst ist.
Vorhandene Jahreszahlen im Quelltitel bleiben erhalten. Die RSS-Kategorie dient
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
zugelassen. Es wurde keine reale Instanz aktiviert oder abgefragt.

Nichtgeheime serverseitige Settings über die vorhandene Settings-API:

    integration.radarr.enabled = true
    integration.radarr.url = http(s)://<eigene-instanz>/<optionaler-base-url-pfad>
    matching.movie.tolerancePercent = 10

Die URL darf keine Zugangsdaten, Query oder Fragment enthalten. Kein
HAProxy-/Swarm-/Hostname-Layout wird vorausgesetzt. Der API-Key liegt in
PINGUFUNK_RADARR_API_KEY_FILE als gemountete, absolute Secretdatei oder
alternativ in PINGUFUNK_RADARR_API_KEY; nicht beide gleichzeitig. Keine
Credential-Schreibvorgänge über den Browser; kein Key in Beispielen,
Anfrage-URLs, Git oder Fehlertexten. Die vorhandene Settings-Maskierung gilt
auch für api.radarr.key. Es gibt noch keine neue Radarr-UI-Bedienoberfläche.

GET-only: system/status, movie/lookup/tmdb oder movie/lookup/imdb.
Der [API-v3-Controller](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/Radarr.Api.V3/Movies/MovieLookupController.cs)
und die [MovieResource](https://github.com/Radarr/Radarr/blob/c90668a520664ad0c91812cfee57c41928ad2148/src/Radarr.Api.V3/Movies/MovieResource.cs)
sind die überprüften Feldowner. Kein Film wird hinzugefügt oder verändert.
Lookup-IDs sind externe IMDb/TMDB-IDs, keine lokale Radarr-Library-ID.
Unschemahafte Angaben und widersprüchliche IDs werden abgelehnt.
Ein fehlendes gültiges Jahr verhindert diesen Metadatenlookup; eine unabhängig
mögliche Textsuche kann trotzdem ehrliche Quellkandidaten ausgeben.

Alle Lookups, Suchbegriffe, Folgeseiten und Retries teilen das vorhandene
P05-Budget: höchstens zehn HTTP-Versuche und 15 Sekunden insgesamt.
Arr-JSON ist auf 5 MiB begrenzt; bestehendes TMDB auf 1 MiB pro Body.
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

## Offene Abnahmegrenzen

P08.1–P08.4 bleiben im ausführbaren TODO offen, bis alle dort genannten
Abnahmen erfüllt sind. Film-Text/ID-Kontext und RSS→NZB→Queue sind synthetisch
prüfbar, aber nicht dasselbe wie eine laufende Arr-/Prowlarr-Verbraucherprobe.
Insbesondere der Film-Recent/RSS-Pfad ist noch nicht vollständig: t=movie
ohne Suchziel liefert bisher den Validierungsfeed. TV-Kandidaten ohne sichere
Koordinaten und verbleibende Callerbudget-Pfade benötigen weiteren Review.
Diese Grenzen nicht durch Änderung der Kriterien als erledigt ausgeben.
P09 und die separate produktive P10-Freigabe bleiben nachgelagert.
