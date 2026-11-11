import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import { openDb } from './db.js';
import { Service, isFuel } from './service.js';
import { Auth, Limiter, isHttps, sameOrigin, securityHeaders } from './auth.js';

if (config.production && config.appPassword.length < 12) {
  console.error('Im Internet-Betrieb (NODE_ENV=production) muss APP_PASSWORD gesetzt sein und mindestens 12 Zeichen haben.');
  process.exit(1);
}
const auth = new Auth(config.appPassword);
const aiLimiter = new Limiter(config.aiDailyLimit, 86400 * 1000);
const geocodeLimiter = new Limiter(30, 60 * 1000);
const PUBLIC_API = new Set(['POST /api/login', 'GET /api/session']);

const service = new Service(openDb(config.dbPath));
const publicDir = path.join(config.root, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const httpError = (status, message) => Object.assign(new Error(message), { status });

function send(res, status, body, extra = {}) {
  res.writeHead(status, { ...extra, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
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

function clientIp(req) {
  const forwarded = config.trustProxy && req.headers['x-forwarded-for'];
  return forwarded ? forwarded.split(',')[0].trim() : req.socket.remoteAddress;
}

const routes = {
  'GET /api/session': (url, req) => ({ authRequired: auth.enabled, authenticated: auth.isAuthenticated(req) }),
  'POST /api/login': async (url, req, res) => {
    const { password } = await readJson(req);
    const result = auth.login(password, clientIp(req));
    if (result === 'locked') throw httpError(429, 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen.');
    if (result === 'wrong') throw httpError(401, 'Falsches Passwort.');
    res.setHeader('Set-Cookie', auth.cookie(auth.createToken(), isHttps(req)));
    return { ok: true };
  },
  'POST /api/logout': (url, req, res) => {
    res.setHeader('Set-Cookie', auth.cookie('', isHttps(req)));
    return { ok: true };
  },
  'GET /api/status': () => service.status(),
  'GET /api/overview': (url) => service.overview(fuelParam(url)),
  'GET /api/geocode': (url) => {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2 || q.length > 120) throw httpError(400, 'Bitte einen Ort oder eine Postleitzahl eingeben.');
    if (!geocodeLimiter.take()) throw httpError(429, 'Zu viele Ortssuchen – bitte kurz warten.');
    return geocode(q);
  },
  'POST /api/location': async (url, req) => {
    const { lat, lng, rad, label } = await readJson(req);
    const ok = [lat, lng, rad].every(Number.isFinite) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && rad >= 1 && rad <= 25;
    if (!ok) throw httpError(400, 'Ungültiger Standort oder Radius (1–25 km).');
    await service.setLocation({ lat, lng, rad, label: typeof label === 'string' ? label.slice(0, 200) : null });
    return service.overview(fuelParam(url));
  },
  'POST /api/brand': async (url, req) => {
    const { brand } = await readJson(req);
    if (brand != null && typeof brand !== 'string') throw httpError(400, 'Ungültige Marke.');
    service.setBrand(brand);
    return service.overview(fuelParam(url));
  },
  'POST /api/refresh': async (url) => {
    const refreshed = await service.refresh();
    return { refreshed, ...service.overview(fuelParam(url)) };
  },
  'POST /api/ai': (url) => {
    const fuel = fuelParam(url);
    // Zwischengespeicherte Ergebnisse kosten nichts und zählen nicht gegen das Tageslimit.
    if (!service.aiCached(fuel) && !aiLimiter.take()) throw httpError(429, `Das Tageslimit von ${config.aiDailyLimit} KI-Analysen ist erreicht.`);
    return service.ai(fuel);
  },
};

async function serveStatic(pathname, res, headers) {
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = path.join(publicDir, rel);
  if (!file.startsWith(publicDir + path.sep)) throw httpError(404, 'Nicht gefunden.');
  let data;
  try {
    data = await fs.readFile(file);
  } catch {
    throw httpError(404, 'Nicht gefunden.');
  }
  res.writeHead(200, { ...headers, 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  const headers = securityHeaders(req);
  try {
    const url = new URL(req.url, 'http://localhost');
    const name = `${req.method} ${url.pathname}`;
    if (name === 'GET /healthz') return send(res, 200, { ok: true }, headers);
    if (req.method !== 'GET' && !sameOrigin(req)) throw httpError(403, 'Anfrage von fremder Seite abgelehnt.');
    const authed = auth.isAuthenticated(req);
    const route = routes[name];
    if (route) {
      if (!authed && !PUBLIC_API.has(name)) throw httpError(401, 'Bitte anmelden.');
      return send(res, 200, await route(url, req, res), headers);
    }
    if (url.pathname.startsWith('/api/')) throw httpError(404, 'Nicht gefunden.');
    if (req.method !== 'GET') throw httpError(405, 'Methode nicht erlaubt.');
    // Die Seite selbst gibt es nur nach Anmeldung; Anmeldeseite, Stylesheet und Icons sind öffentlich.
    if (!authed && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(302, { ...headers, Location: '/login.html' });
      return res.end();
    }
    await serveStatic(decodeURIComponent(url.pathname), res, headers);
  } catch (err) {
    const status = err.status || (err.message.startsWith('Tankerkönig') ? 502 : 500);
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Interner Fehler.' : err.message }, headers);
  }
});

server.listen(config.port, config.host, () => {
  service.startCollector();
  console.log(`FuelUp läuft auf http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
  console.log(config.demo
    ? 'Demo-Modus: kein TANKERKOENIG_API_KEY gesetzt – es werden simulierte Preise angezeigt.'
    : `Live-Preise über Tankerkönig, Abfrage alle ${config.pollMinutes} Minuten.`);
  console.log(auth.enabled ? 'Passwortschutz aktiv.' : 'Kein Passwortschutz (APP_PASSWORD nicht gesetzt) – nur für den Betrieb im eigenen Netz geeignet.');
  console.log(config.aiEnabled ? `KI-Analyse aktiv (${config.aiModel}).` : 'KI-Analyse aus: kein ANTHROPIC_API_KEY gesetzt.');
});
