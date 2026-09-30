---
name: pingufunk-postgresql-migration
description: Plan, implement or rehearse Pingufunk's optional SQLite-to-PostgreSQL migration and dual-backend compatibility with semantic data fidelity, secrets and rollback. Use for Pingufunk Prisma and migration work, not for Servarr main/log migration; production cutover remains separately authorized.
---

# Pingufunk PostgreSQL-Migration

PostgreSQL ist eine explizit wählbare Option; SQLite bleibt unterstützt. Lies AGENTS.md und
vollständig die [PostgreSQL-Fachreferenz](../../../docs/postgresql-migration-plan.md)
und den betroffenen P11-/P10-Vertrag in den
[Phasen-TODOs](../../../todo/proxy-retirement.md) vor der entsprechenden Arbeit.
Planen/implementieren erlaubt keine Daten-
migration oder Dienständerung an einer bestehenden Installation.

## Entscheidung und Implementierung

- Tatsächlich gelockte Prisma-Version und Source-/Zielschemas feststellen.
  Beide Provider mit passenden Clients und eigenen SQL-Ketten unterstützen;
  alte SQLite-Kette unverändert erhalten. Kein SQLite-Ledger im PG-Ziel.
- Datenvertrag für alle sechs Modelle anhand realer Spalten/Defaults prüfen:
  IDs/FK/Unique, NULL, BigInt, Zeiten, Config, Queue/History und Stringpayloads
  bewusst Preserve/Normalize/Reject zuordnen. Verlust ist kein stiller Erfolg.
- Typisierte Quelle read-only aus konsistentem Snapshot. UUID/CUIDs und Job-
  Kategorien/Pfade erhalten; keine caches-only Abkürzung oder neue Queue-IDs.
  Native PostgreSQL-Sequences per Schemaownership ermitteln, keine statische
  Servarr-Liste. Sonderfall leerer Tabelle und setval-Rollbackgrenze testen.
- Secret-Datei vor Prisma-Start auflösen; Leere/Widersprüche fail closed,
  URL nie ausgeben. Provider explizit wählen, niemals bei Verbindungsfehler
  automatisch wechseln. Entrypoint, Image, Devconfig und Tests gemeinsam prüfen.
- Keinen PostgreSQL-Zugriffsweg fest verdrahten. Serverversion, Primary,
  Transport/TLS und Berechtigungen für die konkrete Installation verifizieren,
  nicht schätzen oder fremde Host-/Poolannahmen kopieren. Einzelworker beibehalten,
  bis ein atomarer Queue-Claim für Replikate separat entwickelt ist.

## Validierung und autorisierter Cutover

Disposable PostgreSQL, disposable SQLite und synthetische Quellen verwenden. Fresh install,
vollständige Übernahme, Datenvergleich, Restart, Secret/DB-Ausfälle, Resume und
Rollback prüfen. Roundtrip-Vergleich der semantischen Daten schützt mehr als
Tabellenname-, Rowcount- oder HTTP-200-Prüfungen; keine Secrets im Bericht.

Für Produktionsausführung zuerst explizite Freigabe und konkrete Zielidentität.
Den P10-Freigabevertrag einhalten: Schreibstopp, Backup/Integrity/FK, Zielaufbau, typisierter
Import, reale Sequences, semantische Validierung, kontrollierter Start und Pause.
Kontrollierter Start bleibt mit getestetem Maintenance-/Writer-Gate read-only;
auch Cache-/Settingswrites würden die Grenze zum veralteten SQLite-Snapshot
überschreiten. Tatsächliche erste Schreiboperation erfassen, nicht nur ein Label.
Kein reset/truncate/fremdes upsert, kein automatischer Appstart bei fehlgeschlagener
Prüfung. Rollen-/DDL-/Sequenceeffekte sind nicht mit dem gesamten Cutover atomar.

Vor neuer PG-Schreibfreigabe kann der unveränderte SQLite-Bestand mit passendem
Image zurückkehren. Danach ist er veraltet: Writer stoppen, PG sichern und einen
getesteten, semantisch verlustfreien Rücktransfer verlangen, falls SQLite wieder
aktiv werden soll; keine stille Rückschaltung und kein stiller Datenverlust.
Eine reine Proxy-Routing-Rücknahme soll den gewählten Datenbankprovider nicht
nebenbei ändern. Abschluss benennt Sourcehash, Versionen,
Vergleichsergebnis, Restgates und echte vs. nur geplante Commands.
