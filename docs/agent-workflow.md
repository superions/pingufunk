# Projektregeln und angepasste Myoxus-Skills

Stand: 28.09.2026. Die Repository-[AGENTS.md](../AGENTS.md) ist der zentrale
Einstieg. Wiederverwendbare Arbeitsabläufe liegen projektlokal in
.agents/skills/ und sind auf Pingufunk zugeschnitten, nicht global installiert.

## Übernommene Prinzipien

Aus der aktuellen Myoxus-AGENTS.md übernommen und neu formuliert: klare
Code-Ownership, serverseitige Autorität, geschützte persistierte Verträge,
append-only Migrationen, isolierte Tests, Regressionen mit tatsächlichem
Fehlersignal, Evidenzwiederverwendung, Verifikation des tatsächlich ausgelieferten
Bundles, Desktop-only UI-Prüfung, lokale Inline-Verträge, sichere Prozess-
behandlung, Review vor Abschluss und regelmäßige kohärente Git-Checkpoints.
Genehmigte Planverträge dürfen nicht im Implementierungsmodus abgeschwächt werden.

PostgreSQL ist zusätzlich eine ausdrückliche Pingufunk-Nutzerentscheidung;
Myoxus' SQLx-Migrationssystem oder Runtime-Stack ist dafür keine Vorlage.
Technische Referenz: [PostgreSQL](postgresql-migration-plan.md). Die Ausführung
gehört ausschließlich zu P11/P10 der [Phasen-TODOs](../todo/proxy-retirement.md).

## Auswahl und Anpassung der Skills

| Quelle in Myoxus                                                         | Projektlokaler Skill                                                                            | Bewusste Anpassung                                                                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| myoxus-test-gates; Qualitäts-/Cleanup-Grundsätze aus myoxus-test-cleanup | [pingufunk-test-gates](../.agents/skills/pingufunk-test-gates/SKILL.md)                         | npm/Vitest/ESLint/TypeScript/Next statt Yarn-, Cargo- und Matrixwrapper; keine implizite Testlöschung                    |
| myoxus-dev-runtime                                                       | [pingufunk-dev-runtime](../.agents/skills/pingufunk-dev-runtime/SKILL.md)                       | Next/Container/Servarr-Verträge, Zustandserhebung read-only; keine Myoxus-Hosts, Ports oder Scripts                      |
| myoxus-visual-qa                                                         | [pingufunk-visual-qa](../.agents/skills/pingufunk-visual-qa/SKILL.md)                           | Tatsächliche Pingufunk-Routen und Desktopzustände; keine Editor-, Mantine-/Facade- oder Dokumentmutationsregeln          |
| myoxus-dependency-review                                                 | [pingufunk-dependency-review](../.agents/skills/pingufunk-dependency-review/SKILL.md)           | package-lock/Prisma/Next/native Medienwerkzeuge; keine Rust-/Electron-/Branding-Annahmen                                 |
| myoxus-container-release                                                 | [pingufunk-container-release](../.agents/skills/pingufunk-container-release/SKILL.md)           | Eigener GitHub-Fork und überprüfte OCI-Workflows; keine Forgejo-Orchestrierung oder festverdrahtete Registry             |
| inline-doc                                                               | [pingufunk-inline-doc](../.agents/skills/pingufunk-inline-doc/SKILL.md)                         | TS/TSX, Shell und Prisma-/SQL-Verträge, English comments; keine Rust/Oxlint-Kommandos                                    |
| myoxus-import-export-fidelity                                            | [pingufunk-postgresql-migration](../.agents/skills/pingufunk-postgresql-migration/SKILL.md)     | Semantische Preserve/Normalize/Reject-Matrix für SQLite→PostgreSQL, BigInt/Zeiten/IDs und Rollback statt Dokumentformate |
| myoxus-agentic-todo-authoring                                            | [pingufunk-agentic-todo-authoring](../.agents/skills/pingufunk-agentic-todo-authoring/SKILL.md) | Ein deutscher, codeverankerter Phasenvertrag; keine Myoxus-Frameworks, Metaindizes oder Done-Archive                     |

Quell-SKILL.md-Dateien und ihre einschlägigen Referenzen wurden vor der
Anpassung vollständig gelesen. Übernommen sind Arbeitsprinzipien, keine rohe
Kopie privater Betriebsdokumente, Quelltexte oder Test-/Releasewrapper.
Alle acht Skills sind kurz und eigenständig; fachliche DB-Referenz liegt
im Migrationsplan, ausführbare Arbeit nur in den Phasen-TODOs. Links werden relativ zum jeweiligen Skill
aufgelöst. Neue Skills ändern keine Freigabegrenzen.

## Bewusst nicht übernommen

- Myoxus-Entwicklungshosts, SSH-Benutzer, absolute Pfade, private Endpunkte,
  Profile, Datenbank-/Registry-Zugangsdaten und öffentliche Mirror-Regeln.
- Rust/SQLx/GraphQL, Yarn/Cargo-Wrappers, Mantine/Facade, Virgultum, Editor-
  Snapshots, Browser-Workspace-Verbote, Monetarisierungs-/Branding-Vorgaben.
- Forgejo-Token-, Host-Handoff-, Housekeeping-, i18n-Codegen-, Editor-Debug-
  und Rust-Slice-Skills ohne passendes Pingufunk-Subsystem.
- Myoxus-TODO-/Done-Archive und server/client-Dokumentationsverbote. Pingufunk
  behält CONTRIBUTING.md. Die ausdrücklich beauftragten Phasen-TODOs haben
  genau einen aktiven Vertrag unter todo/, keine fremde Archivhierarchie.
- Ungeprüfte Cleanup-/Deploy-/Release-Kommandos und Skripte, die hier nicht
  existieren. Kein neuer globaler Skill-Cache, keine automatischen Jobs.

## Validierung und Grenzen

SKILL.md besitzt jeweils name/description-Frontmatter und ein passendes
agents/openai.yaml mit Projektname und konkretem Skill-Aufruf. Prüfen:
Frontmatter/Namen, relative Ressourcenlinks, AGENTS-Routing, Metadaten sowie
Abwesenheit privater Hosts, alter Myoxus-Kommandos und Scaffold-Platzhalter.
Die Prüfungen validieren Struktur und Konsistenz, keine bereits implementierte
PostgreSQL-Unterstützung oder produktive Einsatzbereitschaft.

Bei zukünftigen Änderungen vorhandene Skill-Checks und beobachtetes Verhalten
nutzen; keine Wortlaut-/Header-Tests als Ersatz für fachliche Regressionen.
Eine unabhängige Evaluation ist nur mit autorisierter Delegation sinnvoll.
