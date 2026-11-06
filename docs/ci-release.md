# CI und öffentlicher Export

Das eigene Forgejo-Repository ist die Entwicklungsquelle; GitHub enthält den
öffentlichen Quellcode. Themenzweige laufen durch die Forgejo-CI, ohne GitHub
oder GHCR zu verändern. Der Runner verwendet einen Build-Cache und ausschließlich
eigene Testcontainer, synthetische Dateien und temporäre Datenbanken. SQLite und
PostgreSQL sowie die nativen Arr-Fixtures bleiben Teil der Prüfung.

Nach erfolgreichem Lauf eines aktuellen `main`-Commits führt die CI zwei Schritte
aus:

1. Sie überträgt genau diesen Commit per normalem Fast-Forward auf GitHub.
   Ein zwischenzeitlich geänderter Forgejo-Stand oder ein abweichendes öffentliches
   `main` stoppt den Export. Forgejos Push-Spiegelung wird nicht verwendet, da
   sie bestehende öffentliche Historie überschreiben kann.
2. Sie prüft Prüfsumme, Plattform, Quellrevision und Image-ID des im selben Lauf
   getesteten Images und veröffentlicht es als
   `ghcr.io/superions/pingufunk:sha-<voller-commit>` sowie `:main`. Vor dem
   Push prüft die CI, ob das SHA-Tag bereits ein anderes Image bezeichnet; ein
   Konflikt stoppt den Lauf. Diese CI ist der vorgesehene einzige Schreiber.
   Registry-Digest und Image-ID sind verschiedene Kennungen. `main` ist beweglich;
   für einen unveränderlichen Bezug eignet sich der ausgegebene Registry-Digest.

Der GitHub-Deploy-Schlüssel ist auf das öffentliche Repository begrenzt; sein
privater Teil und das GHCR-Paket-Token liegen ausschließlich als Secrets in
Forgejo. Das GHCR-Token benötigt `write:packages`. Zugangsdaten gehören weder in
Git noch in Protokolle. Das Image wird nicht auf dem Mac gebaut. Eine
Veröffentlichung startet keinen Produktivrollout und verändert keine
Sonarr-Einstellungen, Datenbanken oder Medien.
