# Entwicklung und Repository-Inhalte

Node.js 24 oder neuer verwenden. Nach dem Klonen die Abhängigkeiten mit `npm ci` installieren.

Vor einem Pull Request dieselben Prüfungen wie in der CI ausführen:

```sh
npm run format:check
npm run check
npm run check:browser
npm test
npm run build
npm run build:browser
```

Mit `npm run format` lässt sich der Quellcode formatieren.

## Was ins Repository gehört

Quellcode, Tests mit anonymisierten Nachweisen, Build-Konfiguration, `package-lock.json`, Dokumentation und die fiktiven Demodaten samt README-Screenshots gehören ins Repository. Das Lockfile ermöglicht reproduzierbare Installationen mit `npm ci`.

`node_modules/`, `.svelte-kit/`, `build/`, `dist-browser/`, `tmp/` und das Portainer-Quellcodearchiv sind lokale oder erzeugte Dateien. Das Archiv lässt sich nach der [Portainer-Anleitung](deploy/portainer/README.md) neu erstellen.

`data/`, Datenbankdateien, persönliche Nachweise, Sicherungsexporte und `.env`-Dateien mit Zugangsdaten dürfen nicht eingecheckt werden. Neue Testdaten vor dem Hinzufügen anonymisieren; für öffentliche Vorschauen die [fiktiven Demodaten](docs/demo/README.md) verwenden. `.env.example` enthält ausschließlich Beispielwerte und gehört ins Repository.
