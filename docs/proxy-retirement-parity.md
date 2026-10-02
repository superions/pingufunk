# Native Parität: Owner und Nachweise

Stand: 03.10.2026. Diese Zuordnung ergänzt die Abnahme in
`todo/proxy-retirement.md`; sie ist kein weiterer TODO-Index und keine
Deploymentfreigabe. Die B/O-Nummern bezeichnen das historische Proxyinventar,
nicht den Auftrag, jeden alten Mechanismus unverändert nachzubauen.

| Inventar | Nativer Owner                                         | Kausaler Nachweis / bewusste Grenze                                                                                                                                                                                                        |
| -------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B01      | `services/newznab.ts`, `services/nzb-release.ts`      | `newznab.test.ts`, `nzb-release.test.ts`, `content-search.test.ts`: RSS-Titel und konsumierter NZB-Titel stimmen überein.                                                                                                                  |
| B02      | Newznab-Route, `services/mediathek.ts`                | Route-/Mediathek-Tests: ep/episode, Konflikte, Mehrfachfolgen und Filter vor Counts/Pagination.                                                                                                                                            |
| B03      | `newznab.ts::parseEpisodeFromTitle`                   | Newznab-/ARTE-Tests: explizite internationale Staffel-/Folgenkoordinaten vor Defaultannahmen.                                                                                                                                              |
| B04      | `services/mediathek.ts`, `services/sonarr-matcher.ts` | Mediathek-/Sonarr-Integration: begrenzte Kandidatensuche, danach verifizierte Serien-/Episodenidentität.                                                                                                                                   |
| B05      | `services/arte-editions.ts`, Sprachvertrag            | `arte-consumer.test.ts`, `arte-editions.test.ts`: dieselbe Quellidentität, keine erfundene deutsche Tonspur.                                                                                                                               |
| B06      | `services/ruleset-identity.ts`, Regelgenerator        | Identitäts-/Generator-/Maintenance-Tests: gemeinsame Topics dürfen keine fremde Serie übernehmen; keine Titelliste als Dauerlösung.                                                                                                        |
| B07      | Sprachselektion, `newznab.ts::buildReleaseGuid`       | `content-search.test.ts`: Fassungen vor Limit, ehrliche Folgeseitenfehler, GUIDs mit stabiler Fassung und ohne kurzlebige Signaturen.                                                                                                      |
| B08      | `services/sonarr-provider.ts`, `sonarr-metadata.ts`   | Provider-/Metadaten-Tests: optional, default-off, GET-only, serverseitiges Secret, begrenzter Cache.                                                                                                                                       |
| B09      | `services/sonarr-matcher.ts`, RSS-Suche               | Matcher-/RSS-/Integrationstests: überwachte Episoden, Titelvarianten, Serie und belegte Laufzeit; kein pauschaler Kurzfolgenausschluss.                                                                                                    |
| B10      | Renditionauswahl und Medienworker                     | UI-NZB-/ARTE-Tests und echter Imageharness: HLS bleibt opt-in; progressive/HLS/MKV werden lokal geprüft. Keine Identitäts- oder Sprachbeweiserfindung durch FFprobe.                                                                       |
| B11      | `services/radarr-provider.ts`, Movie-Kontext          | `radarr-provider.test.ts`, `radarr-integration.test.ts`: optionale lokale Radarr-API. Der verworfene öffentliche Metadatendienst wird ausdrücklich nicht nachgebaut.                                                                       |
| B12      | begrenzte Filmtermsuche in `services/mediathek.ts`    | Mediathek-/Radarr-Tests: gemeinsames Budget, Varianten und exakte Schlussprüfung.                                                                                                                                                          |
| B13      | Movie-Matcher und generische Kandidatenausgabe        | Radarr-/Newznab-Tests: identifizierte Filme versus neutrale Kandidaten; kein Umbenennen unsicherer Treffer. Arr entscheidet über Annahme/Override.                                                                                         |
| B14      | `lib/download-paths.ts`, Downloadworker               | Pfad-/Download-Aktionstests und Imageharness: eigene Jobpfade, keine fremden Dateien, echte abgeschlossene Dateien.                                                                                                                        |
| B15      | `services/sab-api.ts`, Downloadpersistenz             | Native SQLite-/PG-Runtime und Imageharness: öffentliche Kategorie, jobisoliertes storage, Restart, Failed/Completed, Remove und Retry mit erhaltenen Erwartungen.                                                                          |
| B16      | direkte Next-Routen, SAB-Owner, Queue-Health          | HTTP-Proxytransport entfällt. Beide SAB-URLs teilen denselben Owner; Fehler-/Maintenance-Tests und Imageprobe prüfen DB-Ausfall statt statischer Version als Health.                                                                       |
| O01      | `lib/db.ts`, providerabhängige Clients/Migrationen    | `npm run test:pg`, SQLite-Runtime, TLS-Import-/Rollback-Container: beide Backends, semantischer Vergleich aller Modelle, Sequences, unveränderte Quelle und getrennter PG-Wartungsrollback. Kein PG→SQLite-Rückweg nach Writes.            |
| O02      | `lib/indexer-url.ts`, beide Newznab-URLs, SAB-Alias   | Newznab-/Radarr-/Indexer-URL-Tests und voller Medienharness: Caps/RSS/Enclosure/NZB, Unterpfade, unverfälschte Kategorien. Reale Arr-Versionen und deren Path Mapping bleiben separate isolierte Integration bzw. private Betriebsabnahme. |

Die Tests liegen bei den jeweiligen Ownern unter `src/`; native DB-Proben unter
`scripts/*runtime.test.ts`. `scripts/media-container-smoke.sh` verarbeitet mit
dem gebauten Image ausschließlich selbst erzeugte Medien auf eigener Loopback-
Quelle, eigener SQLite-Datei und eigener PostgreSQL-Instanz. Beide Newznab-
Adressen erzeugen echte RSS-Enclosures, deren NZB der reale Worker bis zur
geprüften Datei und SAB-History verarbeitet. Ein expliziter Public-URL-Wert
bezeichnet nur die eigene Testloopback-Adresse; keine private Netztopologie
ist eingebaut. Der Preload sperrt alle anderen Fetchziele und akzeptiert nur
die exakte Harness-DB. XML wird mit der gelockten Produktbibliothek im
`npm ci`-Harness geparst: Next bündelt sie, der Runner bietet sie nicht als
separates `require`-Modul an.

## Desktop-Verbraucher

Das tatsächlich servierte Testbundle wurde mit synthetischen Quellen und
einer disposable SQLite-Datei auf 1440×1000 bedient. Acht Routen (`/search`,
`/movies`, `/shows`, `/rulesets`, `/downloads`, `/settings`, `/setup`, `/logs`)
wurden in Light/Dark gegen den isolierten Baseline-Commit `933a304` verglichen:
32 gematchte Bilder; ergänzende Fehler-, Lade-, Dialog- und Speicherzustände.
Pointer und Tastatur prüfen Sucherfolg/Leerzustand/Fehler, genau einen Request
bei wiederholtem Enter, Listenfilter, synthetisches Retry/Remove sowie
Settingssave/Reload/Readback und das Erhalten anderer ungespeicherter Karten.
Setup prüft Pfadsyntax und verhindert Vorschreiten bei fehlgeschlagenem Save.
Secretpräsenz wurde mit einer ignorierten synthetischen Datei geprüft, ohne
ihren Inhalt in API oder DOM auszugeben. `/logs` bleibt der vorhandene
Coming-Soon-Vertrag; ein neuer Logviewer wird nicht behauptet.

Erwartete HTTP-Fehler bei bewusst injizierten Ausfällen sind von unerwarteten
Konsolen-/Hydrationsfehlern getrennt zu beurteilen. Captures mit gemischten
Buildassets oder noch laufender Dialoganimation wurden verworfen/ersetzt.
Die privaten QA-Artefakte verbleiben ignoriert; keine Datenbank, Screenshots,
Medien oder Zugangsdaten gehören ins öffentliche Git. Keine Mobilprüfung.

## Noch getrennt freizugeben

Die oben beschriebene synthetische Paritätsprobe kontaktierte keine echte
Arr-Instanz. Die anschließend genehmigten isolierten Instanzen sind in
`arr-test-instances.md` dokumentiert: tatsächliche Versionen und grundlegende
Verbindungstests belegt, jedoch ein neuer Radarr-Setupbefund bei leerem Filmfeed.
Dieser Setupbefund wurde anschließend auf den dokumentierten Versionen
geschlossen: deaktiviert anlegen, unterstützt per `forceSave` aktivieren;
den leeren Verbindungstest nicht als bestanden darstellen. Native direkte/
vermittelte Suche und manuelle synthetische Release→NZB→SAB→Completed→Import-
Ketten wurden belegt, einschließlich physischer Datei-/Historyidentität und
nativer Quellhistoryentfernung. P10.1 ist erneut abgenommen; automatische
Prowlarr-Application-Synchronisierung ist nicht attestiert. Der anschließende
npm-Sicherheitscheckpoint ist abgeschlossen; beide npm-Audits melden am
03.10.2026 null Befunde. Das ersetzt nicht die installationsbezogene OCI-/Scanpolicy.
Produktionsparameter,
Backup-/Mountrechte und Cutover bleiben P10.2–P10.7, nicht implizit freigegeben.
