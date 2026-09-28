# Pingufunk: RundfunkArr ohne Kompatibilitätsproxy

## Ziel und Arbeitsweise

Native RundfunkArr-Funktionen sollen den bestehenden externen Proxy schrittweise
ersetzen. GitHub ist die zentrale Ablage; die lokale Arbeitskopie ist ein
separates Codex-Projekt. Bevorzugt werden kleine Änderungen, die auch im
Originalprojekt übernommen werden können. Ein dauerhafter Fork ist nur der
Rückfallweg, falls Upstream Änderungen nicht übernimmt.

- Projektname in Codex und GitHub: `pingufunk`.
- Fork: https://github.com/superions/pingufunk
- Original: https://github.com/rundfunkarr/rundfunkarr
- Ausgangspunkt am 28.09.2026: `a3b02a6e6ad827d6483700480b9bfbcc59a5823c`
- Versionsangabe in `package.json`: `1.3.0`; Node.js mindestens 24.
- Lizenz: MIT; Lizenz und Copyright-Hinweise bleiben erhalten.
- `main` bleibt zunächst unverändert. Einrichtung und Planung liegen auf
  `codex/project-bootstrap`, weitere Fixes auf eigenen Themenbranches.

## Bestand versus aktueller Upstream

Die nachstehenden Fälle stammen aus bisherigen Proxy-Arbeiten. Sie sind
Anforderungen und Reproduktionskandidaten, **keine pauschale Behauptung**, dass
der aktuelle Upstream jeden Fehler noch enthält. Live-Zustand und private
Proxy-Implementierung müssen vor jedem Arbeitspaket erneut gelesen werden;
dieses Dokument verändert keine laufenden Dienste.

Im geklonten Ausgangspunkt geprüft:

- `src/services/shows.ts` bietet lokale/remote `shows.json`, TVDB und TMDB als
  Metadatenquellen, aber noch keinen Sonarr-Metadatenanbieter.
- `prisma/schema.prisma` verwendet SQLite. Die PostgreSQL-Migration der
  Servarr-Anwendungen ist ein anderes Projekt, nicht Voraussetzung dieses Forks.
- Upstream hat mit dem Ausgangscommit bereits einen ORF-HLS-Fix für getrennte
  Video-/Audiospuren übernommen (PR #40). Unsere bisherige pauschale HLS-Sperre
  darf deshalb nicht ungeprüft zur nativen Dauerlösung werden.
- Downloadmanager und Matching haben bereits Tests. Neue Regressionen werden
  dort integriert, nicht als zweiter Proxy neben der Anwendung implementiert.
- Die GitHub-Workflows verwenden Blacksmith-Runner. Die Container-Pipeline
  veröffentlicht Images; Runner-Verfügbarkeit und Fork-Publishing müssen
  separat vorbereitet werden. In dieser Einrichtung werden keine Images gebaut
  oder veröffentlicht und keine Release-Tags erstellt.

## Arbeitspakete und Abnahme

| Reihenfolge | Paket                               | Mindestabnahme                                                                                                                                                                                |
| ----------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1           | Regressionen und Lückenanalyse      | Sanitisiertes Fallinventar; jeden Fall gegen aktuellen Upstream testen; bereits behobene Fehler kennzeichnen.                                                                                 |
| 2           | Optionaler Sonarr-Metadatenanbieter | TVDB-ID sowie Staffel/Folge aus Sonarr auflösen; ohne persönlichen TVDB-/TMDB-Account; API-Key oder Secret-Datei, Timeout, Cache, Fehler- und Mehrinstanzentests.                             |
| 3           | Sichere Episodensuche               | Titelbasierte Suche auch für Jahresstaffeln; exakte Serienzuordnung; deutsche Titelvarianten, Mehrfachfolgen und korrektes Newznab-/NZB-Naming; keine Trailer oder falschen Episoden.         |
| 4           | ARTE und Sprache                    | Staffel aus realem Quelltitel; deutsche Quelle/Sprache zuverlässig wählen; Ruleset-Kollisionen und fremdsprachige GUID-Dubletten testen; keine Titel-spezifischen Dauer-Allowlists.           |
| 5           | Radarr-Filmsuche                    | Optionale lokale Radarr-Metadaten statt neuer externer Accounts bevorzugen; deutsche/originale Titel, Jahr und IDs prüfen; Clips und Audiodeskription nicht als Hauptfilm liefern.            |
| 6           | Download und Import                 | Eindeutige Job-Unterordner, stabile Queue-/History-Kategorien und Mehrfachfolgen; progressive Quellen sowie HLS inklusive Audio prüfen; keine fertigen Downloads als kurze Samples markieren. |
| 7           | Vergleich und Proxy-Ablösung        | Isolierter Testbetrieb, dokumentierte Funktionsparität, geprüftes Image mit festem Digest und ausdrücklich freigegebener Produktionswechsel.                                                  |

Arbeitspaket 2 braucht weiterhin den **lokalen Sonarr-API-Key**, aber keinen
zusätzlichen persönlichen Account bei TVDB/TMDB. Der Schlüssel gehört nicht
ins Git. Eine Integration darf keine Serien ändern, Downloads auslösen oder
Bibliotheksinformationen nach außen übertragen.

Die frühere SQLite/NFS-Queue-Problematik wird separat reproduziert, bevor
Parallelitäts- oder Datenbankänderungen geplant werden. Keine pauschale
PostgreSQL-Umstellung von RundfunkArr im Rahmen der Projekteinrichtung.

## Regressionsfälle

- Tatort: Jahresstaffel mit genau angefragter Folge, zusammengesetzte
  Episodentitel, Titelpräfix/Jahreszusatz; Titel nur mit eindeutiger Serienbindung.
- ARTE: echte zweite Staffel, deutsches statt französischem Angebot;
  fremdsprachiger Eintrag darf nicht das deutsche Duplikat verdrängen.
- Topic-Kollisionen: „All the Sins“ darf nicht durch eine allgemeine ARTE-Regel
  einem anderen Serien-Identifier zugeordnet werden.
- Mehrfachfolgen: `S07E12E13` bleibt korrekt als beide Episoden erkennbar.
- Filme: englischer Suchname und deutscher Mediathektitel, beispielsweise
  „The Door-to-Door Bookstore“ / „Der Buchspazierer“; Jahr und Filmlänge prüfen.
- Quellen: Trailer, Audiodeskription und andere Sprach-/Barrierefreiheitsvarianten
  dürfen nicht unbemerkt als gewünschte Hauptfassung ausgegeben werden.
- HLS: ORF-Master mit getrennter Audiospur; beide Streams, Laufzeit, Abbruch und
  Cleanup prüfen. Ein erfolgreicher HTTP-Transfer allein ist keine Abnahme.
- Import: gleichzeitige Jobs gleicher Kategorie, sichere Pfade, Wiederholungen,
  Kategorien in Queue/History und Completed-Download-Handling.

Alle automatisierten Fixtures sind synthetisch oder öffentlich und enthalten
keine Schlüssel, privaten Hosts, Bibliotheksdaten oder echten Download-Jobs.

## Entwicklungsablauf

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
git switch -c codex/<thema>
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Vor dem Synchronisieren von `main` Fork-CI prüfen: ein Push kann die bestehende
Container-Pipeline auslösen. Nicht blind ausführen, solange Runner und
Publishing nicht für den Fork eingerichtet sind. Kein Force-Push und kein
Überschreiben vorhandener Arbeit. Pro Änderung erst Regression reproduzieren,
danach Fix und Tests, dann Review; Upstream-PRs nur nach Nutzerauftrag.

## Produktionswechsel und Rollback — noch nicht freigegeben

1. Proxy-Verhalten vollständig erfassen und Anforderungen abgleichen.
2. Tests mit Mocks; anschließend separat freigegebener isolierter Integrations-
   betrieb mit eigenen Daten/Verzeichnissen und ohne automatische Grabs.
3. Vor dem Wechsel Konfiguration, Routing und bestehendes Image/Digest sichern;
   neues Image gemäß Homelab-Sicherheitsrichtlinie prüfen.
4. Erst nach ausdrücklicher Freigabe Routing/Indexer direkt auf RundfunkArr
   umstellen. Bestehende Architektur, Secrets, Volumes und GitOps beibehalten.
5. Sonarr/Radarr-Suche, gewünschte Sprache, vollständige Streams, Queue/History
   und Import prüfen. Bei Abweichung altes Routing über den erhaltenen Proxy
   wiederherstellen. Datenbank-/Schemaänderungen benötigen eigenen Backup- und
   Rollbackplan; keine alte Version blind auf ein geändertes Schema starten.
6. Proxy erst nach erfolgreicher Abnahme und gesonderter Freigabe entfernen.

## Status der Einrichtung

Fork und Arbeitskopie sind eingerichtet; Anwendungscode ist unverändert.
Lokale Baseline am 28.09.2026 mit Node.js 24.15.0 und npm 11.12.1:
`npm ci`, alle 171 Tests in 19 Testdateien, Lint, Typecheck, Formatprüfung und
Production-Build erfolgreich. Der Build ist keine Bereitstellung; es wurde
kein Anwendungsserver gestartet und keine Produktionsdatenbank verwendet.
`AGENTS.md` hält Scope, Tests und Sicherheitsgrenzen für weitere Codex-Arbeit
fest. Die Registrierung des lokalen Ordners als Codex-Projekt erfolgt über
„Projekt hinzufügen“ in der App; sie ist keine Produktionsbereitstellung.
