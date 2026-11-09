import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { Service, isFuel } from './service.js';

const service = new Service(openDb(config.dbPath));
const publicDir = path.join(config.root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 10_000) throw httpError(413, 'Anfrage zu groß.');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw httpError(400, 'Ungültiges JSON.');
  }
}

function fuelParam(url) {
  const fuel = url.searchParams.get('fuel') || 'e5';
  if (!isFuel(fuel)) throw httpError(400, 'Unbekannte Kraftstoffsorte.');
  return fuel;
}

// Ortssuche über Nominatim (OpenStreetMap). Der Server reicht nur den Suchbegriff weiter.
async function geocode(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.search = new URLSearchParams({ q, format: 'jsonv2', limit: '5', countrycodes: 'de', 'accept-language': 'de' });
  let res;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'FuelUp/1.0 (self-hosted)' }, signal: AbortSignal.timeout(10000) });
  } catch {
    throw httpError(502, 'Die Ortssuche ist nicht erreichbar.');
  }
  if (!res.ok) throw httpError(502, `Die Ortssuche antwortete mit HTTP ${res.status}.`);
  return (await res.json()).map((r) => ({ label: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

const routes = {
  'GET /api/status': () => service.status(),
  'GET /api/overview': (url) => service.overview(fuelParam(url)),
  'GET /api/geocode': (url) => {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 120) throw httpError(400, 'Bitte einen Ort oder eine Postleitzahl eingeben.');
    return geocode(q);
  },
  'POST /api/location': async (url, req) => {
    const { lat, lng, rad, label } = await readJson(req);
    const ok = [lat, lng, rad].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && rad >= 1 && rad <= 25;
    if (!ok) throw httpError(400, 'Ungültiger Standort oder Radius (1–25 km).');
    await service.setLocation({ lat, lng, rad, label: typeof label === 'string' ? label.slice(0, 200) : null });
    return service.overview(fuelParam(url));
  },
  'POST /api/refresh': async (url) => {
    const refreshed = await service.refresh();
    return { refreshed, ...service.overview(fuelParam(url)) };
  },
  'POST /api/ai': (url) => service.ai(fuelParam(url)),
};

async function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) throw httpError(404, 'Nicht gefunden.');
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    throw httpError(404, 'Nicht gefunden.');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const route = routes[`${req.method} ${url.pathname}`];
    if (route) return send(res, 200, await route(url, req));
    if (url.pathname.startsWith('/api/')) throw httpError(404, 'Nicht gefunden.');
    if (req.method !== 'GET') throw httpError(405, 'Methode nicht erlaubt.');
    await serveStatic(decodeURIComponent(url.pathname), res);
  } catch (err) {
    const status = err.status || (err.message.startsWith('Tankerkönig') ? 502 : 500);
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Interner Fehler.' : err.message });
  }
});

server.listen(config.port, config.host, () => {
  service.startCollector();
  console.log(`FuelUp läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(config.demo
    ? 'Demo-Modus: kein TANKERKOENIG_API_KEY gesetzt – es werden simulierte Preise angezeigt.'
    : `Live-Preise über Tankerkönig, Abfrage alle ${config.pollMinutes} Minuten.`);
  console.log(config.aiEnabled ? `KI-Analyse aktiv (${config.aiModel}).` : 'KI-Analyse aus: kein ANTHROPIC_API_KEY gesetzt.');
});
