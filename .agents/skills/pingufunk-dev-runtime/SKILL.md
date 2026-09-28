---
name: pingufunk-dev-runtime
description: Diagnose Pingufunk development runtimes, stale served bundles, container state and owned hanging processes. Use for runtime troubleshooting; does not authorize production restarts, live library grabs, database migration or Docker cleanup.
---

# Pingufunk Runtime-Diagnose

Vor Änderungen Zustand prüfen, nicht aus einem Git-Push einen aktualisierten
Dienst ableiten. AGENTS.md, aktuellen Plan und tatsächliche Start-/Container-
Konfiguration lesen. Keine Myoxus-Hosts, Ports oder Stackwrapper voraussetzen.

## Workflow

- Checkout/Branch/Remotes, dirty work, Node/npm, gestartete Prozesse und das
  betroffene Laufzeitprofil erfassen. Lokales Next-dev, Container und isolierter
  Testbetrieb sind unterschiedliche Ziele; Produktion nicht als Testinstanz nutzen.
- Tatsächlich gelieferte UI/API, Image-Digest/Revision und begrenzte Logs prüfen.
  Eine Version-Antwort beweist weder DB-Readiness noch Matching-/Importparität.
  Keine vollständigen environment-/docker-inspect-Blöcke mit Secrets ausgeben.
- Ein Diagnoseauftrag erlaubt lesende Diagnose. Neustart/Rebuild/Deploy nur
  innerhalb der ausdrücklich autorisierten Instanz und Operation. Vor Aufruf
  vorhandenen Command auf eigene Health-/Smokeprüfungen lesen; gültige Evidenz
  nicht ohne geänderten relevanten Input wiederholen.
- Bei Hängern PID/Eltern/Kinder, Command-Owner, Laufzeit, Ressourcen und letzte
  Ausgabe ermitteln. Nur zu diesem Lauf gehörende Prozesse gezielt beenden,
  TERM vor KILL. Keine kill-by-name-Aktionen auf gemeinsamen Hosts.
- Root cause an Source, Runtimeconfig, Testharness oder Ressourcen lokalisieren.
  Nicht gleichzeitig Pool, Workerzahl und Timeout hochsetzen. PostgreSQL löst
  keine in-process Queue-Races; neue Repliken brauchen einen eigenen Claim-Vertrag.
- Download-/DB-/Historyzustand erhalten. Keine Datenbankreinitialisierung,
  Proxy-Abschaltung oder Docker-Prunes als beiläufige Reparatur. Bei Kapazitäts-
  problemen erst belegte eigene Kandidaten nennen und benötigte Freigabe klären.

## Ergebnis

Causal evidence, tatsächliche served revision, autorisierte Änderungen und
verbleibende Unsicherheit berichten. Diagnose vs. Fix vs. Deployment getrennt
benennen; ein alter laufender Bundle nach Sourceänderung ist kein erfolgreich
verifizierter Produktfix. Keine Zugangsdaten oder private Infrastruktur ins Git.
