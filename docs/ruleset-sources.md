# Regelquellen und Serienidentität

Standardmäßig lädt Pingufunk ausschließlich `data/rulesets.json` aus dem
gebauten Checkout/Image. Änderungen werden damit reviewt und mit einer neuen
Imageversion ausgeliefert, nicht bei jedem Start durch Upstream-main ersetzt.
Der Loader meldet intern Quelle (`bundled`/`configured`) und SHA-256 des
normalisierten Regelkatalogs; URLs werden nicht geloggt.

`RULESETS_URL` erlaubt ausdrücklich einen eigenen vollständigen Katalog.
Für reproduzierbare Installationen eine unveränderliche Revision verwenden.
HTTP(S), kein URL-Userinfo, keine Auth-Redirects; Gesamtdeadline 15 Sekunden,
Antwort maximal 8 MiB, Schema-/JSON-Prüfung vor Übernahme. Bei Ausfall oder
ungültiger Antwort gilt wieder der gebündelte Katalog. Erneute Prüfung frühestens
nach einer Stunde; geänderter Inhalt entwertet die Ergebnis-Caches. Generierte
Regeln sind weiterhin eine getrennte lokale Datenbankquelle.

Regel 109 bleibt mit ihrer bisherigen ID erhalten. Ein ARTE-Sammeltopic ist
jedoch kein Beweis für „Occupied“: der gemeinsame Matchingowner verlangt
zusätzlich den belegten Seriennamen oder Alias an der Titelgrenze. Derselbe
Guard gilt für jede Serie in solchen Katalogtopics; keine Serien-Allowlist.
Koordinaten allein reichen nicht. Eine erfolglose Regel entfernt einen
ansonsten zulässigen Kandidaten nicht aus einer neutralen Textsuche. Ein
neutraler Treffer erhält dabei keine TVDB-Identität aus der angefragten Serie.

Auto-Regeln verwenden keine beliebige einzelne Topicantwort mehr als
Identitätsbeweis. Zulässig sind ein exakter Serien-/Aliastopic, dessen
Staffeldekoration oder ein Sammeltopic mit überprüftem Serientitel im Video.
Gemeinsam genutzte Topics verwenden darüber hinaus den kombinierten
`(tvdbId, topic)`-Datenbankschlüssel; Bestandsübergang und Entwicklungsabnahme
stehen in P07.2. ARTE-Fassungsauflösung bleibt
P07.3; eine deutsche Website ist weiterhin kein Tonsprachenbeleg.
