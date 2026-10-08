# Bestätigung eines GUI-Downloadauftrags

Aktueller ausführbarer Status: [P15.4 im Phasenvertrag](../todo/proxy-retirement.md).
Kein Deployment- oder Migrationsauftrag. Es bleibt bei einem Downloadworker.

## Auftrag statt unsicherem Transportretry

Die eigene Suche und Filmsuche senden optional `X-Pingufunk-Enqueue-Key`.
Ein Schlüssel bezeichnet genau einen bewusst begonnenen Auftrag: UUID plus
Erstellungszeit in Unix-Millisekunden. Er ist keine Authentifizierung und
keine globale Film-/Serien-/URL-Deduplikation. Native SAB-Clients ohne Header
bleiben unverändert; identische native Aufträge können weiterhin getrennte Jobs
erzeugen. Beide vorhandenen SAB-Endpunkte und Legacy/v1/v2/v3-NZBs bleiben nutzbar.

Der Server bindet den Schlüssel an den normalisierten Auftragsinhalt
(exakte URL einschließlich Selektoren/Signatur, Titel, Kategorie und über den
bestehenden Parser serialisierte Medienerwartung). Anderer Inhalt unter
demselben Schlüssel ergibt HTTP 409, nicht eine neue Einreihung.
Weder Metadaten-ID noch ähnliche Titel werden automatisch zusammengelegt.

`EnqueueIntent` enthält ausschließlich Schlüsselhash, Payloadhash,
ursprüngliche Download-ID und Ablaufzeit. Empfangsbestätigung und Job werden
in einer DB-Transaktion gemeinsam angelegt. Die Primärschlüsselgrenze gilt
auch bei parallelen Aufrufen. Nur ein bewiesener Unique-Konflikt erlaubt
anschließend das Lesen der vorhandenen Bestätigung; ungewisse Transaktionen
werden niemals blind wiederholt. Nur eine neue Einreihung stößt den Worker an.

SQLite-Aufträge innerhalb eines Prozesses erhalten einen seriellen Schreibzugang
(maximal 64 Wartende, drei Sekunden Admissiondeadline). Ein vor Admission
abgelaufener Aufruf startet auch später keine Mutation. Nach Admission wird kein
Readtimeout über die Transaktion gelegt. Diese Begrenzung ist keine globale
Idempotenz oder Retrylogik: DB-Receipt und atomarer Unique-Vertrag bleiben die
Autorität, auch über Prozesse hinweg; unbekannter Commit/BUSY ergibt einen Fehler.

Die Bestätigung hat absichtlich keinen FK/Cascade zum Job. Ein ausdrücklicher
History-Delete oder Retry kann dessen alten Datensatz entfernen; ein verlorener
Enqueue-Response darf danach trotzdem keinen zweiten Transfer verursachen.
Ein erneuter ACK bestätigt den ursprünglichen Commit und die ursprüngliche ID,
nicht einen noch aktiven Job, eine vorhandene Datei oder einen Arr-Import.
Für die eigene bewusste History-Retry-Operation gilt weiterhin deren neuer Job.

## Browser und Unsicherheit

Vor dem POST speichert der Browser maximal 64 unbestätigte Schlüssel in
`sessionStorage`. Kein NZB, Titel, Medien-URL, API-Key oder Metadatenpayload
liegt dort. Der serverseitige Fingerprint bezieht sich auf den normalisierten
Jobinhalt, nicht den wechselnden NZB-Transportzeitstempel. Deshalb kann ein
erneuter Suchaufruf nach Reload denselben Auftrag bestätigen, solange der
tatsächliche Payload unverändert bleibt. Qualitäts-/Kategorie-/URL-Änderungen
sind andere Aufträge, keine globale Doppelgrab-Sperre.

Eine positive, validierte ACK mit genau einer Job-ID beendet die Unsicherheit.
Ein später bewusst angeklickter Download bekommt dann einen neuen Schlüssel.
Netzwerk-, Timeout-, Storage-, Konflikt- oder ungültige Responsefehler behalten
den bisherigen Schlüssel. Es gibt keinen automatischen HTTP-Retry.
„Bestätigung erneut anfordern“ verwendet denselben Auftrag. „Als neuen Auftrag
einreihen“ erfordert einen Warnungsdialog mit Abbrechen/Bestätigen: Der alte
Auftrag kann schon existieren, ein neuer kann denselben Inhalt doppelt laden.

Browser-Scope ist dieselbe Origin und derselbe erhaltene Tab-/Sessionspeicher.
Separater Tab, gelöschter Browserspeicher oder anderer Payload sind kein
nachgewiesener alter Auftrag. Fehlender/korrupt/unwritable/voller Speicher
bricht vor dem Senden ab; keine stille Eviction unbestätigter Aufträge.
Der Browser verwendet `crypto.getRandomValues`, weder `randomUUID` noch
`SubtleCrypto`; SSL ist keine Produktvoraussetzung dieses Pfads.

## Grenzen und Retention

- Schlüssel maximal sieben Tage ab Erstellungszeit gültig; höchstens eine
  Minute Zukunftstoleranz für die Browseruhr. Ungültige/abgelaufene Schlüssel
  werden vor einer Mutation abgelehnt. Nach Ablauf erst Queue prüfen und
  ausdrücklich neuen Auftrag wählen; Ablauf macht den alten Schlüssel nicht
  erneut als „neu“ verwendbar.
- Pro keyed Anfrage werden höchstens 100 abgelaufene Empfangsbestätigungen
  entfernt (Expiryindex). Keine Job-, History- oder Dateiretention.
- NZB maximal 256 KiB, inklusive chunked Body; maximal 4096 Chunks,
  absolute Lesedeadline 15 Sekunden. Fatal UTF-8, keine komprimierten Bodies.
  Keine XML-/Regex-Parserarbeit vor dieser Grenze. Abbruch/Cancellation darf
  die Deadline nicht verlängern.
- Query maximal 16.384 Zeichen und keine doppelten mode/cat-Parameter.
  Bestehende Titel-/Kategorie-/Erwartungsvalidierung bleibt vorgeschaltet.
- Ein Body-/Readtimeout ist kein Beweis für einen nicht ausgeführten DB-Commit.
  Nach dem Enqueue bleibt deshalb der stabile Schlüssel wichtig. Keine
  Wiederholung einer Mutation mit neuem Schlüssel als vermeintlicher Readretry.

## SQLite, PostgreSQL und Rollback

Beide append-only Ketten erhalten `20261008000000_enqueue_intent`; alte
Migrationen, bestehende Jobspalten, IDs, Kategorien und Dateipfade unverändert.
Clients werden mit den realen Generatoren erstellt. Aktuelle Quellen übernehmen
auch alle Empfangsbestätigungen mit millisekundengenauer Ablaufzeit; akzeptierte
historische Quellen ohne diese Tabelle liefern einen leeren Bestand, nicht
erfundene Bestätigungen. Shape/Ledger/Sourceintegrität und semantischer Vergleich
bleiben Pflicht. Der historische P09-Medienschema-Stand ist separat akzeptiert.

Vor einem später ausdrücklich genehmigten Update: Worker stoppen, konsistent
sichern/integritätsprüfen, die ausgewählte Kette explizit migrieren, passende
Runtime zunächst in Maintenance prüfen. Kein automatisches DDL beim Appstart.
Vor neuen Writes kann der unveränderte Source-Snapshot mit seinem passenden
alten Image zurückkehren. Nach neuen Writes den gewählten Provider beibehalten,
Writer stoppen und den aktuellen vollständigen DB-Stand sichern.

Ein Image vor dieser DDL kennt weder Tabelle noch Receipt-Protokoll. Dessen
strikter Schema-/Ledgergate muss den neuen Bestand ablehnen; kein Überlisten
des Gates und keine Tabellen-/Ledgerlöschung. Der Harness prüft diesen
Ablehnungsfall, vollständige PG-Backup-/Restoregleichheit einschließlich
Receipts und einen Maintenance-Rollback mit dem exakten kompatiblen Image.
Das ist **kein Nachweis einer funktionalen Rückkehr auf das historische Image**.
Ein späterer Code-Rollback braucht einen explizit getesteten schema- und
receipt-kompatiblen Build; ein alter SQLite-Snapshot ist nach PG-Writes veraltet.

## Evidenzgrenzen

Reale Wegwerf-SQLite-/PG-Tests: paralleler identischer Auftrag, Commitantwort
ignorieren, Client-/Modulrestart, Konflikte, neuer Auftrag, Rollback bei
fehlgeschlagenem Jobinsert, History-Retry/-Delete, Expiry/Cleanup und Maintenance.
Containerharness: realer Prozessrestart und identische Receipt-ID ohne neuen
Transfer auf beiden Backends, vorhandene Medienconsumer bleiben erhalten.

Desktop 1280×720 Light auf tatsächlich gebautem Bundle: gematchtes Vorher/
Nachher für Suche/Filme, HD/SD/Low, verlorene ACK, bewusste Wiederholung,
Reload, Dialog-Cancel und Keyboard-Confirm. Isolierter synthetischer API-
Simulator, keine realen Jobs/Downloads; dessen ACK/ID-Readback schützt die
UI-Kette, nicht den DB-Nachweis. Browser-Konsole leer. Backend-/Container-
Abnahme erfolgt über die eigenen Gates und ist separat im TODO ausgewiesen.
