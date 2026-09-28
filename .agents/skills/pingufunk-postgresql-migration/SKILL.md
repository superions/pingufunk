---
name: pingufunk-postgresql-migration
description: Plan, implement or rehearse Pingufunk's mandatory SQLite-to-PostgreSQL migration with semantic data fidelity, secrets and rollback. Use for Pingufunk Prisma and migration work, not for Servarr main/log migration; production cutover remains separately authorized.
---

# Pingufunk PostgreSQL-Migration

PostgreSQL ist Pflichtziel, nicht eine abwägbare Option. Lies AGENTS.md und
vollständig den [kanonischen P11-Vertrag](../../../docs/postgresql-migration-plan.md)
vor der entsprechenden Arbeit. Planen/implementieren erlaubt keine Daten-
migration oder Dienständerung an einer bestehenden Installation.

## Entscheidung und Implementierung

- Tatsächlich gelockte Prisma-Version und Source-/Zielschemas feststellen.
  PostgreSQL-Prisma-Client und native SQL-Kette erzeugen; alte SQLite-Kette
  unverändert als Historie/Recovery erhalten. Kein sqlite-Ledger im PG-Ziel.
- Datenvertrag für alle sechs Modelle anhand realer Spalten/Defaults prüfen:
  IDs/FK/Unique, NULL, BigInt, Zeiten, Config, Queue/History und Stringpayloads
  bewusst Preserve/Normalize/Reject zuordnen. Verlust ist kein stiller Erfolg.
- Typisierte Quelle read-only aus konsistentem Snapshot. UUID/CUIDs und Job-
  Kategorien/Pfade erhalten; keine caches-only Abkürzung oder neue Queue-IDs.
  Native PostgreSQL-Sequences per Schemaownership ermitteln, keine statische
  Servarr-Liste. Sonderfall leerer Tabelle und setval-Rollbackgrenze testen.
- Secret-Datei vor Prisma-Start auflösen; Leere/Widersprüche fail closed,
  URL nie ausgeben. Kein automatischer SQLite-Fallback. Aktuelle SQLite-
  Entrypoint-/CLI-/Defaultannahmen in Image, Devconfig und Tests gemeinsam lösen.
- Externe PostgreSQL-Infrastruktur und vorhandenen HAProxy-Weg erhalten.
  Serverversion/Primary/TLS/Berechtigungen im echten Preflight verifizieren,
  nicht schätzen oder Myoxus-Host-/Poolannahmen kopieren. Einzelworker beibehalten,
  bis ein atomarer Queue-Claim für Replikate separat entwickelt ist.

## Validierung und autorisierter Cutover

Disposable PostgreSQL und synthetische SQLite-Quellen verwenden. Fresh install,
vollständige Übernahme, Datenvergleich, Restart, Secret/DB-Ausfälle, Resume und
Rollback prüfen. Roundtrip-Vergleich der semantischen Daten schützt mehr als
Tabellenname-, Rowcount- oder HTTP-200-Prüfungen; keine Secrets im Bericht.

Für Produktionsausführung zuerst explizite Freigabe und konkrete Zielidentität.
P11-Phasen einhalten: Schreibstopp, Backup/Integrity/FK, Zielaufbau, typisierter
Import, reale Sequences, semantische Validierung, kontrollierter Start und Pause.
Kontrollierter Start bleibt mit getestetem Maintenance-/Writer-Gate read-only;
auch Cache-/Settingswrites würden die Grenze zum veralteten SQLite-Snapshot
überschreiten. Tatsächliche erste Schreiboperation erfassen, nicht nur ein Label.
Kein reset/truncate/fremdes upsert, kein automatischer Appstart bei fehlgeschlagener
Prüfung. Rollen-/DDL-/Sequenceeffekte sind nicht mit dem gesamten Cutover atomar.

Vor neuer PG-Schreibfreigabe kann der unveränderte SQLite-Bestand mit passendem
altem Image zurückkehren. Danach ist er veraltet: Writer stoppen, PG sichern,
Delta-/RPO-Vertrag erfüllen; kein stiller Datenverlust. Spätere Proxy-Routing-
rücknahme soll PostgreSQL beibehalten. Abschluss benennt Sourcehash, Versionen,
Vergleichsergebnis, Restgates und echte vs. nur geplante Commands.
