---
name: pingufunk-container-release
description: Prepare, review or verify Pingufunk OCI releases and inherited GitHub workflows. Use for container release requests; publishing, tag creation and production rollout require their own explicit authorization.
---

# Pingufunk Container-Release

AGENTS.md, Dockerfile, package-lock.json, entrypoint.sh und aktuelle Workflows
lesen. Eigener Fork ist superions/pingufunk, kein Myoxus-Forgejo-/Registrypfad.
Keine Releasewrapper voraussetzen, die dieses Repository nicht besitzt.

## Vorbereitung

- Release-Revision, clean worktree, Version/Tag, Zielregistry, Architekturen und
  Freigabeumfang feststellen. Branch-Push ist kein Image-Publish und Publish
  ist kein Deployment. Kein upstream Push/PR ohne Nutzerauftrag.
- Geerbte Workflows auf Blacksmith-Berechtigung, push/main/tag/schedule-Trigger,
  Registryowner, Rechte und Secrets prüfen. Nur freigegebene Fork-Test-/Build-
  Änderungen vornehmen; Container-Publikation nicht versehentlich aktivieren.
- Buildclient und Migrationsrunner müssen dieselbe Prisma-/Schemaserie tragen.
  Nach P11 PostgreSQL-Entrypoint/-Readiness prüfen; kein verstecktes SQLite-
  Bootstrap oder Debug-Ausgeben der Verbindungs-URL. Native Toolchecks und
  Architektur-/Digestpfad gegen den tatsächlichen Dockerfile abnehmen.
- Tags/Versionsdateien nur mit Veröffentlichungsauftrag ändern. Keine mutable
  latest-Referenz als geprüften Release-Digest ausgeben. Bereits veröffentlichte
  semantische Tags nicht nachträglich auf andere Commits verschieben.

## Autorisierte Veröffentlichung und Fehler

Den tatsächlich vorhandenen geprüften Releaseweg verwenden. Wenn noch keiner
existiert, Vorbereitung/fehlende Gates berichten statt ad-hoc Veröffentlichung
zu erfinden. CI-Fehler aus Logs/Registryzustand diagnostizieren; keine blinden
Retries, keine Secret-Ausgabe, kein semantisches Retagging als Reparatur.
Lokaler Build oder Git-Tag allein ist kein Verfügbarkeitsnachweis.

Ergebnis benennt Version/Commit, CI-Ergebnis, Registryziel, Architekturen und
verifizierte immutable Digests. Produktion bleibt getrennt autorisiert:
bestehende Swarm-/HAProxy-/Secretstruktur und P10/P11-Rollback erfüllen.
Neue Schema-/Datenmigration nie als Nebenwirkung der Releaseprüfung ausführen.
