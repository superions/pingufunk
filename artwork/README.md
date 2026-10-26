# Pingufunk Artwork

Die Bildmarke verbindet einen Pinguinkopf mit einem Schnabel, der in einen
Funkwellenkamm pickt. Orange Funkwellen umfassen den Kopf; die weiße Gesichtsfläche
bleibt auf hellen und dunklen Flächen lesbar.

- **Vektorvorlage:** [pingufunk-mark.svg](pingufunk-mark.svg), `viewBox="0 0 512 512"`.
  Echte editierbare Pfade, transparente Fläche, keine eingebetteten Bitmaps,
  Schriften, Skripte oder externen Ressourcen.
- **Artwork-Entwurf:** [pingufunk-artwork.png](pingufunk-artwork.png), mit dem
  integrierten Imagegen-Werkzeug erzeugt und vom Nutzer als Richtung bestätigt.
  Die SVG-Fassung ist eine von Hand bereinigte Vektorinterpretation dieses Entwurfs.
- **App:** identische SVG unter `public/branding/pingufunk-mark.svg` und der
  bestehenden Assetadresse `public/logo.svg`. `public/logo.png` und
  `public/branding/pingufunk-icon.png` werden aus der SVG-Vorlage rasterisiert;
  alle PNGs behalten Transparenz. Die Appwortmarke verwendet die vorhandene Schrift.

Farben: Dunkelblau `#0C1D34`/`#071529`, Weiß `#FFFFFF`, Signalorange
`#FF6B22`/`#FF551C`, Schnabel `#FF9749`/`#FF6825` und `#C63D1A`.
Bei Änderungen zuerst die Vektorvorlage bearbeiten, dann beide öffentlichen
SVG-Kopien und die PNG-Exporte aktualisieren.

## Generierungsbriefing

Eingesetzter Modus: integriertes Imagegen, transparenter Hintergrund.
Der Entwurf wurde mit folgendem Briefing erzeugt; die endgültige Vektorfassung
enthält keine generierten Rasterdaten:

> A polished original logo symbol for Pingufunk: a stylized penguin head in side
> profile playfully pecking a radio wave crest, with a few integrated radio-wave
> arcs swirling around it. Calm, intelligent, characterful, slightly playful.
> Geometric vector-like shapes, generous negative space, recognition at 32 pixels.
> Dark ink/navy cap, solid white face, warm orange/coral beak and waves, one
> expressive eye. At most three well-spaced wave shapes. Square centered mark,
> transparent background and clear margin. No text, letters, R, mockup, shadow,
> texture, 3D or watermark.

## Markenname und technische Kontinuität

Die sichtbare Produktmarke, UI, Browsermetadaten, Feed-/Capabilitiesnamen,
NZB-Absender, HTTP-User-Agent und Paketname heißen **Pingufunk**.
RundfunkArr bleibt als Ursprung in den Credits und in historischen Referenzen.
Der vollständige zweisprachige README-/Vergleichsauftrag P18.1 bleibt eigenständig offen.

Gespeicherte Releasekennungen, bestehende Qualitätsfragmente, die bisherige
SQLite-Datei `rundfunkarr.db` und historische Migrationsketten behalten ihre
Identität. Ein bloßer Namenswechsel darf keinen neuen leeren Datenbestand,
ungültige NZBs oder Doppelgrabs erzeugen. Historische Katalog-Quelladressen
werden durch Branding nicht auf erfundene neue Endpunkte umgeschrieben.

Die Compose-Beispiele verwenden den Dienstnamen `pingufunk` in Basis und
PostgreSQL-Override. Bestehende Betreiber stoppen den bisherigen Dienst zuerst
mit ihrer alten Compose-Datei, übernehmen die bisherigen Datenmounts und
starten anschließend die neue Konfiguration. Das ist kein automatisches
Deployment oder Datenbankwechsel; vorhandene Dateipfade bleiben bestehen.
