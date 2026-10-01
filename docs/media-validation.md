# Medienabschluss und Fehlergrenzen

Neue TV-, Film- und Generic-RSS-Producer liefern immer den NZB-Metablock
`pingufunk-media-expectations`: kanonisch Base64-kodiertes JSON mit `version: 1`
und den erforderlichen nullable Feldern `duration`, `audio`, `resolution`.
Fehlende Sollwerte sind unbekannt, nicht erfolgreich geprüft. Ein deklarierter
ungültiger, doppelter oder unbekannt versionierter Block wird vor dem Queuewrite
abgelehnt. Nur das Fehlen des Blocks bleibt Legacy-kompatibel; es beweist kein
Erzeugungsdatum.

Auch die Websuche/Filmoberfläche erhält pro Rendition ein serverseitig erzeugtes
NZB aus demselben Owner (`SearchResult.nzbDownloads`). Der Browser wählt und
sendet das opaque NZB unverändert; keine eigene XML-/Sollwertberechnung und
kein neuer Downloadendpoint. Die bisherige UI-Dateinamen-/Kategorieauswahl
bleibt erhalten. Eine deklarierte v1-Erwartung wird nicht als Legacy umgangen.

## Erwartungen und Datenbestand

Kataloglaufzeit ist in Sekunden; verifizierte Episodenmetadaten werden einmal
von Minuten nach Sekunden umgerechnet und haben Vorrang. Laufzeit eines
gesuchten Films ist kein Beweis für einen unsicheren Beitrag. Audioerwartung
kommt nur aus expliziter Provider-Audioevidenz, niemals aus Titel, Locale oder
URL. Qualitätsnamen/Renditions beweisen keine Dimensionen: eigene Producer
lassen `resolution` derzeit NULL. Der Vertrag unterstützt belegte Dimensionen.

Beide append-only Migrationsketten ergänzen nullable Textfelder
`Download.mediaExpectations` und `mediaValidation`. Historische Werte bleiben
NULL, keine Neuberechnung aus Titeln. Import/SQLite-Bestandsübergang erhalten
vorhandene Strings bytegleich. Retry behält die Erwartungen, nicht die alten
Prüfergebnisse; Restart erhält beides.

## Gemeinsamer Abschlussowner

Alle progressiven, HLS- und Konvertierungszweige prüfen nach erfolgreichem
Transfer/Mux und vor `completed` dieselbe lokale Datei. Bei unkodiertem Body
mit gültiger `Content-Length` müssen die empfangenen Bytes exakt passen.
Automatisch dekodierte Bodies haben dagegen keine verlässliche Dateilänge aus
der Wire-Längenangabe.

ffprobe liest ausschließlich eine reguläre, nicht leere direkte Datei im
eigenen Jobverzeichnis ohne Symlinkpfad; Inode, Größe und mtime dürfen sich
während der Probe nicht ändern. Netzwerkprotokolle sind ausgeschlossen,
Containerformate begrenzt. Eigene Prozessgruppe: maximal 30 Sekunden und 1 MiB
stdout/stderr; Timeout/Overflow beenden nur den eigenen Prozessbaum. Das Image
liefert ffprobe lokal. Der absolute Override `PINGUFUNK_FFPROBE_PATH` ist
Betreiberkonfiguration; keine automatische Installation beim Request.

Erforderlich sind lesbarer Container, positive endliche Dauer und nutzbare
Audio-/Videospuren; Coverbilder zählen nicht als Video. Belegte Solldauer nutzt
denselben Prozentwert wie P06 (`matching.sonarr.tolerancePercent`, Default 10,
zulässig 0–25). Belegte Auflösung muss exakt vorkommen; Audioerwartung verlangt
einen passenden expliziten Container-Tracktag. Unbekannte Sollchecks bleiben
`unknown`, bestandene belegte Checks `passed`. Fakten, Status und Importpfad
werden gemeinsam in einer begrenzten DB-Transaktion gespeichert.

**Grenzen:** Kein Voll-Decode, keine Erkennung gesprochener Sprache und kein
Film-/Episodenidentitätsbeweis. Fehlende Tracktags können eine explizite
Audioerwartung nicht bestätigen und scheitern konservativ, auch bei tatsächlich
richtiger Sprache. Ohne verlässliche Solldauer sind nicht alle verkürzten
Beiträge erkennbar. Historisch abgeschlossene Jobs werden nicht erneut geprüft.
Die Probe schützt nicht vor privilegierten externen Writern nach dem Dateicheck.

## Fehler und Wiederaufnahme

Medienfehler ergeben failed, danach läuft bei verfügbarer DB der nächste Job.
DB-Ausfall pausiert den Drain ohne Spinloop, Backendwechsel oder Redownload.
Der nächste ausdrückliche Weckruf (etwa Enqueue) gleicht betroffene eigene Jobs
ab und verarbeitet die Queue weiter. **Kein automatischer Reconnect-Timer.**
Beim Kaltstart markiert der Recoveryowner aktive unterbrochene Jobs als failed;
Retry bleibt bewusst. Bereits dauerhaft verifiziertes completed wird nach
verlorener Commitbestätigung nicht überschrieben: fehlende Bestätigung beweist
keinen Rollback. Eigene Fehlerartefakte können im Jobverzeichnis bleiben, sind
aber nicht importbereit; keine fremde Bereinigung.

Sonarr-Metadatenfallback darf HLS über das bestehende `download.enableHLS`
verwenden, Default weiterhin aus. Derselbe finale Gate gilt auch hier;
SRF-/ORF-Muxing bleibt erhalten. Kategorien, GUIDs, Jobpfade und Remote-Path-
Mapping bleiben unverändert.

## Reproduzierbare Entwicklungsproben

```sh
npm test
npm run test:pg
docker build --target runner -t pingufunk-p09-runtime-qa .
docker build --target migrator -t pingufunk-p09-migrator-qa .
bash scripts/media-container-smoke.sh
```

Nur eigene synthetische Medien und disposable Backends: Legacy/v1,
Soll-/Unknown-Werte, Sample, HTML, fehlendes Audio, echte Truncation,
progressive Datei, HLS→MP4, HLS→MKV, MP4→MKV, SAB-Importpfad, Queuefortsetzung
und Restart. Die PG-Probe pausiert nur ihren über Name und Ownerlabel geprüften
eigenen Container und prüft DB-Abbruch plus sicheren nächsten Weckruf.
Kein Sender-/Arr-Verkehr, keine produktive Datenbank oder Medien.
