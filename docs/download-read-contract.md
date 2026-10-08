# Queue-/History-Reads und Desktop-Paging

Entwicklungsstand P15.2 vom 08.10.2026. Der ausführbare Abnahmestatus steht
ausschließlich in [P15.2](../todo/proxy-retirement.md). Kein Deployment,
Retentionjob, automatischer Retry oder Arr-Importnachweis.

## Kompatibilität und Begrenzung

Die beiden bestehenden SAB-URLs nutzen denselben Readowner. `start` ist
0–1000000; `limit` ist 0–10000. Ungültige, doppelte, negative oder übergroße
Parameter geben 400 zurück, nicht eine heimlich kleinere Ergebnismenge.
Fehlendes Limit und ausdrücklich `limit=0` erhalten den ausgelieferten
Alle-Modus. Diese Kompatibilitätsausnahme ist keine begrenzte Gesamtantwort;
die eigene GUI verwendet immer ausdrücklich 50. Historische Jobs werden
weder gekürzt, archiviert noch gelöscht.

`category`/`cat` (bis 16), `status`, `failed_only`, `search` (bis 200 Zeichen)
und `nzo_ids` (bis 100 konkrete IDs) werden validiert. Widersprüchliche Aliasse
oder Filter brechen ab. `*` bedeutet SAB-Defaultkategorie, nicht alle Kategorien.
Private historische Unterordner bleiben unter ihrer öffentlichen Kategorie
auffindbar. Der Namefilter verwendet den jeweiligen Prisma-/DB-LIKE-Vertrag;
ASCII-Groß-/Kleinschreibung ist auf beiden Backends geschützt, Unicode-Collation
bleibt ein Datenbankvertrag und wird nicht pauschal gleichgesetzt.

Die offizielle [SAB-API](https://sabnzbd.org/wiki/configuration/4.5/api) dokumentiert
Paging und gezielte ID-/Kategorieabfragen. Die Originalconsumer von
[Sonarr 4.0.20.3014](https://github.com/Sonarr/Sonarr/blob/v4.0.20.3014/src/NzbDrone.Core/Download/Clients/Sabnzbd/Sabnzbd.cs)
und [Radarr 6.4.4.10685](https://github.com/Radarr/Radarr/blob/v6.4.4.10685/src/NzbDrone.Core/Download/Clients/Sabnzbd/Sabnzbd.cs)
fordern die Queue mit Limit null und die History mit ihrer eigenen
Historygrenze an. Eine ausdrücklich vom Consumer gewählte Historygrenze kann
alte Einträge außerhalb seiner Seite ausblenden; Pingufunk setzt keine neue
unsichtbare Defaultgrenze. Betreiber müssen deren Poll-/Importfenster passend
wählen; einzelne alte IDs bleiben direkt abrufbar.

Upstream `4ebaa8e8fa839fe44fa7862be0b49896385f5b49` besitzt bereits optionales
History-Paging mit Timestamp-/ID-Tiebreaker. Dieses Prinzip bleibt erhalten;
die hiesige Anpassung ergänzt Queue-/Filter-/ID-Semantik, Snapshotcounts und
die fork-eigenen sicheren Speicherpfade. Upstreams andere persistierte Queue-
und Medienverträge werden nicht ungeprüft übernommen.

## DB- und GUI-Vertrag

Gepagte/gezielte Reads führen Counts und Zeilen im gemeinsamen Serializable-
Lesesnapshot aus, auf SQLite und PostgreSQL. Queue nach `createdAt,id`, History
nach `completedAt DESC NULLS LAST,id`. Keine Nutzlast-URL oder persistierte
Medienerwartungen werden für Listen ausgewählt. Eine neue Completion wird
beim nächsten Snapshot sichtbar. Offsetseiten sind kein dauerhafter Cursor
über einen gleichzeitig veränderten Bestand; die GUI sagt dies ausdrücklich.

Antworten nennen gefilterten Count, gesamten Count, Start und Limit. Die GUI
validiert Fenster, Counts und Slotfelder; Generation/Abbruch verhindert späte
Reads nach Seiten-/Filterwechsel. Ein Pollfehler erhält nur den alten Bestand
desselben Fensters mit Warnung; bei Navigation wird die vorige Seite nicht
falsch beschriftet. Keine automatische Mutationswiederholung.

Aktive Jobs: fünf Sekunden; leer/idle oder Readfehler: 30 Sekunden; ausgeblendet
kein Polltimer. Sichtbarkeit zurück löst einen frischen Read aus. Die bestehende
Dreissekunden-API-Readdeadline ist keine Prisma-Cancellation und wird niemals
auf Mutationen angewendet. Completed bedeutet weiter nur Downloadabschluss,
nicht einen bestätigten Sonarr-/Radarr-Import.

## Entwicklungsbelege und Grenzen

Reale disposable SQLiteprobe: 1050 historische und 60 aktive Zeilen, gleiche
Zeitstempel, native Alle-Queue, zwei stabile Seiten, Kategorie/Failed, gezielte
alte ID und gleichzeitiger neuer Abschluss; danach sämtliche 1110 Jobs erhalten.
Dieselbe Suite ist im isolierten PG-Gate eingeordnet, dessen tatsächlicher
Erfolg separat abzuwarten ist. Keine SQLiteprobe als PG-Nachweis ausgeben.

Im tatsächlich servierten Desktopbundle 1280×720 Light wurden Filter, Seite
zwei, alter Treffer, leere Antwort sowie DB-Fehler/Recovery bedient. 1050→50
DOM-Zeilen, tatsächliche HTTP-Antwort 176798→8499 Bytes; alte Einzel-ID 247 Bytes.
Browserkonsole sauber. Im IAB bleibt ein eigener Vergleichtab `visible`;
kein echter hidden-/idle-Timer-Lauf oder Dark-/Mobiltest wird behauptet.
Die Pollentscheidung ist separat kausal unitgetestet, der vollständige Effekt-
Lifecycle wurde im Code reviewt. PG-/Fork-/Containerfinale bleibt bis Grün offen.
