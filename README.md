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

Der Workflow `.github/workflows/update-publications.yml` läuft standardmäßig täglich um `05:17 UTC` und kann zusätzlich manuell über `Actions → Update publications data → Run workflow` gestartet werden.

Der zentrale Befehl im Workflow ist:

```bash
python fetch_publications.py \
  --orcid-file orcids.txt \
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

## 4. Imperia-Einbindung

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

## 5. Wichtige Konfigurationsoptionen im Widget

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

## 6. Testen

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

## 7. Sicherheit und Grenzen

- Keine vertraulichen oder embargo-behafteten Informationen in das Repository oder die JSON-Datei schreiben.
- Das Widget verwendet `textContent` statt `innerHTML`; Titel, Autoren und Abstracts werden also nicht als HTML ausgeführt.
- URLs werden nur als `http` oder `https` akzeptiert.
- Wenn die Imperia-Seite externe `fetch()`-Ziele per Content-Security-Policy blockiert, muss die Browser-Konsole geprüft werden. Dann ist der typische Fehler `Refused to connect ... because it violates the Content Security Policy directive "connect-src"`.
- GitHub-Actions-Zeitpläne sind nicht sekundengenau garantiert. Für News reicht das normalerweise aus.
