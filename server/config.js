import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;

const tankerkoenigKey = (env.TANKERKOENIG_API_KEY || '').trim();
const demo = !tankerkoenigKey;

export const config = {
  root,
  port: Number(env.PORT) || 3000,
  host: env.HOST || '127.0.0.1',
  tankerkoenigKey,
  tankerkoenigBase: env.TANKERKOENIG_BASE_URL || 'https://creativecommons.tankerkoenig.de/json',
  demo,
  // Demo- und Echtdaten liegen in getrennten Dateien, damit sie sich nie mischen.
  dbPath: env.DB_PATH || path.join(root, 'data', demo ? 'demo.sqlite' : 'fuelup.sqlite'),
  // Tankerkönig erlaubt automatische Abfragen höchstens alle 5 Minuten.
  pollMinutes: Math.max(5, Number(env.POLL_MINUTES) || 10),
  timeZone: env.TZ_NAME || 'Europe/Berlin',
  aiEnabled: Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN),
  aiModel: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
  // So viele der nächstgelegenen Tankstellen (alle Marken) werden beobachtet: 10 pro API-Abfrage.
  maxStations: 40,
  defaultBrand: 'shell',
};

export const FUELS = ['e5', 'e10', 'diesel'];
