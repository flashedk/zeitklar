# Image im Portainer-Webeditor bauen

Für Docker Standalone. Ein allein hochgeladenes Dockerfile enthält keinen App-Quellcode; `COPY package*.json ./` kann dann keine Dateien finden.

1. Portainer: gewünschte Docker-Umgebung → Images → Build a new image.
2. Image-Name: `zeitklar:local`; Build method: **Web editor**.
3. Den vollständigen Inhalt des Dockerfiles aus diesem Ordner in den Editor kopieren.
4. Über **Select files** die Datei **zeitklar-source.tar.gz** aus diesem Ordner auswählen. Dateiname unverändert lassen. Das Dockerfile entpackt das Archiv über `ADD`.
5. **Build the image** anklicken. Danach den Stack mit `image: zeitklar:local` auf derselben Docker-Umgebung starten.

Das Archiv enthält ausschließlich App-Quellcode, statische Assets, Paketdateien und Build-Konfiguration. Zeitnachweise, Datenbank, `.env`, Tests und `node_modules` sind nicht enthalten.

Das aktuelle Paket enthält die Jahresübersicht mit Diagrammen im Tab **Übersicht** und die Monatsstatistiken im Tab **Monat**. Beide Ansichten verwenden die vorhandenen gespeicherten Daten. Im Kuchendiagramm werden Nacht-, Wochenend- und Feiertagszuschläge aus eigenen Einträgen mit den entsprechenden Zuschlagsarten aus Nachweisen zusammengeführt; die Vergütungssummen bleiben erhalten.

## Bestehende Installation aktualisieren

1. Das Image wie oben mit dem aktuellen Archiv erneut als `zeitklar:local` bauen.
2. Den bestehenden Stack mit diesem Image erneut bereitstellen und dabei den App-Container neu erstellen. Ein bloßer Container-Neustart übernimmt das neu gebaute Image nicht.
3. Das vorhandene Daten-Volume sowie die bisherigen Werte für `ORIGIN` und `APP_PASSWORD` beibehalten.
4. Die App im Browser neu laden. **Übersicht** öffnet die Jahresauswertung; **Monat** öffnet die Monatsansicht. Die Diagramme und Monatszeilen führen direkt zum jeweiligen Monat.

## Quellcodearchiv erzeugen

Nach Quellcodeänderungen im Projektordner erneut erzeugen (Windows PowerShell oder Linux-Terminal mit `tar`):

```sh
tar -czf deploy/portainer/zeitklar-source.tar.gz package.json package-lock.json svelte.config.js vite.config.ts tsconfig.json src static
```

Alternativ das gesamte Projekt auf den Docker-Host kopieren und dort im Projektordner mit dem normalen Dockerfile bauen:

```sh
docker build -t zeitklar:local .
```
