# Fiktive Demodaten und README-Screenshots

`zeitklar-demo.json` ist eine frei veröffentlichbare Zeitklar-Sicherung mit vollständig erfundenen Daten. Sie wird ohne Zugriff auf `data/`, SQLite-Datenbanken, vorhandene Sicherungen oder Testnachweise erzeugt. Es gibt keine Namen, Personalnummern, Kliniknamen oder anderen Identitätsdaten.

Die Demo enthält neun Monatsnachweise für Januar bis September 2026, ein Beispielprofil (Ä 1, Stufe 3, Nordrhein-Westfalen), Regel- und Spätdienste, Wochenenddienste sowie Bereitschaftsdienste mit Auszahlung oder Freizeitausgleich. August enthält fünf Urlaubstage, September zwei Urlaubstage und drei Krankheitstage. Die vorherigen Monate liefern die Referenzen für die Entgeltfortzahlung. Zwei eigene Zeitaufzeichnungen zeigen einen passenden Tag und eine absichtliche Abweichung von 15 Minuten am 22. September. Auszahlungen sind offen, damit die Kontrolle pro Position sichtbar bleibt.

## Demo ansehen

```sh
npm ci
npm run dev:browser
```

1. Die Browser-Version unter **http://127.0.0.1:5175** in einem neuen Browserprofil oder einem privaten Fenster öffnen.
2. Über **Sicherung einlesen** die Datei [`zeitklar-demo.json`](zeitklar-demo.json) auswählen.
3. September 2026 auswählen und Übersicht, Monat, Kalender oder Abgleich öffnen.

Ein eigener leerer Browser-Arbeitsbereich hält die Demo getrennt von persönlichen Aufzeichnungen. Der Sicherungsimport ergänzt Daten und ist kein Austausch des vorhandenen Bestands. Die Docker-Version bietet derzeit keinen JSON-Wiederimport.

## Demodaten neu erzeugen

```sh
npm run demo:generate
```

Das Skript [`generate-demo.ts`](../../scripts/generate-demo.ts) verwendet feste Daten und Zeitstempel. Es validiert Profil und Nachweise mit den App-Funktionen und prüft alle Arbeitgeber-Stundenrechnungen. Derselbe Quellstand erzeugt dieselbe JSON-Datei. Geschrieben wird ausschließlich `docs/demo/zeitklar-demo.json`; vorhandene App-Daten werden nicht eingelesen.

## Screenshots neu aufnehmen

Das optionale Aufnahmeskript benötigt Playwright und dessen Browser. Diese Werkzeuge werden für den normalen Betrieb der App nicht benötigt.

```sh
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run demo:generate
npm run dev:browser
```

Während der lokale Entwicklungsserver läuft, in einem zweiten Terminal ausführen:

```sh
npm run demo:screenshots
```

[`capture-demo.mjs`](../../scripts/capture-demo.mjs) startet einen separaten Browserkontext, importiert ausschließlich die Demo-Sicherung über die App-Oberfläche und prüft den importierten Datenbestand sowie Browser-Laufzeitfehler. Es speichert fünf PNG-Dateien in `docs/screenshots/`: Jahresübersicht, Monatsübersicht, Kalender, Stundenabgleich und Vergütung. Ausschnitte werden direkt bei der Aufnahme gewählt; die dargestellten Werte und Status stammen aus der App.

Standard: 1440 Pixel Breite, Deutsch, Zeitzone Europe/Berlin, heller Modus. Für einen anderen lokalen Port `DEMO_BASE_URL` setzen, zum Beispiel `http://127.0.0.1:5186`. Optional verwendet `DEMO_BROWSER_CHANNEL=msedge` einen bereits installierten Edge-Browser. Das Skript akzeptiert ausschließlich lokale Server und verwendet keine vorhandenen Browserprofile.

Die JSON-Datei und die fünf PNGs gehören zusammen mit der README ins Repository. Private Datenverzeichnisse und temporäre Screenshots gehören nicht zu diesem Demo-Paket.
