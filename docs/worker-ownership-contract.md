# Exklusiver Einzelworker, Fencing und Shutdown

Entwicklungsvertrag P15.1; Status und Abnahme ausschließlich im
[Phasen-TODO](../todo/proxy-retirement.md). Kein Produktionsrestart,
Replikazahlerhöhung oder Cutover ist freigegeben.

## Besitz ist kein Prozessflag

`worker-lease.ts` besitzt eine versionierte interne Configzeile, verborgen und
unveränderbar über die Settings-API. Beide unterstützten Backends verwenden
dasselbe geschlossene Recordformat: zufälliger Besitzer, monotoner Fence,
Expiry in Millisekunden. Die bestehende Configstruktur reicht aus; keine neue
DDL und kein Umschreiben von Job-IDs, Pfaden oder Erwartungen.

Akquisition erfolgt als exakter Compare-and-Swap gegen vorherigen Wert und
DB-Zeit **in derselben SQL-Mutation**. PostgreSQL verwendet `clock_timestamp`,
SQLite seine native Zeitfunktion. Lease 30 Sekunden, Heartbeat fünf Sekunden,
Sicherheitsmarge fünf Sekunden; ein konservativer monotoner Watchdog bricht
eigene Transfers bei verlorener Erneuerung ab. SQLite setzt korrekte Dateisperren
und kohärente Hostuhren voraus: keine HA-Zusage für unsichere gemeinsame Mounts.

Jeder Workerwrite hält die Leasezeile in einer kurzen Transaktion gesperrt und
prüft Eigentümerwert/Expiry. Ein verspäteter alter Prozess darf weder Status
noch Fortschritt oder Abschluss des neuen Besitzers schreiben. Wartungsgate
und bei PG der dauerhafte First-write-Checkpoint bleiben vor Raw-/Modelwrites
wirksam. Der Checkpoint wird vor interaktiven Transaktionen vorbereitet, nicht
über eine dort blockierte zweite Poolverbindung.

Der zweite Prozess berührt fremde aktive Jobs nicht. Nur nach erworbenem Besitz
werden `downloading`/`converting` als unterbrochen beendet. Recovery transferiert
nichts erneut; neue `queued`-Jobs dürfen anschließend weiterlaufen. Ein DB-Fehler
oder ungewisser Commit ist kein Retrybeleg. Bereits persistierte terminale
Zustände werden bei der späteren Reconciliation nicht überschrieben.

## Eigene Transfers und Kindprozesse beenden

HTTP-Transfer, Quellenbeleg, ffprobe, yt-dlp und FFmpeg erhalten das Besitz-
Abbruchsignal. Werkzeugprozesse laufen in eigenen POSIX-Prozessgruppen;
TERM, nach höchstens zwei Sekunden KILL, ausschließlich für den eigenen Baum.
Leader-Exit allein lässt terminierte Nachkommen nicht absichtlich zurück.
Auf Windows ist ein begrenzter PID-bezogener `taskkill`-Pfad implementiert,
aber nicht als nativ geprüft behauptet. Ein Killaufruf ist kein Abschluss:
Transfer-/Probe-/Muxowner warten auf tatsächliches `close`.

FFmpeg überschreibt keine vorhandene Ausgabe (`-n`), abgebrochene Muxes werden
auch bei Exitcode null nicht completed. Jobbezogene Staging-/Zielverzeichnisse
und exklusive Veröffentlichung bleiben erhalten; Nachbardateien werden nicht
bereinigt. Keine Behauptung einer allgemeinen Dateisystemsandbox oder eines
atomaren DB-/Dateisystemcommits. Unerwartete eigene Toolreste dürfen zur Diagnose
liegen bleiben und sind kein geprüfter Download.

Die schreibenden Startwege setzen `NEXT_MANUAL_SIG_HANDLE=1`; der tatsächlich
verwendete Next-Startserver überlässt Signale damit dem installierten Owner.
Next kann Instrumentation und Routen in getrennte Modulgraphen bündeln. Ihr
Scheduling-/Lease-/Drainzustand liegt deshalb in einem gemeinsamen, versionierten
prozesslokalen Slot; der Signalhandler drainiert nicht einen zweiten leeren
Modulzustand. Dieser Slot ersetzt weder DB-Fencing noch Prozess-Isolation.
SIGINT/SIGTERM stoppen Scheduling, brechen eigene Arbeit ab und drainieren
Transfers/Tools vor terminalem Write und Freigabe der Lease. Erfolg endet mit
130/143, DB-/Drainfehler mit 1; nach zwölf Sekunden greift ein harter eigener
Prozessabschluss. Dann ist Expiry/Recovery nötig, keine Freigabe vorgetäuscht.
Wartungsstarts entfernen das manuelle Signalflag und starten keinen Worker.

Lazy Entwicklungs-Toolinstallation ist keine leasegeschützte Downloadqueue und
besitzt noch keinen vollständigen Prozessbaum-Abbruchvertrag; vor dem tatsächlichen
Medientoolstart wird der Abbruch nochmals geprüft. Container besitzen die Tools
bereits. Ein harter Prozessabschluss lässt die Lease konservativ auslaufen.

## Runtime, Updates und Rücknahme

Runtime liefert nur geschlossene prozesslokale Zustände `idle`, `waiting`,
`held`, `lost`, niemals Owner/Fence/Configinhalt. `held` beobachtet diesen
Leaseowner; es ist kein Download- oder Arr-Importnachweis und keine Freigabe für
mehrere Worker. Konfiguriert bleibt Parallelität eins.

**Gemischte alte/neue Writer sind nicht sicher:** historische Images kennen die
Lease nicht. Vor einem separat freigegebenen Update alle alten Writer stoppen
und aktive Jobs/Dateieffekte abstimmen. Auch bei Rücknahme zuerst alle neuen
Writer stoppen; kein älterer ungesicherter Writer darf parallel laufen.
Die in P15.4 hinzugefügte Receipt-DDL begrenzt weiterhin ältere Imagekompatibilität:
nur nachweislich schema-/v3-kompatible Images, Provider erhalten und PG-Writes
niemals durch Reaktivierung eines veralteten SQLitebestands verlieren.

## Kausale Abnahme

Zwei echte disposable Prozesse je Backend: aktive Fremdjobs, Heartbeat,
Takeover, verspäteter Fence, Crash und tatsächliche Leaseexpiry; kontrollierter
HTTP-Abbruch, unveränderte Nachbardatei und Folgequeue. Der PG-Ausfalltest pausiert
ausschließlich seinen eigenen Container und verlangt Besitzverlust ohne Write
oder SQLitefallback. Die Mediencontainerkette stoppt den realen Next-Writer in
einem tatsächlich laufenden FFmpeg-Mux und prüft terminalen Fehler, Restart und
Folgeabschluss. Weitere Mock-/Datei-/Probe-/Muxtests sichern einzelne Ownergrenzen,
ersetzen diese nativen Prozesse nicht. Keine mobile oder produktive Abnahme.
