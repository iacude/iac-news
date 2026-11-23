# IAC Publications News – GitHub Pages ready

Dieses Repository erzeugt regelmäßig eine statische `publications.json` aus ORCID-Profilen und stellt sie über GitHub Pages bereit. Die Imperia-Seite muss dann nur noch eine JSON-Datei von GitHub Pages laden und daraus die Publikations-News rendern.

## Zielarchitektur

```text
ORCID profiles
  → GitHub Actions, scheduled or manual
  → fetch_publications.py
  → docs/data/publications.json
  → GitHub Pages
  → Imperia page fetches JSON and renders widget in the browser
```

## Dateien

```text
fetch_publications.py                    Python-Skript zum Erzeugen der JSON-Datei
orcids.txt                               ORCID iDs, eine pro Zeile
requirements.txt                         Python-Abhängigkeiten
.github/workflows/update-publications.yml Geplanter GitHub-Actions-Workflow
docs/index.html                          GitHub-Pages-Testseite
docs/publications-widget.css             Widget-CSS
docs/publications-widget.js              Widget-JavaScript
docs/data/publication-media.json         Bildzuordnungen
docs/data/publications.json              Veröffentlichte Publikationsdaten
snippets/imperia-external-assets-snippet.html  Kompakte Imperia-Einbindung
snippets/imperia-inline-widget.html             Platzhalter für vollständige Inline-Einbindung
```

## 1. GitHub-Repository anlegen

1. Neues öffentliches GitHub-Repository erstellen, z. B. `iac-publications-news`.
2. Alle Dateien aus diesem Ordner in das Repository pushen.
3. In `orcids.txt` die gewünschten ORCID iDs pflegen.

## 2. GitHub Pages aktivieren

In GitHub:

```text
Repository → Settings → Pages → Build and deployment
Source: Deploy from a branch
Branch: main
Folder: /docs
Save
```

Die spätere URL hat typischerweise diese Form:

```text
https://USERNAME.github.io/REPOSITORY/
```

Die JSON-Datei liegt dann unter:

```text
https://USERNAME.github.io/REPOSITORY/data/publications.json
```

## 3. Automatische Aktualisierung

Der Workflow `.github/workflows/update-publications.yml` läuft standardmäßig freitags um `05:17 UTC` und kann zusätzlich manuell über `Actions → Update publications data → Run workflow` gestartet werden.

Der zentrale Befehl im Workflow ist:

```bash
python fetch_publications.py \
  --orcid-file orcids.txt \
  --date-overrides publication-date-overrides.json \
  --out docs/data/publications.json \
  --with-details \
  --detail-count 80 \
  --with-crossref \
  --with-pubmed \
  --with-s2 \
  --years-back 2 \
  --years-forward 1 \
  --max-items 80
```

Wenn sich die JSON-Datei geändert hat, committet GitHub Actions sie automatisch zurück ins Repository. Dadurch wird GitHub Pages aktualisiert.

Der Workflow fragt über die DOI das Online-Publikationsdatum bei Crossref ab. Ein tagesgenaues Online-Datum hat Vorrang vor dem ORCID-Datum. Wenn bei beiden Quellen eine genauere Angabe fehlt, bleibt die vorhandene Jahres- oder Monatsangabe erhalten. Für fehlende oder falsche Angaben kann das Datum nach Prüfung auf der Verlagsseite in `publication-date-overrides.json` als DOI mit Datum im Format `YYYY-MM-DD` hinterlegt werden. Diese Korrekturen haben bei jedem Lauf Vorrang.

Das Widget blendet bekannte zukünftige Termine aus. Für die hervorgehobenen Karten kommen nur tagesgenau datierte Publikationen aus den letzten 90 Tagen infrage. Das Zeitfenster lässt sich mit `featuredDays` und die Zahl der Karten mit `featuredCount` einstellen.

## 4. Bilder und Autorenfilter

Die Bildzuordnung steht in `docs/data/publication-media.json`. Der Publikationsworkflow aktualisiert nur `publications.json`. Bildzuordnungen bleiben deshalb beim nächsten Lauf erhalten. Die Porträt-URLs stammen aus den veröffentlichten IAC-Profilen und dem ZWU-Verzeichnis der UDE. Crossref ergänzt fehlende Autorenlisten und Listen mit getrennt gespeicherten Nachnamen und Initialen, wenn die DOI hinterlegt ist.

- Unter `graphicalAbstracts` steht pro kleingeschriebener DOI die Bild-URL. `license` und `licenseUrl` ergänzen den Lizenzhinweis. Mit `alt` lässt sich die Grafik beschreiben.
- Unter `authors` bekommt jede Person einen stabilen Schlüssel. Wenn eine bestätigte ORCID vorliegt, kann sie als Schlüssel dienen. `name` ist der Anzeigename, `aliases` listet bestätigte Schreibweisen und `image` verweist auf die öffentlich publizierte Bilddatei aus Imperia. `profile` dokumentiert die Quelle des Porträts. Falls der Standardausschnitt das Gesicht schlecht trifft, lässt sich der Bildfokus mit `position: [50, 35]` als horizontale und vertikale Prozentangabe anpassen.
- Der Filter berücksichtigt alle verfügbaren Publikationen im Datensatz, bevor `maxItems` angewandt wird. Berücksichtigte Namensvarianten erscheinen als eine Person. Auf den Karten werden bis zu vier vorhandene Porträts gestapelt. Ein Klick auf ein Porträt filtert nach dieser Person oder hebt deren aktiven Filter auf. Alle Namen bleiben sichtbar.
- Die Mediendatei wird standardmäßig neben `publications.json` geladen. Eine andere Quelle kann über `mediaUrl` angegeben werden. Mit `mediaUrl: false` läuft das Widget ohne Bilddatei weiter. Die Filterung nach vorhandenen Autorennamen bleibt verfügbar.

## 5. Imperia-Einbindung

Die kompakte Variante steht in:

```text
snippets/imperia-external-assets-snippet.html
```

Vor dem Einfügen in Imperia müssen `USERNAME` und `REPOSITORY` ersetzt werden:

```html
<div id="pub-news">Loading publications…</div>

<link rel="stylesheet" href="https://USERNAME.github.io/REPOSITORY/publications-widget.css">
<script>
  window.PUBLICATIONS_WIDGET_CONFIG = {
    dataUrl: "https://USERNAME.github.io/REPOSITORY/data/publications.json",
    containerId: "pub-news",
    maxItems: 20,
    featuredCount: 5,
    locale: "en-US",
    language: "en",
    title: "Recent Publications",
    cache: "daily"
  };
</script>
<script src="https://USERNAME.github.io/REPOSITORY/publications-widget.js" defer></script>
```

Falls Imperia externe Skripte blockiert, verwende die Inline-Variante:

```text
snippets/imperia-inline-widget.html
```

Dort die Inhalte aus `docs/publications-widget.css` und `docs/publications-widget.js` direkt einfügen. Die JSON wird weiterhin von GitHub Pages geladen.

## 6. Wichtige Konfigurationsoptionen im Widget

```js
window.PUBLICATIONS_WIDGET_CONFIG = {
  dataUrl: "https://USERNAME.github.io/REPOSITORY/data/publications.json",
  containerId: "pub-news",
  maxItems: 20,
  featuredCount: 5,
  locale: "en-US",
  language: "en",      // "en" oder "de"
  title: "Recent Publications",
  cache: "daily"       // "daily", "hourly" oder false
};
```

## 7. Testen

Lokal ohne Server ist der JSON-Fetch je nach Browser eingeschränkt. Für einen realistischen Test am besten einen kleinen lokalen Server starten:

```bash
python -m http.server 8000 --directory docs
```

Dann öffnen:

```text
http://localhost:8000/
```

Python-Syntax prüfen:

```bash
python -m py_compile fetch_publications.py
```

JavaScript-Syntax prüfen, falls Node.js verfügbar ist:

```bash
node --check docs/publications-widget.js
```

## 8. Sicherheit und Grenzen

- Keine vertraulichen oder embargo-behafteten Informationen in das Repository oder die JSON-Datei schreiben.
- Das Widget verwendet `textContent` statt `innerHTML`; Titel, Autoren und Abstracts werden also nicht als HTML ausgeführt.
- URLs werden nur als `http` oder `https` akzeptiert.
- Wenn die Imperia-Seite externe `fetch()`-Ziele per Content-Security-Policy blockiert, muss die Browser-Konsole geprüft werden. Dann ist der typische Fehler `Refused to connect ... because it violates the Content Security Policy directive "connect-src"`.
- GitHub-Actions-Zeitpläne sind nicht sekundengenau garantiert. Für News reicht das normalerweise aus.
