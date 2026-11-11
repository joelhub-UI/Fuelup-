// Passwortschutz für den Betrieb im Internet: ein gemeinsames Passwort (APP_PASSWORD),
// signiertes Sitzungs-Cookie, Bremse gegen Durchprobieren und Tageslimits für teure Aufrufe.
import crypto from 'node:crypto';

const COOKIE = 'fuelup_session';
const SESSION_DAYS = 30;
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 8;
const MAX_FAILS_TOTAL = 60;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

export class Auth {
  /** @param password leer = kein Passwortschutz */
  constructor(password, { now = () => Date.now() } = {}) {
    this.password = password || '';
    this.enabled = Boolean(this.password);
    this.now = now;
    // Schlüssel hängt am Passwort: Wird es geändert, verfallen alle Sitzungen.
    this.key = sha256(`fuelup-session:${this.password}`);
    this.fails = new Map(); // ip -> Zeitstempel fehlgeschlagener Versuche
  }

  #sign(expires) {
    return crypto.createHmac('sha256', this.key).update(String(expires)).digest('base64url');
  }

  createToken() {
    const expires = this.now() + SESSION_DAYS * 86400 * 1000;
    return `${expires}.${this.#sign(expires)}`;
  }

  verifyToken(token) {
    const [expires, sig] = String(token || '').split('.');
    if (!/^\d+$/.test(expires || '') || !sig || Number(expires) < this.now()) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(this.#sign(expires));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  isAuthenticated(req) {
    if (!this.enabled) return true;
    const match = /(?:^|;\s*)fuelup_session=([^;]+)/.exec(req.headers.cookie || '');
    return Boolean(match) && this.verifyToken(match[1]);
  }

  #recentFails(ip) {
    const cutoff = this.now() - WINDOW_MS;
    const list = (this.fails.get(ip) || []).filter((t) => t > cutoff);
    if (list.length) this.fails.set(ip, list);
    else this.fails.delete(ip);
    return list;
  }

  /** @returns 'ok' | 'wrong' | 'locked' */
  login(password, ip) {
    let total = 0;
    for (const key of [...this.fails.keys()]) total += this.#recentFails(key).length;
    const mine = this.#recentFails(ip);
    if (mine.length >= MAX_FAILS_PER_IP || total >= MAX_FAILS_TOTAL) return 'locked';
    if (crypto.timingSafeEqual(sha256(String(password ?? '')), sha256(this.password))) {
      this.fails.delete(ip);
      return 'ok';
    }
    this.fails.set(ip, [...mine, this.now()]);
    return 'wrong';
  }

  cookie(token, secure) {
    const maxAge = token ? SESSION_DAYS * 86400 : 0;
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  }
}

/** Zähler mit festem Zeitfenster, z. B. höchstens 30 KI-Analysen pro Tag. */
export class Limiter {
  constructor(max, windowMs, { now = () => Date.now() } = {}) {
    Object.assign(this, { max, windowMs, now, start: 0, count: 0 });
  }

  take() {
    if (this.now() - this.start >= this.windowMs) {
      this.start = this.now();
      this.count = 0;
    }
    if (this.count >= this.max) return false;
    this.count += 1;
    return true;
  }
}

/** Ist die Anfrage über HTTPS angekommen (direkt oder über den Proxy des Hosters)? */
export const isHttps = (req) => req.socket.encrypted || req.headers['x-forwarded-proto']?.split(',')[0].trim() === 'https';

/** Schreibende Anfragen müssen von der eigenen Seite stammen (Schutz gegen fremde Webseiten). */
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Nicht-Browser-Clients senden keinen Origin-Header
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function securityHeaders(req) {
  const headers = {
    'Content-Security-Policy': "default-src 'self'; img-src 'self' data: https://tile.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=()',
  };
  if (isHttps(req)) headers['Strict-Transport-Security'] = 'max-age=31536000';
  return headers;
}
