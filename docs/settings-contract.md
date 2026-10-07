# Settings und festgehaltene Jobregeln

## Gemeinsamer Settingsowner

`src/lib/settings-schema.ts` inventarisiert die schreibbaren Produktkeys mit
Typ, Einheit, Default, Grenzen und kanonischer Normalisierung. API, Settings-GUI,
Arr-Validatoren und Matchingconsumer verwenden diesen Owner. Unbekannte
historische Configzeilen bleiben lesbar und unverändert, sind aber keine neuen
schreibbaren Produktsettings. `null`, Objekte und unbekannte Keys werden nicht
in Strings verwandelt. Such-TTL ist auf einen Tag, Metadaten-TTL auf sieben Tage
begrenzt; `0` deaktiviert den jeweiligen Cache.

Unter `/settings` → Matching sind unabhängig von einer Arr-Anbindung einstellbar:

| Regel                 | Key                                | Einheit / Grenzen | Fehlender Wert |
| --------------------- | ---------------------------------- | ----------------- | -------------- |
| Film-Laufzeit         | `matching.movie.tolerancePercent`  | ganze 0–25 %      | 10 %           |
| Serien-Laufzeit       | `matching.sonarr.tolerancePercent` | ganze 0–25 %      | 10 %           |
| Film-Erscheinungsjahr | `matching.movie.yearTolerance`     | ganze ±1–5 Jahre  | ±1 Jahr        |

Vorhandene gültige Installationswerte bleiben erhalten. Ungültige Matchingwerte
werden sichtbar als ungültig gemeldet und stoppen die Suche, statt still auf
Defaults zurückzufallen. `0 %` verlangt exakte Dauer. Sonst bleibt der vorhandene
5-Sekunden-Boden mit einem Deckel von 25 % der belegten Solldauer. Die absolute
Mindestdauer ist ein anderer Filter. Query-, Titel- und Quelljahr werden direkt
gegen das kanonische Filmjahr geprüft; Toleranzen dürfen nicht verkettet werden.
Filmjahr ist kein Episoden-Airdate oder Nachweis der Verfügbarkeit.

## Atomarer Write und bestätigter Readback

`POST /api/settings` validiert den gesamten Batch vor dem ersten Write und
führt alle Upserts in einer DB-Transaktion aus. Es antwortet mit `success`,
`updated` und `settings` aus den tatsächlich gespeicherten kanonischen Zeilen.
`015` wird beispielsweise als `15` bestätigt. Der Settingscontext validiert
diese Bestätigung und übernimmt nicht das ungeprüfte Submitobjekt. Seine
Responseordnung serialisiert Writes und verwirft späte beziehungsweise während
eines Writes gelesene GET-Stände. Unabhängige ungespeicherte Formulare bleiben
erhalten; ein kontrollierter Readback verlässt den aktuellen Tab nicht.

Ein Transaktionsfehler kann ein verlorenes Commit-Acknowledgement sein. Die
API meldet daher `committed: "unknown"`, invalidiert Consumer auch dann und
verspricht weder Erfolg noch einen retry-sicheren Rollback. Vor einem bewussten
neuen Schreibversuch den gespeicherten Stand neu laden. Kein automatischer Retry.
GET und bestätigter POST werden nicht HTTP-gecached. Die Header
`X-Pingufunk-Invalid-Settings` und `X-Pingufunk-Arr-Credentials` enthalten nur
bekannte Keynamen beziehungsweise `present`/`missing`/`invalid`, keine Secrets.

Die optionalen Sonarr-/Radarr-Karten speichern nur öffentliche Controls.
HTTP und HTTPS mit Unterpfad sind unterstützt; Userinfo, Query und Fragment
sind nicht erlaubt. Radarrs Inventargrenze beträgt 1–64 MiB, default 10 MiB.
Speichern ruft keine Arr-API auf. Keys bleiben ausschließlich serverseitig
(Umgebung oder Secretdatei). Die GUI zeigt nur ihren Status, keine Schlüssel
oder Dateipfade. Auch eine ungültige Credentialquelle lässt nichtsecret Settings
lesbar; aktivierte Metadatenconsumer bleiben bei ungültigen Credentials fail closed.
Credential-bearing historische Arr-URLs werden nicht an den Browser ausgegeben.

## Ein Snapshot pro Suche

`withSettingsSnapshot` erfasst die nichtsecret Produktkonfiguration mit einer
einzigen DB-Abfrage. Verschachtelte Owner verwenden denselben unveränderlichen
Snapshot in GUI-, TV-, Film-, Text-/ID-/Staffel- und RSS-Suchpfaden. Secrets
bleiben bei ihren bestehenden serverseitigen Ownern. Suchcachekeys enthalten
auch das Filmjahreslimit. Nach lokaler Settingsinvalidierung wird ein laufender
alter Suchlauf verworfen und kann seine Antwort nicht wieder in den Cache legen.
Das ist kein Mehrprozess-/Replikavertrag; der Einzelworker-Vertrag bleibt bestehen.

## Neue Jobs: MediaExpectations v3

Aktuelle eigene RSS-/UI-NZB-Producer liefern eine strenge nächste Version im
vorhandenen nullable Textfeld. Kein Schemawechsel und keine DB-Umschaltung.

- `mediaKind` ist `movie`, `series` oder `unknown` aus dem belegten fachlichen
  Kontext. Kategorie, Titel und Dateiendung sind kein Klassifikationsbeweis.
- `durations.source` hält die konkrete Katalogdauer in Sekunden samt
  `source_catalogue` und festen 10 % für den technischen Assetabschluss.
- `durations.metadata` hält nur für belegte Serien die Episodendauer in Sekunden
  samt `episode_metadata` und der beim Auftrag geltenden Serienregel.
- Beide bekannten Referenzen bleiben erhalten und werden unabhängig geprüft;
  fehlende Referenzen bleiben `null`. Spätere GUI-Änderungen verändern diese Jobs
  nicht. Film-Matchingtoleranz lockert nicht den Assetabschluss.
- Audio, exakt URL-gebundener Providerbeleg und Dimensionsbeleg behalten ihre
  bestehenden strengen Regeln. Frischer Workerbeleg, Byte-/Exit-/Datei-/Codec-/
  Containerchecks und Probe vor Completed bleiben vorgeschrieben.

v1, v2 und unversionierte gespeicherte Jobs behalten ihren Altvertrag mit dem
zum Abschluss gelesenen dynamischen Serienwert; sie werden nicht umgeschrieben.
Legacy-Links ohne einen neuen Erwartungsblock bleiben kompatibel. Ungültige oder
zukünftige Payloadversionen dürfen nicht als Legacy interpretiert werden.
Retry erhält die gespeicherten Erwartungen bytegleich, nicht alte Probefakten.

## Rollbackgrenze und Abnahme

**Nach dem ersten v3-Job ist ein Image ohne v3-Unterstützung kein sicherer
App-Rollback.** Auch schemafreie Änderungen haben einen Queuevertrag. Vor einem
separat freigegebenen Rollout einen kompatiblen Rückweg sowie aktive/nicht
importierte Jobs abgleichen. Erwartungen nicht löschen/downgraden; keine alte
DB-Sicherung über neue Writes legen. Der ausgewählte SQLite-/PostgreSQL-Provider
bleibt unverändert. Diese Entwicklung autorisiert keinen Produktionsrollout.

`scripts/settings-runtime.test.ts` prüft echte SQLite-/PG-Batches einschließlich
DB-nativem Fehler beim zweiten Write, Rollback-/Cache-Readback und Neustart.
`scripts/media-expectations-runtime.test.ts` prüft v1/v2/v3 über echte Queuewrites,
GUI-NZB-Payloads, Neustart, Retry und einen Settingswechsel beim wartenden Job.
Matcher-, Probe-, Manager-, Bestätigungs- und Responseordnungstests schützen die
negativen Grenzen. PostgreSQL wird im disposable `npm run test:pg`-Harness geprüft,
nicht auf Produktion. Desktopabnahme und Befundstatus stehen im bestehenden
[Review](proxy-retirement-review.md); ausführbarer Status allein im [TODO](../todo/proxy-retirement.md).
