# ARTE-Fassungen: Quellen- und Consumervertrag

Stand 30.09.2026, P07.3-Implementierung; finale Abnahme steht im Phasen-TODO.
Keine produktiven Suchen, Downloads oder APIantworten als Fixtures verwendet.

## Belegte Quellgrenzen

Der [ARTE-Extractor von yt-dlp, versioniert](https://github.com/yt-dlp/yt-dlp/blob/51bab8a0116f4d8004c315706d809782607d5847/yt_dlp/extractor/arte.py)
verwendet die öffentliche Player-Konfiguration `/api/player/v2/config/{locale}/{id}`.
`metadata.providerId` und die offizielle Videoseite verbinden die Fassung mit
einer Video-ID. `metadata.duration.seconds` ist eine Laufzeit in Sekunden.
Der Sprachbeleg gehört zu `streams[].versions[].eStat.ml5`, nicht zur Locale
der Seite oder zu `metadata.language`. Rechteablauf, Geoblocking und Livevideos
sind keine erfolgreichen verfügbaren Episoden.

Die Codeinterpretation ist gegen den
[MediathekView-ARTE-Mapper](https://github.com/mediathekview/MServer/blob/b30c9227482e4afdcfece48f3b593855502a083f/src/main/java/mServer/crawler/sender/arte/ArteRestVideoTypeMapper.java)
geprüft: `VA`/`VOA` enthalten deutschen Ton, `VAAUD` ist deutsche
Audiodeskription. Ein Original mit deutschen Untertiteln belegt keinen deutschen
Ton. Unbekannte Suffixe oder widersprüchliche Codes derselben Medien-URL bleiben
unbelegt. Der Adapter kopiert keinen Quellcode, Token oder Altersbestätigungsheader.

Die [MediathekViewWeb-Suchdefinition](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/SearchEngine.ts)
begrenzt Seiten auf 1.000 Treffer und unterstützt `offset`. Die
[Indexdefinition](https://github.com/mediathekview/mediathekviewweb/blob/5de3e90b53c348de2b510b8b964d7ea1a161f250/server/OpenSearchDefinitions.ts)
deaktiviert den Suchindex der URL-Felder. Deshalb wird eine fehlende deutsche
Fassung über den verifizierten deutschen Titel gesucht und anschließend lokal
auf exakt dieselbe Video-ID geprüft, nicht über eine vermeintliche URL-ID-Suche.
Der Player belegt keine 720p-Qualität: URLs müssen einem eindeutigen indexierten
Rendition-Feld derselben Video-ID entsprechen. Unbekannte Auflösung wird nicht
als neue Releasequalität erfunden; die bestehende Indexfeld-Zuordnung bleibt.

## Implementierter Umfang

`src/services/arte-editions.ts` bearbeitet nur gemeinsame Serien-Topics mit
bereits belegtem Seriennamen/Alias am Titelanfang. Player-ID, offizielle
Website-ID und Serienpräfix werden erneut geprüft. Explizite S/E-Koordinaten
oder Teil/Gesamtzahl müssen zwischen indexiertem Titel und Player-Titel
übereinstimmen. Der vorhandene Regel-/Sonarr-Matcher bleibt für die endgültige
Episode, gewünschte Staffel/Folge und Dauer zuständig. Keine Titel-Allowlist,
kein Movie-ID- oder Produktionsjahrbeleg wird daraus abgeleitet.

TV-ID-Suche, regelgebundene Text-/Koordinatensuche und RSS lösen Fassungen vor
der finalen Sprachselektion auf. Sonarr erhält denselben Adapter und verlangt
für ein generisches ARTE-Topic dessen transiente Video-ID-Provenienz zusätzlich
zum Serienpräfix. Rohfelder der Mediathek-API dürfen diesen Beleg nicht setzen.

Alle neuen Player-/Titel-/Folgeseitenrequests teilen das Suchbudget:
maximal zehn HTTPversuche inklusive Retries, insgesamt höchstens 15 Sekunden.
Player-JSON höchstens 1 MiB, Mediathek-JSON höchstens 8 MiB pro Seite; Fenster
höchstens 5.000 Kandidaten. Transport-/Schema-/Budgetfehler liefern keinen
partiellen Erfolg. Bestätigtes 404/410 oder keine passende Fassung ist kein
Netzausfall. Der Adapter selbst speichert keine signierten URLs oder Ausfälle;
Consumer verwenden die bestehenden kontextgebundenen, begrenzten Positivcaches.
Eine geänderte Serienmetadaten-/Regelidentität darf keine alte Zuordnung erben.

Neue ARTE-Fassungen sind zunächst ausschließlich progressive HTTPS-MP4s aus
bekannten ARTE/CDN-Hosts. Kein Alters- oder Geoblocking-Bypass, keine Anmeldung,
keine neuen Secrets. HLS-Erweiterung und tatsächliche Medienprüfung gehören P09.

## Beweisgrenze

Die Entwicklungsbelege sind synthetische HTTP-/Schema-/Pagination-/RSS-/NZB-
Regressionen. Sie garantieren weder künftige Providerstabilität noch aktuelle
Verfügbarkeit einer realen Serie. Nicht erkennbare Koordinaten, nicht belegte
Serienaliasnamen und nicht indexierte Renditions bleiben absichtlich ohne
Fallbackrelease. Eine geänderte Quelle ist ein Review-/Stop-Gate, kein Anlass
für einen pauschalen deutschen Sprachstempel.
