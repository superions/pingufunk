# Proxy retirement cutover runbook — GUID transition gate

Status: preparatory only. This is not deployment authorization or an executable
host-specific procedure. P10.2 must bind the reviewed GitOps state, consumer
instances, and approved operating window before any cutover; P10.3–P10.7 retain
their independent migration, writer, routing, and proxy-removal gates.

## RSS GUID transition

P03 changes Newznab GUIDs from the old website-plus-quality value to a stable
identity that includes source, edition, rendition, and search context. Previously
consumed releases can consequently reappear as new feed entries and cause duplicate
grabs. Equal titles alone are not proof that two releases are the same edition.
Known short-lived media access parameters are excluded from that identity; the
media path, unrecognized query selectors, edition, and explicit quality remain
identity-bearing. The current RSS/NZB path still forwards the provider's current
download URL, so GUID stability does not make an old queued URL fresh.

Before the P10.6 routing gate can open:

1. Compare old and new GUIDs using synthetic RSS/NZB fixtures, including distinct
   audio editions and 720p/1080p renditions. Preserve the comparison as review
   evidence; do not query production feeds for this development check.
2. Under the separately authorized operations window, reconcile queued, active,
   failed, and unimported download history against the feed transition. If an
   existing release cannot be matched safely, stop rather than infer identity from
   its title.
3. Keep automated acquisition paused while changing routes. Verify that exactly
   one indexer/RSS route and one download-client route are active before resuming;
   never run old and native routes together as a deduplication strategy.
4. If duplicate-grab risk or active-job state is unresolved, keep the routing gate
   closed and retain the existing route. Resume only under P10's explicit gates.

This note records a risk and a stop condition; it does not authorize reading or
changing a production feed, queue, history, service, or route.

## P08 — Gemeinsamer Indexer und Filmkandidaten

Direkter Arr-Zugriff und Prowlarr-Weiterleitung nutzen denselben Vertrag.
Keine getrennte manuelle Route oder Pflicht-Syncprofile beim Cutover einrichten.
Indexerzugriff und optionale lokale Arr-Metadatenanbindung getrennt konfigurieren;
Prowlarr übermittelt dafür nicht automatisch die lokalen Arr-API-Keys.

Der neue Filmkandidaten-Generator bindet GUIDs an Quellidentität/Fassung/Rendition,
nicht an Anfrage-ID, Suchtext oder ein aus dem Ausstrahlungsdatum erfundenes
Produktionsjahr. Gegenüber bisherigen movie-text-/kanonisch gestempelten GUIDs
ist das ein erneuter Übergang: alte Einträge können neu erscheinen. Die
obigen Queue-/History-/Doppelgrab-Gates gelten auch hierfür.

Unbekannte Identität ist keine Auto-Grab-Sperre. Arr darf selbst zuordnen;
manuelle GUI-Korrektur ist nur möglich, wenn der Consumer den Treffer behält.
Vor Routingfreigabe die tatsächlich vorgesehenen Arr-/Prowlarr-Versionen
synthetisch prüfen. Keine Behauptung produktiver Kompatibilität allein aus
RSS-/Queue-Unit-Tests. Offene Film-RSS-/TV-Kandidatenabnahmen in P08 blockieren
weiterhin P09/P10, ohne den abgenommenen bisherigen TV-Pfad zurückzunehmen.

## P04 — Download-Pfade und Altbestand

Neue Jobs speichern Temp-Dateien und fertige Medien in einem Verzeichnis aus
sanitisiertem Release-Namen und `Download.id`. Die öffentliche SAB-Kategorie
bleibt `sonarr`, `movies` usw.; `history.storage` zeigt auf genau das jeweilige
Jobverzeichnis und berücksichtigt das konfigurierte Pfad-Mapping. In der Datenbank
bleibt der lokale Pfad, damit ein späteres `del_files=1` die richtige Datei trifft.
Alte flache `filePath`-Einträge und die bisherigen Proxy-Privatekategorien werden
beim Lesen nicht umgeschrieben. Ein Retry erzeugt eine neue Job-ID und verwendet
die öffentliche Kategorie.

Vor einem Cutover synthetisch prüfen, dass Sonarr/Radarr das neue `storage`-Verzeichnis
importieren und danach entfernen können; parallel darf ein zweiter gleichnamiger
Job nicht betroffen sein. Alte, noch nicht importierte History muss lesbar bleiben.
Falls ein alter Dateipfad außerhalb des konfigurierten Download-Roots liegt, über
einen Symlink ausbricht oder von mehreren History-Einträgen referenziert wird,
bricht `del_files=1` ab und lässt den History-Eintrag bestehen. Solche Fälle
müssen einzeln geklärt werden; weder Datenbankzeilen noch Dateien pauschal
umbenennen oder löschen. Der Pfadwechsel ist keine Freigabe für produktive Jobs.

## Metadatenkorrelation und schemafreier Hotfix-Rollback

Eine funktionierende Prowlarr-Indexerroute ist kein Nachweis einer aktivierten
optional separaten Sonarr-/Radarr-Metadatenanbindung. Vor deren Aktivierung
Settings, Secret-Dateimount und tatsächliche Instanz prüfen; keine API-Keys ins
Git oder in öffentliche Betriebsbeispiele schreiben. Filmverifikation muss
auch jahrlosen Quelltitel gegen den nativen Verbraucher prüfen. Sprach-/
Qualitätsablehnung nicht mit fehlerhafter Filmidentität verwechseln; neutralen
Quellen keine Tonsprachen hinzuerfinden.

Bei einem reinen, schemafreien App-/Settings-Hotfix die aktuellen Settings und
eine konsistente SQLite-Online-Sicherung mit Integritätsnachweis aufnehmen.
Rückweg: Aufnahme/Clients unter eigener Betriebsfreigabe pausieren, aktuelle
Queue/History und Dateisystemeffekte abgleichen, nur betroffene Settings auf
ihren dokumentierten Vorzustand setzen, dann geprüfte vorige App über denselben
GitOps-Controller wieder aktivieren. Die aktuelle kompatible Datenbank erhalten:
eine ältere Sicherung nach neuen Writes würde neue Jobs/History/Config verlieren
und ist kein regulärer App-Rollback. Keine ungeprüfte historische App starten;
Rollbackimage muss die aktuelle Sicherheits- und Schemafreigabe besitzen.
Installationswerte, genaue Image-IDs, Sicherungen und Controllerrevisionen
gehören ins private Betriebsrunbook. Dieser Vertrag ist keine DB-Cutover-
oder allgemeine Deploymentfreigabe.

## P09.3 — Auflösungskorrektur ohne neue Qualitäts-GUIDs

Der [Auflösungsvertrag](rendition-quality-contract.md) trennt historische
Katalog-Slots von tatsächlichen Maßen. Verbesserte Dimensionsbelege verändern
Titel und NZB-Erwartungen, aber nicht den bisherigen Slotbestandteil im GUID-
Hash. Ein altes `#1080p-…` kann deshalb eine nun korrekt als 720p veröffentlichte
URL identifizieren. Dieses Fragment nicht als Pixelbeleg interpretieren.
Keine gespeicherten Jobs, Dateien, GUIDs oder Consumerhistorien umschreiben.

Vor separat freigegebenem Rollout neue UNKNOWN-Fälle und Qualitätsauswahl an
den vorhandenen Consumerprofilen bewerten. Unbekannte Titel erhalten kein WEB-
Hint, das Arr selbst pauschal als SD lesen würde; automatische Aufnahme hängt
weiterhin von den tatsächlichen Profilen ab. Mehrfachindexer und historische
Kontext-/Fassungs-GUID-Übergänge bleiben eigene Doppelgrabrisiken. Neue Sollmaße
werden vor Completed geprüft; Rollbackimage muss diese v1/v2-Erwartungen auf
dem aktuellen Backend weiter verstehen. Keine Datenbankmigration, erneute
Bibliotheksbewertung oder neue Aufnahme ist Teil dieses Qualitätsfixes.

## P03.4 — Quellenbelegte Tonsprachen und v2-Jobs

Der [Tonsprachenvertrag](source-audio-contract.md) ergänzt konkrete progressive
Filmfassungen, nicht Radarrs Originalsprache. Eine durch Prowlarr erreichbare
Indexerroute ist noch kein Beleg korrekt erkannter Audiosprache; synthetisch
beide nativen Wege mit englischem Original und belegter deutscher Fassung prüfen.

Vor Imagewechsel Queue/History und Jobvertragsversionen kontrollieren. Laufende
Grabs nicht durch einen unvalidierten Wechsel unterbrechen. Nach neuen v2-Jobs
kein Image ohne v2-Unterstützung als Rollback verwenden, keine gespeicherten
Erwartungen löschen/abschwächen und keine alte DB-Sicherung über neue Writes
legen. Ein reiner App-Rollback verlangt ein kompatibles geprüftes Image;
SQLite/PostgreSQL-Schema und Backend bleiben unverändert. Kein DB-Cutover oder
produktiver Rollout ist durch diese Entwicklungsabnahme autorisiert.
