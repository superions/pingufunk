# Runtimeprüfung und schonender Volume-Start

Entwicklungsvertrag P15.3, 08.10.2026. Status und Ausführungsnachweise stehen
ausschließlich im [Phasen-TODO](../todo/proxy-retirement.md). Kein Release,
Produktionsrestart oder DB-Cutover ist hiermit freigegeben.

## Readiness ist kein Import- oder Workerbesitznachweis

`/api/health?mode=live` meldet nur einen antwortenden Prozess, ohne DB-, Tool-
oder Queueleseoperation. Standardmodus `ready` prüft bei jedem Aufruf die
aktuelle DB-Erreichbarkeit und zusätzlich das vorhandene vollständige
Schema-/Ledger-/Checksum-Prüfskript. Strukturprüfungen laufen in einem eigenen
begrenzten Node-Prozess, werden zusammengeführt und bei Erfolg zehn Sekunden,
bei Fehler eine Sekunde gecacht. Erfolgreicher Maintenancebetrieb ist ready,
aber `writesEnabled=false` und Worker `disabled`. Nicht bestätigte Readiness
liefert 503, ungültiger Modus 400, sämtliche Antworten `no-store`.

Der Workerstatus ist ausdrücklich **prozesslokal**, mit Parallelität eins.
Der historische P15.3-Stand lieferte `exclusiveOwnership=unverified`; P15.1
ergänzt die geschlossenen Besitzbeobachtungen gemäß
[Workervertrag](worker-ownership-contract.md). Idle, aktive Verarbeitung und
persistenzbedingt pausierter Fortschritt sind unterscheidbar. Das ist kein
Arr-Importnachweis. Auch gesunde DB und vorhandene Tools beweisen keinen
abgeschlossenen Download.

Die Health-GETs installieren nichts, initialisieren keine DB, führen keine
Migration aus und starten keine Queue. Verbindungsdaten bleiben im vorhandenen
Secret-/Environmentweg, nicht in Prozessargumenten oder API-Diagnosen.

## Begrenzte asynchrone Toolprüfung

`tool-capabilities.ts` verwendet die tatsächlichen Transfer-/Probeowner für
FFmpeg, ffprobe und das konfigurierbare yt-dlp, nicht zufällige PATH-Funde.
Je Tool maximal zwei Sekunden, insgesamt höchstens 4096 Ausgabebytes und 64
stdout-Chunks; drei Prüfungen parallel, nur eine gemeinsame Inspektion in
flight. Kein Shell-Aufruf oder `ensure`/Download/Update. Bei Timeout/Überlauf
werden nur eigene Prozessbäume beendet. Erfolgs-TTL 30 Sekunden, Fehler-TTL
zwei Sekunden; Konfigurationswechsel invalidieren den Schlüssel. Während
einer laufenden alten Inspektion bleibt der neue Pfad unbestätigt statt den
alten Befund zu übernehmen.

Die API liefert ausschließlich geschlossene Zustände und streng geprüfte
Versionsangaben, niemals Toolstdout, lokale Pfade, argv oder Exceptiontexte.
Fehlend, Timeout, malformed und unbestätigt sind verschieden. Windows-
Prozessbaumcleanup ist implementiert, aber nicht als nativ geprüft behauptet.

`/api/system` erhält seine bisherigen Statistik-/Versionsfelder und den
500-Fehlervertrag; zusätzliche Capabilities und Runtimefelder sind typisiert.
Parallele Reads sind auf drei Sekunden begrenzt. Das begrenzt das Awaiting,
**nicht** die zugrunde liegende Prismaoperation und ist keine Retry-Freigabe
für Mutationen. Historische TVDB-Zeilen sind explizit kein aktiver Metadatencache.
Der Desktop bestätigt die geschlossene Antwortform, hat ein Fünfsekundenlimit
und Generationguard; fehlgeschlagene oder unbestätigte Antworten entfernen
alte gesunde Statistiken. Toolfehler allein behaupten keinen DB-Ausfall.

## Volumeinitialisierung ohne rekursive Rechteänderung

Der Container prüft zuerst das ausgewählte DB-Schema. Nur bei freigegebenem
Schreibbetrieb wird `download-directories.mjs` aufgerufen. Die Pfadpriorität
entspricht dem bestehenden Produktowner: persistiertes `download.path`, sonst
`DOWNLOAD_FOLDER_PATH`, sonst `downloads` unter dem Arbeitsverzeichnis;
`DOWNLOAD_TEMP_PATH`, sonst `incomplete` darunter. Kein persistierter Pfad
wird umgeschrieben.

Prepare erzeugt nur fehlende benötigte Verzeichnisse mit 0755 und setzt
ausschließlich für selbst neu erzeugte Verzeichnisse PUID/PGID. Existierende
Verzeichnisse, Medien und Nachbarn werden weder gechownt noch gechmoddet.
Symlink-/Datei-/Root-/Kontrollzeichenpfade brechen ab; ein offener fd prüft die
Identität neu erzeugter Verzeichnisse vor `chown`. Das ist keine vollständige
Host-Dateisystemsandbox. Installationen müssen kanonische Pfade verwenden.

Check läuft als tatsächlicher Ausführungsuser und prüft Lesen/Schreiben/Traversal
plus exklusive temporäre Nullbyte-Datei, die unmittelbar entfernt wird. Ein
Readonlymount oder unpassender vorhandener Owner stoppt den Writer **vor** dem
Queuestart. Keine automatische Reparatur alter Volumeinhalte. Beide Schritte
haben eine Startupdeadline von zehn Sekunden; sichere Meldungen enthalten keine
Pfade oder DB-URLs. Maintenance legt keine Downloadverzeichnisse an und berührt
auch keine Readonly-Medienmounts.

Die frische Compose-Beispielkonfiguration verwendet nun den tatsächlich nach
`/app/downloads` gemounteten Writerpfad; das Arr-Beispielmapping ist `/downloads`
für denselben Hostordner. **Bestehende Konfigurationen werden nicht migriert:**
individuelle Mounts/Mappings und persistierte Pfade müssen bewusst erhalten
oder installationsbezogen geprüft werden.

## Verifikation und Rückweg

Native Tests prüfen asynchrone Timeoutresponsivität, konfigurierte/rotierende
Binaries, geschlossene Antworten und unveränderte Owner/Mode/Inhalte. Die
SQLite-/PG-Containerketten prüfen Sentinels über Start/Restart/Maintenance;
Readonly-Writerstart muss scheitern. Reale synthetische Medienworker prüfen
weiterhin, dass erlaubte Downloadabschlüsse funktionieren. Keine fremden
Volumes oder Prozesse werden bereinigt.

Keine DDL in P15.3. Ältere Images besitzen den neuen Healthendpoint nicht;
beim bewusst freigegebenen App-Rollback gehört deshalb die Healthdefinition
zum jeweiligen Image. Bereits persistierte v3-Medienerwartungen dürfen trotzdem
nicht auf einen v3-inkompatiblen Worker zurückgerollt werden (P12-Vertrag).
Kein SQLite-/PG-Providerwechsel und keine Replikazahlerhöhung als Nebenwirkung.
