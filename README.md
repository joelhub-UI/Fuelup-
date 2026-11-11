# FuelUp

Zeigt die Tankstellen in deiner Nähe mit Live-Preisen – wahlweise eine Marke (z. B. Shell, Aral, JET) oder alle –,
vergleicht sie untereinander und mit den übrigen Marken
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

1. **Standort und Marke wählen** – per Ort/Postleitzahl oder Browser-Standort, dazu Umkreis (1–25 km), Kraftstoff
   und Marke. Die Markenliste enthält alle Marken, die im Umkreis vorkommen, plus „Alle Marken“.
2. **Live-Preise** – der Server fragt die Tankerkönig-API ab (Daten der Markttransparenzstelle für Kraftstoffe)
   und beobachtet die bis zu 40 nächstgelegenen Tankstellen aller Marken. Die gewählte Marke wird ausgewertet,
   die übrigen dienen als Vergleich; die Marke lässt sich jederzeit wechseln, ohne dass Historie verloren geht.
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
server/auth.js         Passwortschutz, Limits, Sicherheits-Header
server/db.js           SQLite-Speicher (node:sqlite)
public/                Dashboard (HTML, CSS, JavaScript ohne Build-Schritt), Karte mit Leaflet (public/vendor)
test/                  Tests: npm test
```

API: `GET /api/overview?fuel=e5|e10|diesel`, `POST /api/location`, `POST /api/brand`, `POST /api/refresh`, `POST /api/ai`,
`GET /api/geocode?q=…`, `GET /api/status`.

## Als App auf dem iPhone

FuelUp lässt sich als Web-App auf dem Home-Bildschirm ablegen (eigenes Icon, Vollbild ohne Browserleiste):
Seite in Safari öffnen → Teilen → „Zum Home-Bildschirm“. Der Server muss dafür vom iPhone aus erreichbar sein,
siehe Hinweise.

## Im Internet hosten

Die App braucht einen Anbieter, der einen **dauerhaft laufenden Container** mit **dauerhaftem Speicher** bietet
(z. B. Railway, Fly.io, Render oder ein eigener kleiner Server mit Docker). Reine „Serverless“-Angebote passen
nicht, weil die App durchgehend Preise sammelt und in eine Datei schreibt.

1. Beim Anbieter ein neues Projekt aus diesem GitHub-Repository anlegen; das `Dockerfile` wird automatisch erkannt.
2. Diese Umgebungsvariablen (oft „Secrets“ genannt) setzen – nicht ins Repository schreiben:

   | Variable | Wert |
   |---|---|
   | `APP_PASSWORD` | ein langes, zufälliges Passwort (mindestens 12 Zeichen) – ohne startet die App nicht |
   | `TANKERKOENIG_API_KEY` | dein Tankerkönig-Key |
   | `ANTHROPIC_API_KEY` | dein Claude-Key (optional) |
   | `TRUST_PROXY` | `1` |

3. Ein dauerhaftes Volume am Pfad `/app/data` einhängen – dort liegt die Preishistorie.
4. Die App lauscht auf Port 3000 (`PORT` anpassbar); Zustandsprüfung unter `/healthz`.
5. Die vom Anbieter vergebene `https://…`-Adresse öffnen, anmelden, auf dem iPhone zum Home-Bildschirm hinzufügen.

### Railway

Das Repository enthält eine fertige `railway.json` (Build per `Dockerfile`, Zustandsprüfung `/healthz`,
automatischer Neustart, eine Instanz).

1. Auf [railway.com](https://railway.com) anmelden → **New Project** → **Deploy from GitHub repo** → dieses
   Repository wählen (Branch `main`).
2. Im Dienst unter **Variables** die vier Variablen aus der Tabelle oben anlegen.
3. Ein **Volume** an den Dienst hängen, Mount-Pfad `/app/data`.
4. Unter **Settings → Networking** eine öffentliche Adresse erzeugen (**Generate Domain**). Fragt Railway nach
   dem Port: Er steht im Deploy-Log in der Zeile „FuelUp läuft auf …“.
5. Die `https://…up.railway.app`-Adresse öffnen und mit `APP_PASSWORD` anmelden.

Danach läuft alles automatisch: Jede Änderung, die in `main` landet, baut und startet Railway von selbst neu.
Auf GitHub prüft der Workflow `.github/workflows/ci.yml` bei jedem Pull Request und jedem Push nach `main`
die Tests und baut und startet das Docker-Image. Mit der Railway-Einstellung **Wait for CI** (unter den
Deploy-Einstellungen des Dienstes) wird nur ausgerollt, was diese Prüfungen bestanden hat.

Wichtig: nur **eine** Instanz betreiben (mehrere würden die Tankerkönig-API mehrfach abfragen und können sich
das Volume nicht teilen), und den Dienst nicht schlafen legen lassen („Serverless“/App Sleeping aus), sonst
entstehen Lücken in der Preishistorie.

### Eigener Server



```bash
docker build -t fuelup .
docker run -d --restart unless-stopped -p 127.0.0.1:3000:3000 -v fuelup-data:/app/data --env-file .env fuelup
```

Davor gehört ein Reverse-Proxy mit HTTPS (z. B. Caddy), der auf `127.0.0.1:3000` weiterleitet.

Was die App zur Absicherung mitbringt:

- **Anmeldung** mit einem Passwort; die Sitzung liegt in einem signierten Cookie (`HttpOnly`, `SameSite=Lax`,
  über HTTPS `Secure`), gültig 30 Tage. Ein neues Passwort meldet alle Geräte ab.
- **Bremse gegen Durchprobieren:** nach 8 Fehlversuchen je Adresse (60 insgesamt) 15 Minuten Sperre.
- **Kostenbremse:** höchstens `AI_DAILY_LIMIT` (Standard 30) KI-Analysen pro Tag.
- **Browser-Schutz:** strenge Content-Security-Policy, kein Einbetten in fremde Seiten, HSTS über HTTPS,
  schreibende Anfragen nur von der eigenen Adresse.
- Die API-Keys bleiben auf dem Server und werden nie an den Browser geschickt.

Grenzen: Es gibt nur ein gemeinsames Passwort, keine Benutzerkonten. HTTPS liefert der Anbieter bzw. der
Reverse-Proxy, nicht die App selbst.

## Hinweise

- Der Server lauscht standardmäßig nur auf `127.0.0.1`. Für Zugriff vom Handy im Heimnetz `HOST=0.0.0.0` setzen –
  dann am besten auch `APP_PASSWORD` setzen. „Mein Standort“ funktioniert im
  Browser nur über `localhost` oder HTTPS.
- Tankerkönig erlaubt höchstens eine Abfrage pro Minute je API-Key und automatische Abfragen höchstens alle
  5 Minuten. FuelUp hält beides ein: Pro Abfrage passen 10 Stationen, ein vollständiger Abruf von 40 Stationen
  verteilt sich deshalb über gut drei Minuten.
- Preisdaten: Tankerkönig, Lizenz CC BY 4.0. Ortssuche: Nominatim / © OpenStreetMap-Mitwirkende.
- Nur Deutschland: Die Preisdaten stammen von der deutschen Markttransparenzstelle. Eine weltweite Quelle für
  Live-Spritpreise gibt es nicht; andere Länder bräuchten jeweils eine eigene Datenquelle. Prognosen sind Schätzungen aus vergangenen Preisen, keine Garantie.
