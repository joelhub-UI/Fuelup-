# FuelUp

Zeigt die Shell-Tankstellen in deiner Nähe mit Live-Preisen, vergleicht sie untereinander und mit anderen Marken
und sagt dir, wann du am besten tankst – auf Basis aktueller und selbst gesammelter historischer Preise,
ausgewertet per Statistik und per KI (Claude).

## Schnellstart

Voraussetzung: Node.js ab Version 22.13.

```bash
npm install
cp .env.example .env   # Keys eintragen, siehe unten
npm start              # http://localhost:3000
```

Ohne Keys startet die App im **Demo-Modus** mit simulierten Tankstellen und Preisen (in der Oberfläche
deutlich gekennzeichnet). So lässt sich alles ausprobieren, bevor du Keys besorgst.

| Variable | Wofür | Woher |
|---|---|---|
| `TANKERKOENIG_API_KEY` | Live-Preise aller deutschen Tankstellen | kostenlos auf [creativecommons.tankerkoenig.de](https://creativecommons.tankerkoenig.de) |
| `ANTHROPIC_API_KEY` | KI-Analyse des besten Tankzeitpunkts | [platform.claude.com](https://platform.claude.com) (kostenpflichtig pro Analyse) |

Weitere Einstellungen (Port, Abfrageintervall, Modell) stehen in `.env.example`.

## So funktioniert es

1. **Standort wählen** – per Ort/Postleitzahl oder Browser-Standort, dazu Umkreis (1–25 km) und Kraftstoff.
2. **Live-Preise** – der Server fragt die Tankerkönig-API ab (Daten der Markttransparenzstelle für Kraftstoffe)
   und merkt sich die bis zu 10 nächsten Shell-Stationen sowie bis zu 10 Stationen anderer Marken als Vergleich.
3. **Historie** – solange der Server läuft, ruft er alle 10 Minuten die Preise ab und speichert sie in SQLite
   (`data/fuelup.sqlite`, 180 Tage). Die API liefert selbst keine Vergangenheitswerte; die Prognose wird also
   besser, je länger FuelUp läuft. Am besten dauerhaft laufen lassen (z. B. auf einem Raspberry Pi oder kleinen Server).
4. **Statistik** – aus der Historie entstehen ein Tagesprofil (Abweichung vom Tagesmittel je Uhrzeit), ein
   Wochentagsvergleich (ab 14 Tagen), der 7-Tage-Trend und eine Stundenprognose für die nächsten 24 Stunden.
   Solange weniger als 3 vollständige Tage vorliegen, wird ein allgemeiner Erfahrungswert für deutsche
   Tankstellen verwendet (morgens teuer, abends günstig) und die Verlässlichkeit als „niedrig“ ausgewiesen.
5. **Empfehlung** – „Jetzt tanken“ oder „Warten bis …“ mit erwarteter Ersparnis. Warten wird ab etwa
   1,5 ct/l Ersparnis empfohlen.
6. **KI-Analyse** – auf Knopfdruck bekommt Claude die aktuellen Preise, die Statistik und die Prognose und
   liefert eine begründete Empfehlung samt passender Station und Einschränkungen. Das Ergebnis wird bis zur
   nächsten Preisabfrage zwischengespeichert.

## Aufbau

```
server/index.js        HTTP-Server, API-Routen, statische Dateien
server/service.js      Standort, Preisabruf (Collector), Übersicht, KI-Aufruf
server/tankerkoenig.js Client für die Tankerkönig-API
server/analysis.js     Statistik, Prognose und regelbasierte Empfehlung
server/ai.js           Claude-Anbindung (strukturierte JSON-Antwort)
server/demo.js         Simulierte Daten für den Demo-Modus
server/db.js           SQLite-Speicher (node:sqlite)
public/                Dashboard (HTML, CSS, JavaScript ohne Build-Schritt)
test/                  Tests: npm test
```

API: `GET /api/overview?fuel=e5|e10|diesel`, `POST /api/location`, `POST /api/refresh`, `POST /api/ai`,
`GET /api/geocode?q=…`, `GET /api/status`.

## Als App auf dem iPhone

FuelUp lässt sich als Web-App auf dem Home-Bildschirm ablegen (eigenes Icon, Vollbild ohne Browserleiste):
Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Der Server muss dafür vom iPhone aus erreichbar sein,
siehe Hinweise.

## Hinweise

- Der Server lauscht standardmäßig nur auf `127.0.0.1`. Für Zugriff vom Handy im Heimnetz `HOST=0.0.0.0` setzen –
  die App hat keine Anmeldung, also nicht ungeschützt ins Internet stellen. „Mein Standort“ funktioniert im
  Browser nur über `localhost` oder HTTPS.
- Tankerkönig erlaubt automatische Abfragen höchstens alle 5 Minuten; FuelUp hält das ein.
- Preisdaten: Tankerkönig, Lizenz CC BY 4.0. Ortssuche: Nominatim / © OpenStreetMap-Mitwirkende.
- Nur Deutschland. Prognosen sind Schätzungen aus vergangenen Preisen, keine Garantie.
