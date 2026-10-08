# Frische konkreter Quellenbelege

Entwicklungsvertrag P14.2; Status ausschließlich im
[Phasen-TODO](../todo/proxy-retirement.md). Keine Produktionsfreigabe.

## Getrennte Lebensdauer

Identitätsmetadaten behalten ihren eigenen begrenzten Cache. Positive
Katalogzeilen enthalten veränderliche Medien-URLs und werden bei wiederholter
Suche/RSS neu abgerufen. Ganze RSS-Bodies werden nicht mehr gecacht. Nur ein
erfolgreich vollständig abgefragtes **leeres** Katalogfenster kann maximal
`min(cache.ttl.search, 15)` Sekunden erhalten bleiben; kein Transport-/Budget-
fehler als Nichtfund. Sonarr-RSS hält für seine 60-Sekunden-Paginierung nur
Serien-/Episodenziele, keine Treffer, URLs oder Quellenbelege. Die frische
Abfrage verwendet dieselben Ziele und verschiebt den Cursor erst beim nächsten
vollständigen neuen Ziel-Fenster. Rechte und Sprach-/Qualitätsauswahl laufen
erneut. Request-/Settingsgenerationen bleiben getrennt.

ARD-/ARTE-JSON wird nur in den bestehenden begrenzten Programmowner-Maps
derselben Anfrage wiederverwendet. Ohne belastbaren Assetvalidator wird daraus
kein zeitlicher Cache. Keine neuen Senderseitenparser oder HTML-Abfragen.
Das bedeutet ausdrücklich mehr frische positive Katalog-/JSONabfragen als beim
alten Stunde-RSS-Cache, nicht behauptete Ersparnis auf jedem Provider.

## MP4-Version und Cache

Ein einziges Rangefenster kann die aktuell gelieferten Trackfakten belegen,
auch ohne ETag. Für ein zweites Fenster ist ein starker ETag erforderlich:
`If-Range` verwendet genau diesen Validator; Antwort muss 206, derselbe ETag,
dieselbe Gesamtgröße und ein korrekt begrenzter unkomprimierter Range sein.
Ein 200-Fallback wird vor Lesen des vollen Bodys abgebrochen. Gleiche Größe
allein, schwacher ETag oder fehlender Versionsnachweis ergeben Unknown, keine
zusammengefügten Trackfakten. Ein später Versionskonflikt verwirft **alle**
Fakten, nicht nur die Dimension einer Videospur.

`Last-Modified` wird nicht pauschal zum starken Validator erklärt: die für
solche Datumsvalidatoren nötige belegte Clock-/Änderungsauflösung ist hier nicht
gegeben. Diese konservative Grenze folgt
[RFC 9110, Validatorstärke](https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.2.2)
und [If-Range](https://www.rfc-editor.org/rfc/rfc9110.html#name-if-range).

Zeitlicher MP4-Faktencache: maximal 256 kleine typisierte Einträge,
`min(cache.ttl.search, 300)` Sekunden. Schlüssel hasht **exakte** URL inklusive
Selektoren und Signaturen, Audio-/Dimensionsmodus, Parserversion und den
serverseitigen Provider-/Credential-/DB-/Settingskontext. Neue Fakten erzeugen
keine neue RSS-/NZB-GUID. Jeder zeitliche Treffer verlangt trotzdem ein neues
erstes Rangefenster mit passendem starkem ETag und Gesamtgröße; Rotation,
Expiry oder anderer Kontext laden erneut. Kein Validator/Unknown/Timeout wird
als negativer Beleg gespeichert. Maximal 128 gleichzeitige MP4-Flightkeys;
parallele Caller teilen nur dasselbe exakte Asset/Kontext. Jeder behält seine
eigene Deadline und bezahlt den Range-Versuchszähler vor Verwendung des
Resultats; ein zu kleines/abgelaufenes Budget bekommt keine fremden Fakten.
Invalidierte Generationen publizieren keine neuen Cachefakten.

Worker erhalten keinen zeitlichen MP4-Cachekontext: bestehende frische ARD-/ARTE-
Verifikation und lokale ffprobe-Abschlussprüfung bleiben unverändert. Diese
Entwicklung erhöht weder 32-TV-/10-RSS-Filmversuche noch 15 Sekunden oder vier
1-MiB-Fenster. Nicht belegbare Inhalte bleiben neutral; allgemeine Sprach-
abdeckung ist weiterhin P03.4, kein Ergebnis eines Cachetreffers.

## Reproduzierbare Nachweise

Synthetische Trackfixtures prüfen gleich große Versionsänderung zwischen
Ranges, ignoriertes If-Range, schwache/fehlende Validatoren, getrennte URLs und
Fassungen, Kontextwechsel, Ablauf, Unknown/Timeout→späterer Erfolg sowie
parallele Caller mit eigener Attempt-/Deadlinegrenze. Eine Vierfensterfixture
braucht kalt vier Requests und 3.145.744 Bodybytes; revalidiert ein Request und
1.048.576 Bytes: drei Requests und **2.097.168 Bytes weniger**. Die kleinere
Zweifensterfixture spart einen Request/68 Bytes. Keine gemessene allgemeine
CDN- oder Produktionsperformancebehauptung.

Tatsächliche Newznab/RSS→NZB-Consumerfixture: wiederholte identische Suche
liefert rotierte exakte URL, filtert neu französische Audiofakten gemäß
vorhandener deutscher Policy und verwirft später abgelaufene ARD-Rechte;
Signaturrotation allein verändert die GUID nicht. Das bestehende native
Validationitem bei leerem TV-RSS ist kein Film-/Serientreffer. Keine realen
Grabs, Produktionsdatenbanken oder Medien in diesen Fixtures.
