import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stations (
      id TEXT PRIMARY KEY, name TEXT, brand TEXT, street TEXT, house_number TEXT,
      post_code TEXT, place TEXT, lat REAL, lng REAL, dist REAL,
      is_shell INTEGER NOT NULL DEFAULT 0, tracked INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS prices (
      station_id TEXT NOT NULL, ts INTEGER NOT NULL,
      e5 REAL, e10 REAL, diesel REAL, is_open INTEGER,
      PRIMARY KEY (station_id, ts)
    ) WITHOUT ROWID;
    CREATE INDEX IF NOT EXISTS prices_ts ON prices (ts);
  `);
  return new Store(db);
}

class Store {
  constructor(db) {
    this.db = db;
  }

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  setSetting(key, value) {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, JSON.stringify(value));
  }

  /** Ersetzt die beobachteten Stationen; die Preishistorie alter Stationen bleibt erhalten. */
  setTrackedStations(stations) {
    const upsert = this.db.prepare(`
      INSERT INTO stations (id, name, brand, street, house_number, post_code, place, lat, lng, dist, is_shell, tracked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, brand = excluded.brand, street = excluded.street,
        house_number = excluded.house_number, post_code = excluded.post_code, place = excluded.place,
        lat = excluded.lat, lng = excluded.lng, dist = excluded.dist, is_shell = excluded.is_shell, tracked = 1`);
    this.db.exec('BEGIN');
    try {
      this.db.exec('UPDATE stations SET tracked = 0');
      for (const s of stations) {
        upsert.run(s.id, s.name ?? '', s.brand ?? '', s.street ?? '', s.houseNumber ?? '', String(s.postCode ?? ''),
          s.place ?? '', s.lat, s.lng, s.dist ?? null, s.isShell ? 1 : 0);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  trackedStations() {
    return this.db.prepare('SELECT * FROM stations WHERE tracked = 1 ORDER BY dist').all();
  }

  /** samples: [{ stationId, ts, e5, e10, diesel, isOpen }] */
  insertPrices(samples) {
    const stmt = this.db.prepare(
      'INSERT OR REPLACE INTO prices (station_id, ts, e5, e10, diesel, is_open) VALUES (?, ?, ?, ?, ?, ?)');
    this.db.exec('BEGIN');
    try {
      for (const p of samples) {
        stmt.run(p.stationId, p.ts, num(p.e5), num(p.e10), num(p.diesel), p.isOpen ? 1 : 0);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** Preisverlauf der beobachteten Stationen seit `sinceTs` für eine Kraftstoffsorte. */
  priceRows(fuel, sinceTs) {
    return this.db.prepare(`
      SELECT p.station_id AS stationId, p.ts, p.${fuel} AS price, s.is_shell AS isShell
      FROM prices p JOIN stations s ON s.id = p.station_id
      WHERE s.tracked = 1 AND p.ts >= ? AND p.${fuel} IS NOT NULL
      ORDER BY p.ts`).all(sinceTs);
  }

  latestPrices() {
    return this.db.prepare(`
      SELECT p.station_id AS stationId, p.ts, p.e5, p.e10, p.diesel, p.is_open AS isOpen
      FROM prices p JOIN stations s ON s.id = p.station_id
      WHERE s.tracked = 1 AND p.ts = (SELECT MAX(ts) FROM prices WHERE station_id = p.station_id)`).all();
  }

  hasPrices(stationId) {
    return Boolean(this.db.prepare('SELECT 1 FROM prices WHERE station_id = ? LIMIT 1').get(stationId));
  }

  prune(beforeTs) {
    this.db.prepare('DELETE FROM prices WHERE ts < ?').run(beforeTs);
  }
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}
