# Sichere Diagnose progressiver Downloads

## Vertrag und Grenzen

`src/server/download-manager.ts::downloadFile` unterscheidet Fehlerphasen,
statt jede Ausnahme ausschließlich als `Download failed` zu melden. Das ist
Diagnostik, kein automatischer Retry, Resume oder Beweis einer historischen
Fehlerursache. Die bestehenden 60 Sekunden Inaktivitätsgrenze, eine Worker-
Instanz, keine HTTP-Weiterleitungen, exklusive Zieldateien und der lokale
Medienabschluss bleiben erhalten. Keine neue DB-Spalte oder Migration.

Bei einem Fehler entsteht ein begrenzter `TransferFailure`-Vertrag, Version 1:

| Feld                             | Aussage                                                                                                 |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `phase`                          | `request`, `response`, `file_open`, `body_read`, `file_write`, `progress` oder `file_finish`            |
| `reason`                         | Ausnahme, Inaktivität, HTTP-Status, fehlender Body, ungültige Länge, Überlauf oder unvollständige Länge |
| `code`                           | Geschlossener bekannter Node-/Fetch-/Prisma-Code; andernfalls `UNKNOWN`                                 |
| `receivedBytes` / `writtenBytes` | Vom Reader erhaltene bzw. vom Write-Callback bestätigte Bytes                                           |
| `expectedBytes`                  | Zuverlässige unkodierte Content-Length, sonst `null`                                                    |
| `httpStatus`                     | Empfangener numerischer Status, vor einer Antwort `null`                                                |
| `elapsedMs`                      | Verstrichene Wallclock-Zeit des Transfer-Versuchs                                                       |
| `cleanupCode`                    | Optionaler bekannter Code einer fehlgeschlagenen Partialdatei-Bereinigung                               |

Bestätigter Schreib-Callback bedeutet nicht `fsync` oder Stromausfallsicherheit.
HTTP-200 und korrekte Bytes beweisen keinen Medieninhalt; die vorhandene
ffprobe-/Erwartungsprüfung bleibt vor `completed`. Kodierte Antworten können
nach Fetch-Decodierung größer als ihre Wire-Content-Length sein und werden
nicht fälschlich als Überlauf eingestuft.

Der Server loggt nur diese Felder und einen 16-stelligen SHA-256-Jobbezug.
Die Failed-History erhält `Download failed: <JSON>` über das bestehende
Error-Textfeld. Alte Texte bleiben lesbar; keine History-Umschreibung. Eine
gescheiterte Statusspeicherung darf den ursprünglichen Transferbeleg beim
späteren Queue-Weckruf nicht durch einen generischen Text ersetzen.

`download-failure.ts` untersucht höchstens vier Ebenen der Fehlerursache und
kopiert ausschließlich Codes aus einer expliziten Allowlist. Keine rohe
Exception, Message, Stack, Hostadresse, URL, Query, Dateipfad, `statusText`,
Antwortbody, Header, Socket- oder Prisma-Metadaten. Unbekannte Codes werden
nicht mittels einer permissiven Regex als vermeintlich sicher akzeptiert.
Bestehende andere Download-/Medienlogs sind nicht Gegenstand einer pauschalen
Logger-Überarbeitung.

Ein Dateistream-Fehler kann einen ausstehenden Fetch-Reader abbrechen. Der
erste Dateifehler behält dann seine Dateiphase; der folgende Abort ist kein
Nachweis einer Netzstörung. Ebenso ist Inaktivität während `progress` kein
Netzwerk-Stallbeweis: die Fortschritts-DB-Schreiboperation kann warten. Die
Diagnose löst deren Promise nicht vorzeitig auf oder startet einen zweiten
Worker. Kommt sie nach ausgelöster Inaktivität zurück, wird nicht nachträglich
`completed` gemeldet. Überlange DB-Wartezeiten benötigen weiterhin die
bestehenden backendbezogenen Timeouts.

Nur eine in diesem Versuch erfolgreich exklusiv erzeugte Partialdatei wird
bei Abbruch bereinigt. Ein bereits vorhandenes Ziel bleibt unverändert, auch
wenn es zwischen Vorprüfung und Stream-Open angelegt wurde. Bereinigungsfehler
werden separat sichtbar und ersetzen nicht die eigentliche Transferphase.

## Reproduzierbarer isolierter Nachweis

```sh
npm ci
npx vitest run src/server/download-failure.test.ts src/server/download-manager.test.ts
```

Die Suite startet einen ausschließlich an Loopback gebundenen HTTP-Server
auf einem zufälligen Port und verwendet den nativen Node-Fetch gegen
synthetische Bytes. Server, Verbindungen, Timer und eigene temporäre Dateien
werden beendet bzw. bereinigt. Kein Provider, keine echte Bibliothek, keine
Produktionsdatenbank und kein Grab. Datenbank und lokale Medienprobe werden
für diese Transfer-Reproduktion explizit gemockt; sie ist keine neue
Medien-/Importabnahme.

Geprüft werden Socket-Abbruch nach tatsächlichem Byteempfang, gültiger Body,
Gzip-Decodierung sowie verbotene Weiterleitung ohne Request an das Ziel.
Zusätzliche gezielte Fault-Injections prüfen DB-Fortschritt und Reconnect,
Schreibfehler, exklusive Open-Race, Inaktivität, Längenverletzung und geheime
Werte in Messages/Codes/Metadaten. Fehler lassen bei verfügbarer DB die
vorhandene Queue weiterarbeiten; persistierte `completed`-Writes und Probe
sind bei Transferfehlern verboten.

Der echte Socket-Abbruch ist eine reproduzierte Fehlerklasse, **nicht** die
bewiesene Ursache eines alten generischen Produktionsfehlers. Das lässt sich
aus fehlenden historischen Diagnosedaten nicht nachträglich rekonstruieren.
Ein künftig freigegebener Produktivversuch kann mit diesem Stand präzisere
Daten liefern; Deployment und erneuter Grab bleiben getrennte Freigaben.
