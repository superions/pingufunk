# Native Medienwerkzeuge im Container

FFmpeg und ffprobe gehören zum normalen Pingufunk-Appimage. Es gibt keinen
zusätzlichen YouTube-Dienst. Der Docker-Build erzeugt ein eigenes Alpine-Paket
aus FFmpeg 9.0.2, Tag-Commit `946fcce07b6dcd0331c8cc609192aeff5e1924f8`.
Quelle, SHA-512, Buildoptionen, Paketversion und Lizenz sind in
[`docker/media-tools/APKBUILD`](../docker/media-tools/APKBUILD) festgehalten.
Das Paket bleibt im APK-Inventar sichtbar; ein Scanner darf den selbst gebauten
Medientoolanteil nicht als entfernte oder unbekannte Software behandeln.

Die App kopiert/remuxt lokale Video-/Audiospuren und prüft Container, Codecs,
Auflösung, Sprachen und Laufzeit. yt-dlp kann HTTP(S)/HLS verwenden. Diese
Funktionen sowie die bisherigen eingebauten Codecs, Demuxer, Muxer und Filter
bleiben vorhanden. Extern benötigt werden OpenSSL und x264; x264 erzeugt auch
die synthetischen Medien der nativen Verbraucherprüfungen. Nicht benötigt sind
Geräteaufnahme/-ausgabe, Desktopwiedergabe oder RTSP/RTP/SDP. Automatische
Erkennung weiterer Bibliotheken ist deaktiviert. Die bisherigen APK-Abhängigkeiten
für ALSA, PulseAudio/GLib und RIST/cJSON werden dadurch nicht mehr mitgeführt.
Der Healthcheck verwendet das vorhandene Curl; GNU Wget entfällt.

CVE-2026-107696 betrifft RTSP-Redirects bis einschließlich FFmpeg 9.0.2.
Die entsprechende Ein-/Ausgabefamilie ist ausdrücklich aus dem Build entfernt.
Der Paketcheck verlangt ihre Abwesenheit in den tatsächlichen Toollisten.
Ein grober Scanner-Versionsbereich kann den Befund weiter melden; Reports
bleiben vollständig, ohne CVE-Ignore oder vorgetäuschtes Versionsupgrade.
Andere Befunde müssen anhand der tatsächlichen Version und Reichweite geprüft
werden. Ein erfolgreicher Build ersetzt keinen frischen Image-Scan.

Das Buildpaket enthält die GPLv3-Lizenz und FFmpegs Lizenzbeschreibung.
Der unveränderte vollständige Quellstand ist unter der im APKBUILD fixierten
Upstreamadresse verfügbar; die paketbezogenen Buildanweisungen gehören zu
diesem Repository. Buildsignaturschlüssel gelangen nicht ins Runtimeimage.

Die Container-CI prüft Medienabschluss, gemuxte YouTube-Spuren, HLS, Sprach- und
Qualitätsablehnungen, echte synthetische Sonarr-/Radarr-Imports und beide
unterstützten Backends. Nach allen Gates exportiert der Pushlauf genau das
getestete Linux/amd64-Image samt Konfigurations-ID, Quellrevision und Archivhash
für drei Tage als CI-Artefakt. Das ist keine Registryveröffentlichung und kein
Deployment. Ein autorisierter lokaler Rollout prüft dieses genaue Archiv,
verteilt es mit eindeutiger unveränderter Identität und verwendet den bestehenden
Controller. Datenbankschema und Migrationsrunner ändern sich dadurch nicht.
