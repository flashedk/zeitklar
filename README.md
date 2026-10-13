# Zeitklar

Private Webapp zur Kontrolle von Zeitnachweisen nach TV-Ärzte/TdL. Svelte 5 / SvelteKit, Node.js 24 und SQLite. Kein Cloudkonto, keine externen Analyse- oder KI-Dienste. Wahlweise Verarbeitung auf dem eigenen Docker-Server oder vollständig lokal im Browser mit einer statisch hostbaren Version.

## Vorschau

Die Screenshots zeigen die lokale Browser-Version mit **vollständig erfundenen Demodaten** für Januar bis September 2026. Alle Dienstzeiten, Abwesenheiten und Kontostände sind synthetisch; die angezeigten Eurobeträge berechnet die App daraus. Es werden keine persönlichen Zeitnachweise oder Beschäftigtendaten verwendet.

![Jahresübersicht mit Zeitkonto, monatlicher Zusatzvergütung und deren Zusammensetzung – fiktive Demodaten](docs/screenshots/jahresuebersicht.png)

<details>
<summary>Monatsübersicht: Arbeitszeit, Dienste, Urlaub und Krankheit</summary>

Die Kennzahlen für den fiktiven September 2026 auf einen Blick.

![Monatsübersicht September 2026 mit Arbeitszeit, Zeitkonto und Abwesenheiten – fiktive Demodaten](docs/screenshots/monatsuebersicht.png)

</details>

<details>
<summary>Kalender: Dienstplan und eigene Zeiten</summary>

Regeldienste, Spätdienste und Bereitschaftsdienste im Monatskalender. Am 22. September zeigt das Beispiel eine Abweichung von 15 Minuten zwischen Nachweis und eigener Aufzeichnung.

![Monatskalender mit Dienstblöcken, Urlaub, Krankheit und eigener Zeitaufzeichnung – fiktive Demodaten](docs/screenshots/kalender.png)

</details>

<details>
<summary>Stundenabgleich: Summen, Zeitkonto und Rechenwege</summary>

Die App vergleicht Tageswerte, Monatssummen und Kontobewegungen. Die Stundenprüfungen des fiktiven Nachweises sind rechnerisch stimmig; der Abgleich der eigenen Zeit und die Auszahlungskontrolle bleiben separat.

![Prüftabelle mit Stundenrechnungen und Status je Position – fiktive Demodaten](docs/screenshots/stundenabgleich.png)

</details>

<details>
<summary>Vergütung: Zuschläge und Auszahlungskontrolle</summary>

Zuschläge, bezahlte Bereitschaftsdienste sowie Entgeltfortzahlung für Krankheit und Urlaub mit einer eigenen Auszahlungskontrolle pro Position.

![Vergütungstabelle mit Stunden, Satz, Bruttobetrag und Auszahlungskontrolle – fiktive Demodaten](docs/screenshots/verguetung.png)

</details>

Zum Ausprobieren: [fiktive Demo-Sicherung](docs/demo/zeitklar-demo.json) und [Anleitung zum Import und Erstellen neuer Screenshots](docs/demo/README.md). Die Demodaten werden ausschließlich durch ein separates Skript erzeugt und über „Sicherung einlesen“ in einen leeren Browser-Arbeitsbereich importiert.

## Start mit Docker

```sh
docker compose up -d --build
```

Dann **http://localhost:3000** öffnen. SQLite liegt dauerhaft im Docker-Volume `zeitklar-data`. `docker compose down` erhält die Daten; `docker compose down -v` löscht sie.

Optional `.env.example` nach `.env` kopieren und `APP_PASSWORD` setzen. Benutzername: `zeitklar`. Für Zugriff außerhalb des lokalen Rechners einen HTTPS-Reverse-Proxy vorschalten, `ORIGIN` auf die tatsächliche URL setzen, `ADDRESS_HEADER=X-Forwarded-For` (bei genau einem Proxy) bzw. `XFF_DEPTH` setzen, damit die Sperre nach zehn falschen Passwörtern pro Minute die echte Client-Adresse verwendet und die Portbindung gezielt anpassen. Standardmäßig lauscht die veröffentlichte Docker-Portbindung nur auf `127.0.0.1`. Ohne Passwort ist die App für alle erreichbar, die Zugriff auf diesen Port haben. Ein Benutzer, kein Mehrbenutzerbetrieb.

## Ablauf

Für den Image-Build direkt im Portainer-Webeditor gibt es ein eigenes Dockerfile und Quellcodearchiv: [Portainer-Anleitung](deploy/portainer/README.md). Das normale Dockerfile benötigt den vollständigen Projektordner als Build-Kontext.

1. **Einstellungen**: Entgeltgruppe, Entgeltstufe und optional das Datum des nächsten Stufenaufstiegs auswählen. Das individuelle Stundenentgelt wird im Tabellenmodus automatisch aus der für den Dienstmonat geltenden TdL-Tabelle berechnet; die Überstunden-Grundvergütung ist auf Stufe 4 begrenzt, die Zuschlagsbasis bleibt Stufe 3. Wochenverteilung und Bundesland des Arbeitsorts ergänzen. Gesetzliche Feiertage werden für das jeweilige Jahr berechnet; örtliche Sonderfälle und zusätzliche Tage sind einstellbar.
2. **Upload**: Eine oder mehrere Zeitnachweislisten als PDF oder TXT auswählen. Die Dienstmonate werden automatisch erkannt. Ungeprüfte Nachweise bleiben in der Prüfliste gespeichert, auch nach weiteren Uploads oder einem Neuladen. Periode, Druckdatum und Vorschau prüfen, dann jeden Nachweis bestätigen. Juli bleibt Juli, auch wenn der Nachweis erst Ende September erstellt wurde. Fehler einzelner Dateien verhindern nicht die Ablage der übrigen Dateien.
3. **Übersicht / Kalender / Zeiterfassung**: Arbeitgeberangaben, einzelne Dienstblöcke und Auffälligkeiten nachvollziehen. Beim ersten Öffnen der Zeiterfassung sind der heutige Tag in Europe/Berlin und der aktuelle Monat vorausgewählt. Für andere Tage im Kalender den Tag auswählen und einen Dienst erfassen oder bearbeiten; dieses Datum wird in die Zeiterfassung übernommen. Ankunft, Feierabend und tatsächlich genommene Pause speichern. Eigene Zeitaufzeichnungen werden separat mit der Arbeitgeber-Istzeit verglichen.
4. **Abgleich**: Stundenrechnungen prüfen und die Auszahlung jeder Zuschlagsposition direkt neben ihrem Betrag quittieren. Eine Monatsnotiz lässt sich separat speichern. Der Zeitnachweis allein belegt keine Auszahlung; ohne Abgleich mit der Lohnabrechnung bleibt ein Eurobetrag eine Schätzung auf Basis der ausgewiesenen Stunden.
5. **Krankheit und Urlaub**: Die Tageszählung erfolgt automatisch aus dem Nachweis, einschließlich Krankheits- und Urlaubsmarkierungen in Folgezeilen unter normalen Diensten. Es zählen Tage mit Soll-/Istgutschrift; geplantes Frei/FZA bleibt ausgeschlossen. Eigene Krankheits- und Urlaubseinträge werden anhand des Sollprofils berücksichtigt. In der Zeiterfassung lässt sich ein Tag ausdrücklich als geplanter Arbeitstag oder Frei/FZA kennzeichnen. Derselbe Tag wird bei mehreren Quellen nur einmal gezählt.

Unter **Prüfung des Dienstmonats** stehen die getrennten Tageszählungen für Krankheit und Urlaub einschließlich ausgeschlossener Tage. Die **Vergütungskarte** enthält die Entgeltfortzahlung mit Tagessatz, Rechenweg, Gesamtbetrag und Auszahlungskontrolle. Dieser Betrag wird zur Vergütungssumme und zur Übersicht addiert. Eine separate Krankheitskarte gibt es nicht. Urlaub wird analog als eigene Vergütungsposition mit Tagessatz und Auszahlungskontrolle dargestellt und zur Gesamtsumme addiert. Mehrere Urlaubsblöcke mit derselben Referenzbasis werden zusammengefasst. Krankheit während eines markierten Urlaubs wird nur als Krankheit gezählt; unbezahlter Urlaub und Sonderurlaub werden nicht automatisch vergütet. Urlaub wird monatlich abgerechnet: Alle Urlaubstage eines Dienstmonats verwenden dessen drei volle Vormonate, auch bei einem Urlaubsbeginn im Vormonat. Für April sind das Januar, Februar und März. Die in den Referenzmonaten berechneten Beträge werden ohne zusätzliche Tabellenanpassung gemittelt. Dadurch stehen alle Urlaubstage des Monats in einer gemeinsamen Vergütungsposition.

Der Krankheitsbeginn bestimmt die drei vorhergehenden vollen Kalendermonate, auch bei Krankheit über einen Monatswechsel. Für Dezember sind das September, Oktober und November. Die App verwendet erkennbare variable Zuschläge aus diesen Nachweisen oder berechnet sie aus eigenen Einträgen. Bereits gespeicherte bestätigte Referenzbeträge bleiben verwendbar. Feste Monatszulagen und nicht dienstplanmäßige Überstunden fließen nicht in den Durchschnitt ein; unklar bezahlte BD-Grundvergütung und uneindeutige FT100%-Beträge werden mit Hinweis ausgelassen. Die App verwendet auf Wunsch die Abrechnungsmethode mit festem Tages-Teiler 65 (1/65): Referenzsumme ÷ 65, auf Cent gerundet, × anrechenbare Krankheits- oder Urlaubstage. Frühere Urlaubs- und Krankheitstage verkürzen den Teiler nicht. Diese Methode gilt auch für gespeicherte Krankheitszeiträume mit drei vollen Referenzmonaten und unabhängig von der eingestellten Wochenverteilung. Verkürzte individuelle Referenzzeiträume behalten ihre ausdrücklich bestätigte Berechnungsbasis. Der Rechenweg benennt den festen Abrechnungsmodus. Die vereinbarte automatische Abrechnung für Krankheit und Urlaub verwendet die Referenzbeträge ohne zusätzliche Tabellenanpassung. Bei Krankheitsbeginn im Juni sind März, April und Mai maßgeblich. Ausdrücklich bestätigte manuelle Anpassungen gespeicherter Krankheitszeiträume bleiben erhalten. Referenzsumme, Tagesdurchschnitt und Monatsbetrag werden auf Cent gerundet.

Fehlende Referenzmonate werden benannt; Tagessatz und Gesamtvergütung bleiben dann offen. Die Referenzbeträge und Annahmen stehen im Rechenweg. Geänderte Grundlagen erfordern eine erneute Auszahlungskontrolle. Bestehende gespeicherte Krankheitszeiträume und Quittierungen bleiben erhalten. Beschäftigungsbeginn, individuelle Arbeitszeitänderungen, die Anspruchsdauer und besondere Vergütungsbestandteile müssen anhand der Unterlagen geprüft werden. Krankengeldzuschuss und Netto-/Steuerberechnung werden nicht berechnet.

Im Abgleich stehen die Stundenrechnungen mit ihren Eingabewerten und ausgeschriebenen Rechenwegen direkt in der Prüftabelle; ein zusätzliches Stunden-Dashboard gibt es nicht. Der Monatssaldo ist Ist minus Vertragssoll. Für die rechnerische Überstundenbasis wird die höhere der geplanten und vertraglichen Sollzeiten abgezogen: Ist − max(Dienstplansoll, Vertragssoll). Nur eine positive Differenz ergibt Überstunden-Zuschlagsstunden; bei einer negativen Differenz beträgt die Basis 0 h. Die Basis wird mit den ausgewiesenen Zuschlagsstunden verglichen. Das Zeitkonto wird als Anfangsstand + Ist + BD-FZA-Zugang − Vertragssoll + Korrektur gerechnet. Der BD-FZA-Zugang verwendet ausschließlich die bewerteten Tagesstunden ausdrücklich als `BD-St.…-FZA` gekennzeichneter Dienste. Bezahlte BD-Stunden und das separate faktorisierte BD-Konto werden nicht zusätzlich angerechnet. BD-Grundbewertungen werden im Abgleich getrennt als Freizeitausgleich und Auszahlung mit aufklappbaren Tageswerten angezeigt. Der Aufbau des Auszahlungskontos wird gegen die bewerteten `bez`-Tageswerte geprüft; sein Monatsbestand ergibt sich aus Aufbau minus ausgewiesenem Abbau. BD-Auszahlungsumbuchungen bleiben im Originalnachweis sichtbar und erzeugen keine zusätzliche Vergleichsprüfung. Arbeitgebermeldungen wie Ruhezeitverletzungen und Überlapp von Solldienst und BD stehen unten im Abgleich als Information ohne Quittierung. Für eindeutig bezahlte BD wird eine eigene Vergütungsposition aus bewerteten Stunden mal individuellem Stundenentgelt berechnet; eine tatsächliche Zahlung muss separat quittiert werden. Fehlende Bewertungen oder im selben Tageswert vermischte bezahlte und FZA-Dienste bleiben zur Prüfung offen. Bestehende Nachweise werden neu berechnet; ein erneuter Upload ist nicht nötig. Aus dem Monatsplus werden keine zusätzlichen auszuzahlenden Überstunden erzeugt; Vergütung verwendet weiterhin ausgewiesene Lohnarten bzw. ausdrücklich bestätigte Stunden.

Das **Freizeitkonto Feiertagsarbeit** wird separat gerechnet: Endstand des unmittelbaren Vormonats + Feiertagsstunden mit Freizeitausgleich − genommener FT-Freizeitausgleich − ausgezahlte ältere FT-Stunden. Tageswerte und FT-35-/FT-135-Lohnarten bestimmen den Zugang; ausdrücklich zugeordneter FT-FZA bestimmt den Abbau. BD-FZA wird nicht als Feiertags-FZA abgezogen, und der zusätzliche 35-%-Zuschlag am 24./31. Dezember erzeugt keinen Zugang zum gesetzlichen Feiertagskonto. Die Kontenrechnung und die Vergütung in Euro bleiben getrennt. Fehlende Anfangsstände oder nicht eindeutig zugeordnete Buchungen werden mit benannter Annahme vorläufig berechnet und bleiben zur Prüfung offen. Auch ältere gespeicherte Nachweise werden anhand ihres Originaltexts ausgewertet; neue Uploads sind dafür nicht nötig.

Der **einmalige Zeitkonto-Anfangsstand** steht in den Einstellungen zusammen mit dem Monat, zu dessen Beginn er gilt. Ausdrücklich gespeicherte 0 h gelten als bestätigter Anfangsstand. Für Folgemonate wird der Endstand des unmittelbar vorherigen Nachweises übernommen oder berechnet. Fehlt dieser Nachweis, wird der vorläufige Endstand aus den eigenen Zeitaufzeichnungen des Vormonats verwendet, einschließlich BD-FZA und Monatskorrekturen. Das funktioniert auch über mehrere aufeinanderfolgende Monate und den Jahreswechsel. Ein später bestätigter Arbeitgebernachweis hat Vorrang. Ein Anfangsstand aus dem Arbeitgebernachweis hat Vorrang. Bei fehlenden Zwischenmonaten wird die Lücke angezeigt; der einmalige Anfangsstand wird nicht jeden Monat erneut addiert. Vorhandene gespeicherte Monats-Anfangsstände werden bei der Umstellung berücksichtigt. Zeitkontokorrekturen bleiben monatsbezogen und stehen ebenfalls in den Einstellungen.

Fehlende Eingabewerte lassen die Rechnung nicht leer: Fehlende Istzeit verwendet verfügbare Tageswerte oder vorläufig 0 h. Fehlendes Vertragssoll verwendet die Sollzeit des Wochenprofils einschließlich Feiertagen und Arbeitszeitänderung. Fehlendes Dienstplansoll verwendet eine vollständige Tages-Sollliste oder ersatzweise das Vertragssoll. Alle verwendeten Annahmen stehen im Erklärungstext der jeweiligen Prüfzeile. Die drei Stundenprüfungen bewerten die rechnerische Übereinstimmung: gleiche Beträge sind „Stimmig“, unterschiedliche Beträge „Abweichung“. Fehlt der Vergleichswert im Nachweis, bleibt „Prüfen“. Annahmen werden unabhängig vom Status weiterhin angezeigt. Teilweise Tageslisten werden ausdrücklich als unvollständig gekennzeichnet. Beim Nachtstunden-Abgleich wird ein nicht ausgewiesener BD-Anteil als 0 h addiert, wenn reguläre Nachtstunden vorhanden sind. Die Originalwerte werden nicht überschrieben, und der Vergleichswert laut Nachweis bleibt leer, wenn er in der Quelle fehlt.

Die Auszahlung wird pro Position in „Vergütung“ quittiert und kann wieder geöffnet werden. Sobald alle Positionen quittiert sind, zeigt die Übersicht dies an. Quittierungen beziehen sich auf die konkrete Nachweisfassung sowie Stunden, Satz und Betrag; geänderte Berechnungsgrundlagen machen eine erneute Prüfung erforderlich. Es gibt kein zusätzliches Gesamtbetragsfeld und keine separate Eingabe bestätigter Überstunden, Grundvergütung oder weiterer Vergütung. Frühere Monatswerte bleiben zur Sicherung gespeichert, beeinflussen die aktuelle Ansicht aber nicht mehr.

Statusfelder „Prüfen“ lassen sich anklicken und manuell quittieren. „Quittiert ✓“ lässt sich erneut anklicken, um den Punkt wieder zu öffnen. Der ursprüngliche Hinweis bleibt lesbar; die Quittierung bestätigt die eigene Sichtung und verändert weder Arbeitgeberwerte noch das berechnete Ergebnis. Festgestellte Abweichungen bleiben offen, bis ihre Ursache geklärt und die zugrunde liegenden Angaben korrigiert wurden. Quittierungen gelten für die konkrete Nachweisfassung und die konkreten Prüfwerte; neue Nachweise oder geänderte Prüfwerte benötigen eine neue Sichtung. Sie werden in SQLite bzw. im lokalen Browserspeicher gespeichert und im Datenexport gesichert.

Ein leerer bzw. mit „–“ dargestellter Überstunden-Zuschlagswert wird im Stundenvergleich als 0 h behandelt. Eine vollständig fehlende Lohnart bleibt unbekannt. Arbeitgebermeldungen stehen unten im Abgleich unter „Hinweise aus dem Nachweis“ und zählen nicht als offene Prüfpunkte; sie erfordern keine Quittierung. Die eigentlichen Stunden- und Vergütungsberechnungen bleiben in den Prüftabellen.

Die Zahl neben **Abgleich** zählt unterschiedliche Dienstmonate mit offenen Prüfpunkten oder unbestätigten Uploads. Mehrere Prüfpunkte oder Dateien desselben Monats zählen als ein Monat. Die Monatsliste im Abgleich öffnet den jeweiligen Nachweis bzw. den noch unbestätigten Upload. Innerhalb eines Nachweises bleibt die Anzahl seiner offenen Prüfpunkte separat sichtbar. Ältere Nachweisfassungen desselben Monats werden nicht zusätzlich gezählt.

**Opt-out** wird einmalig unter Einstellungen hinterlegt: noch nicht hinterlegt, keine Vereinbarung oder vereinbart mit einer optionalen Wochenstundengrenze. Die Auswahl wird mit dem Profil automatisch gespeichert; aus einer Angabe im Arbeitgebernachweis wird keine eigene Vereinbarung abgeleitet. Opt-out und Arbeitsschutzkonto erzeugen keine monatlichen Prüfpunkte im Abgleich. Ihre Originalwerte bleiben im Upload unter den Betriebssummen sowie im Export erhalten.

## Import und Datenmodell

- Eigener Parser für die bereitgestellte DPL-Zeitnachweisliste: mehrzeilige Tage, Soll/Ist, Bereitschaftsdienst, Zuschlagsstunden, Summen, Umbuchungen und gemeldete Auswertungsfehler.
- PDF-Textextraktion erhält die Spaltenpositionen. Nur PDFs mit Textschicht; gescannte Dateien benötigen vorher OCR.
- DPL-Endzeiten wie `24:00` werden als Mitternacht am Ende des angegebenen Tages akzeptiert und unverändert im Nachweis und Kalender angezeigt.
- Zusätzlich einfache TXT-Zeilen: `03.08.2026;08:00;17:00;30` (Pause in Minuten), `06.08.2026;Urlaub` oder `07.08.2026;Krank`. Ein Beispiel liegt unter `/beispiel.txt`.
- Arbeitgebernachweise werden als separate, versionierte Quellen gespeichert. Identische strukturierte Nachweise werden nicht doppelt angelegt; bei neuen Fassungen wird die zuletzt importierte Fassung des Monats angezeigt. Ältere Fassungen bleiben im Datenexport erhalten.
- Manuelle Einträge, Arbeitgeberangaben und tarifliche Einstellungen bleiben getrennt. Insbesondere werden verschachtelte BD-/Regeldienst-Blöcke nicht automatisch als zusätzliche Arbeitsstunden gespeichert.
- Die Originaldatei selbst wird nach der Extraktion nicht archiviert. Der extrahierte Text, Quellenname, Tageszeilen und strukturierte Werte bleiben in SQLite erhalten.
- Einstellungen können zeitlich gestaffelt werden: Unter **Einstellungen → Fassung der Einstellungen** legt „Ab ‹Monat› neue Fassung anlegen“ eine Fassung an, die zunächst alle Werte übernimmt. Änderungen wirken dann nur ab diesem Monat; frühere Monate, ihre Berechnungen und Quittierungen bleiben unverändert. Bearbeitet wird immer die Fassung des oben gewählten Monats, auch bei noch laufender automatischer Speicherung. Fassungen lassen sich wieder zusammenführen. Ohne weitere Fassung gilt ein Profil für alle Monate. Anfangsstand, Dienstvorlagen und die Profilbestätigung gelten stets für alle Monate. Die Tarifentgelttabellen A/B und die wirksame Entgeltstufe werden anhand des Leistungsmonats unterschieden. Ein Stufenaufstieg gilt für den gesamten Vorrückungsmonat (§ 17 Abs. 1 TV-Ärzte); weitere Aufstiege folgen den regulären Laufzeiten bis zur Endstufe.
- Die ausgewählte Stufe gilt als Ausgangsstufe vor dem nächsten angegebenen Aufstieg. Daraus werden frühere und spätere Stufen mit den regulären Laufzeiten rekonstruiert. Diese Rekonstruktion setzt durchgehende Laufzeiten innerhalb derselben Entgeltgruppe voraus; Gruppenwechsel und Unterbrechungen werden nicht daraus abgeleitet. Ohne nächstes Aufstiegsdatum bleibt die ausgewählte Stufe konstant. Anerkannte Zeiten oder Unterbrechungen müssen anhand der Personalmitteilung berücksichtigt werden.
- Einstellungen speichern sich nach einer kurzen Eingabepause automatisch; eine Statusanzeige und eine eingeblendete Speicherbestätigung zeigen das Ergebnis. Ungültige Eingaben bleiben zur Korrektur erhalten.
- Die Arbeitszeitänderung lässt sich in den Einstellungen aktivieren: standardmäßig 42 Wochenstunden vor dem 1. Januar 2026, danach 40. Die eingetragene Wochenverteilung beschreibt die Zeit nach der Änderung; frühere Sollstunden werden proportional angepasst, auch bei einer reduzierten Wochenverteilung. Ohne Aktivierung bleibt die bestehende Sollverteilung unverändert.
- Bestehende Profile und alte Sicherungen mit ausdrücklich eingetragenen Stundenentgelten bleiben im manuellen Modus. Über „Stundenentgelte → Aus Entgelttabelle“ kann auf automatische Sätze umgestellt werden. Manuelle Sätze werden durch einen Stufenaufstieg nicht automatisch verändert.

## Berechnungsumfang und Grenzen

Implementiert sind der Stundenabgleich, die Trennung von Kontosaldo und ausdrücklich festgestellten Überstunden, tarifliche Nacht-/Samstags-/Sonntags-/Feiertagszuschläge, Grundbewertung von Bereitschaftsdienst und Rufbereitschaft sowie manuelle Ergänzungen für Dienstplanbesonderheiten. Zuschläge sind Bruttowerte. Die bereitgestellte Normenzusammenstellung liegt in `docs/tarifgrundlage.md`.

Fehlende Pausenlagen, unklare Dienstblöcke oder unaufgeklärte Kontobewegungen werden als Prüfpunkte angezeigt. Pausen werden nicht automatisch als genommen unterstellt. Bei eigenen Einträgen ohne genaue Pausenlage sind die Zuschlagszeiten ausdrücklich nur proportional geschätzt.

Eine Monatsdifferenz begründet nicht automatisch tarifliche Überstunden. Dienstplan, Anordnung und Ausgleichsfristen erfordern weitere Belege. Ebenso sind Landesregelungen, Nebenabreden, Teilzeitfälle, Schichtturnus, Dienstzählung mit halben Diensten, Quartalsausnahmen, Abgaben/Netto, Ausschlussfristen sowie die vollständige Prüfung des Arbeitszeitgesetzes nicht automatisiert. BD-Zusatzpunkte und dienstplanabhängige Zuschläge werden bewusst manuell eingegeben. Kein automatisches Urteil über die Rechtmäßigkeit eines Dienstplans.

Zeitintervalle werden derzeit als lokale Uhrzeiten gerechnet. Dienste über die Sommer-/Winterzeitumstellung müssen gesondert geprüft werden. Originalnachweise und Lohnabrechnungen aufbewahren.

Offizielle Quelle für den abgeglichenen Tarifkern: [TdL – TV-Ärzte, Fassung vom 9. Juni 2026](https://www.tdl-online.de/tarifvertraege/tv-aerzte). Die App ruft zur Laufzeit keine Tarifdaten im Internet ab.

Die vollständigen Stufentabellen stammen aus [Anlage A (April 2026 bis August 2027)](https://www.tdl-online.de/fileadmin/downloads/TV-Aerzte/01_TV-Aerzte/Anlage_A_zum_TV_%C3%84rzte_v._01.04.2026_bis_31.08.2027.pdf) und [Anlage B (ab September 2027)](https://www.tdl-online.de/fileadmin/downloads/TV-Aerzte/01_TV-Aerzte/Anlage_B_zum_TV_%C3%84rzte_ab_01.09.2027.pdf). Stundenentgelt bei 40 Wochenstunden: Monatsbetrag / (4,348 × 40), gerundet auf Cent (§ 24 Abs. 3 und 4). Der angezeigte Monatsbetrag ist das Tabellenentgelt bei Vollzeit, nicht die berechnete Teilzeit-Auszahlung.

Historische Tabellen ab Oktober 2023, April 2024, Februar 2025 und Januar 2026 sind aus den Anlagen des [TV-Ärzte, Änderungstarifvertrag Nr. 9](https://www.marburger-bund.de/sites/default/files/tarifvertraege/2024-11/TdL%20TV-%C3%84rzte%20i.d.F.%209.%C3%84nderungsTV.pdf) hinterlegt. Ä 3 / Stufe 4 ist erst ab Januar 2026 verfügbar. Vor Oktober 2023 werden keine automatischen Tabellenbeträge behauptet. Der historische tarifliche Stundenteiler berücksichtigt 42 Wochenstunden bis Dezember 2025 und 40 ab Januar 2026, auch wenn die Änderung des persönlichen Sollzeitprofils deaktiviert ist. Bei aktivierter Arbeitszeitänderung richtet er sich nach den eingestellten Vollzeitwerten. Wochenverteilung für Teilzeit separat reduzieren; die Vollzeitwerte 42/40 beschreiben den Tarif, nicht die persönliche Teilzeitquote. Die [TdL-Mitteilung zum Abschluss](https://www.tdl-online.de/presse/detail/tarifeinigung-fuer-aerztinnen-und-aerzte) bestätigt den Wechsel zum 1. Januar 2026.

Feiertage umfassen alle 16 Bundesländer. Mariä Himmelfahrt in Bayern, das Augsburger Friedensfest und örtliches Fronleichnam in Sachsen/Thüringen sind bewusst eigene Optionen: Entscheidend ist der konkrete Arbeitsort. Quellen der örtlichen Sonderfälle: [Bayerisches Feiertagsgesetz](https://www.gesetze-bayern.de/Content/Document/BayFTG/true), [Sächsisches Sonn- und Feiertagsgesetz](https://www.revosax.sachsen.de/vorschrift/3997). Die Feiertagsregeln sind lokal hinterlegt und müssen bei späteren Gesetzesänderungen aktualisiert werden.

## Entwicklung

Hinweise zu Prüfungen und Repository-Inhalten: [CONTRIBUTING.md](CONTRIBUTING.md).

Die Startansicht **Übersicht** zeigt das ausgewählte Jahr: Balkendiagramme für Zeitkonto-Endstände, Zusatzvergütung, Bereitschaftsdienste und ausgewiesene Überstunden-Zuschlagsstunden sowie ein Kuchendiagramm der Vergütungsbestandteile im Monatsmittel. Der Tab **Monat** zeigt monatliche Kennzahlen zu Arbeitszeit, Zeitkonto, Vergütung, Diensten, Zuschlagsstunden sowie anrechenbaren Urlaubs- und Krankheitstagen. Prüfergebnis und Auszahlungsabgleich stehen im Tab **Abgleich**. Ein Klick auf einen Balken oder eine Monatszeile öffnet diesen Monat. Die Jahresauswertung verwendet pro Monat den neuesten bestätigten Nachweis, ersatzweise eigene Einträge, und dieselben Berechnungsgrundlagen einschließlich Monatskorrekturen und Entgeltfortzahlung wie die Monatsansicht. Fehlende Werte werden als Lücken dargestellt; Durchschnitte verwenden pro Kennzahl nur Monate mit bekannten Werten, einschließlich ausdrücklich ausgewiesener Nullwerte. Zeitzuschläge aus eigenen Einträgen werden nach Nacht-, Wochenend- und Feiertagszuschlägen aufgeteilt und mit den entsprechenden Zuschlagsarten aus Nachweisen zusammengeführt. Die Aufteilung berücksichtigt Zuschlagskonkurrenz und Pausen; die bestehenden Vergütungssummen bleiben erhalten. Rufbereitschaftszahlen werden nur aus eigenen Einträgen ermittelt, da Nachweise dafür keine verlässliche Monatssumme enthalten. Ein Zeitkontoplus wird nicht als Überstunden behauptet.

Die Zeiterfassung und der Kalender verwenden dasselbe Erfassungsformular: konfigurierte Dienste, manuelle Zeitblöcke, Urlaub, Krankheit, **Frei nach Dienst (FnD)** und **Freizeitausgleich (FzA)**. FnD und FzA behalten die Sollstunden des Wochenprofils einschließlich Arbeitszeitänderungen und Feiertagen, erhalten aber keine Arbeitszeit- oder Abwesenheitsgutschrift. Ein FnD/FzA-Tag darf zusammen mit den morgendlichen Zeitabschnitten des am Vortag begonnenen Nachtdiensts gespeichert werden.

Bereitschaftsstufe und BD-Ausgleich stehen in der Dienstkonfiguration; Zusatzpunkte und Dienstplanzuschlag bleiben im Erfassungsformular. Dienste aus einer Vorlage verwenden deren aktuelle Bereitschaftsstufe und Ausgleichsart auch für bereits erfasste Monate. Ältere manuelle Bereitschaftseinträge ohne Zuordnung übernehmen fehlende Angaben aus genau einer passenden Dienstvorlage (Dienstname, ersatzweise exakter Name in der Notiz); ausdrückliche manuelle Angaben haben Vorrang. BD-FZA erhöht das Zeitkonto um BD-Stunden × Stufenfaktor einschließlich bestätigter Zusatzpunkte und Feiertagsbewertung. Ausgezahlte BD erhöht die Vergütung. Feiertags-Freizeitausgleich wird in den Einstellungen festgelegt; vorhandene Angaben einzelner Einträge bleiben maßgeblich. Bei konfigurierten Diensten wird eine eingegebene Pause proportional auf die Zeitabschnitte verteilt; Zuschlagszeiten ohne genaue Pausenlage sind damit Schätzungen.

Node.js **24** (SQLite über `node:sqlite`, kein zusätzlicher Datenbankserver). `node:sqlite` ist ein experimentelles Node-Built-in; die App lädt es isoliert über `src/lib/server/sqlite.ts` und setzt `engines.node >= 24`. Beim Upgrade der Node-Version die Persistenz testen (`npm test`, dann einen Nachweis importieren und neu laden).

```sh
npm ci
npm run dev
npm run check
npm test
npm run build
```

**Aufbau:** Die Fachlogik liegt framework-frei in `src/lib`. `src/lib/workspace.ts` beschreibt den gespeicherten Arbeitsbereich mit allen Operationen und Schema-Migrationen, `src/lib/actions.ts` enthält jede Formularaktion genau einmal. Server (`src/lib/server/db.ts`, SQLite) und Browser-Version (`browser/store.ts`, IndexedDB) sind reine Speicheradapter, die den Arbeitsbereich innerhalb einer Transaktion laden und speichern; `tests/storage-parity.test.ts` prüft, dass beide aus denselben Aktionen dasselbe Ergebnis erzeugen. Die Oberfläche besteht aus `src/routes/+page.svelte` und einer Komponente je Tab in `src/lib/components/tabs/`. `npm run format` formatiert den Code mit Prettier; die CI prüft das Format.

`npm run dev` öffnet den Server unter http://127.0.0.1:5173. `DATA_DIR` setzt optional ein anderes Datenverzeichnis. Für den Produktionsserver `ORIGIN` passend setzen, danach `npm start`. Uploadgrenzen: maximal 20 Dateien, 10 MB pro Datei und 100 MB insgesamt. Requestgrenze im Container: 110 MB; ein vorgeschalteter Proxy muss entsprechend konfiguriert sein.

## Gehostete App mit lokaler Verarbeitung

Zusätzlich enthält das Projekt eine statische Browser-Version. Sie nutzt dieselbe Oberfläche, denselben DPL-Parser und dieselbe Tarifberechnung. PDF-Verarbeitung, Tageserfassung, Regeln und Nachweisablage laufen vollständig im Browser; die Daten werden in IndexedDB gespeichert. Es gibt keine Upload-API, keine Analyseanbieter und keine extern geladenen Schriftarten. Der PDF-Worker gehört zum Build.

```sh
npm run build:browser
npm run preview:browser
```

Die Vorschau läuft unter **http://127.0.0.1:5175**. Zur Entwicklung: `npm run dev:browser`. Typprüfung: `npm run check:browser`. Zum Hosting den **gesamten Inhalt von `dist-browser/`** auf einem statischen HTTPS-Host veröffentlichen; es ist kein Node-Server und keine Datenbank beim Hoster erforderlich. Der Build unterstützt relative Asset-Pfade und kann auch unter einem Unterverzeichnis liegen. `index.html` enthält eine Content Security Policy, die fremde Quellen und Formularübertragungen blockiert. Keine Analyse- oder fremden Skripte hinzufügen, wenn die lokale Verarbeitung erhalten bleiben soll.

Der Host sieht normale Abrufe der App-Dateien und deren Verbindungsdaten. Zeitnachweise und Eingaben werden von der App nicht an ihn übertragen. Der Host liefert allerdings den ausführbaren Code aus; diese Zusicherung setzt einen vertrauenswürdigen, unveränderten Build voraus.

Browserdaten sind an Browserprofil und Website-Adresse gebunden. Eine neue Domain, ein anderer Browser oder ein anderes Gerät hat einen eigenen Datenbestand. **Browserdaten löschen entfernt die Aufzeichnungen.** Regelmäßig „Sicherung exportieren“ verwenden. „Sicherung einlesen“ importiert auch den JSON-Export der Docker-Version, fügt neue Einträge/Nachweise hinzu und behält vorhandene Monatsabgleiche. Konflikte werden gemeldet; der Import ist atomar. Ein eingerichtetes, bestätigtes Browserprofil wird bei einem Sicherungsimport nicht überschrieben. Weitere Hinweise zur Speicherhaltung: [MDN – IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API).

## Sicherung

Über **Datenexport** werden Einstellungen, Einträge, Monatsabgleiche, Quittierungen, ungeprüfte Uploads und alle Nachweisversionen als JSON heruntergeladen. Beide Versionen können diesen Export über „Sicherung einlesen“ übernehmen (Docker: in der Seitenleiste unter „Daten exportieren“). Der Import fügt neue Einträge und Nachweise hinzu und behält ein bestätigtes Profil sowie vorhandene Monatsabgleiche; so lassen sich Daten auch zwischen Browser- und Docker-Version umziehen.

Für eine vollständige wiederherstellbare Sicherung den Container stoppen und das Docker-Volume sichern. Beim Wiederherstellen das gesamte Datenverzeichnis mit passenden Rechten für Benutzer `node` zurückspielen. SQLite-Dateien einschließlich eventuell vorhandener `-wal`/`-shm` gehören zusammen; keine laufende Datenbankdatei isoliert kopieren.
