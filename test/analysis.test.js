import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, hourlySeries } from '../server/analysis.js';
import { localParts } from '../server/time.js';

const TZ = 'Europe/Berlin';
const HOUR = 3600;
const NOW = Date.UTC(2026, 10, 9, 9, 30) / 1000; // Mo, 10:30 Uhr in Berlin

// Abends (18–20 Uhr) 4 ct günstiger, morgens (6–8 Uhr) 5 ct teurer
function price(ts, base = 1.8) {
  const { hour } = localParts(ts, TZ);
  if (hour >= 18 && hour <= 20) return base - 0.04;
  if (hour >= 6 && hour <= 8) return base + 0.05;
  return base;
}

function rows(days, fn = price, end = NOW) {
  const out = [];
  for (let ts = end - days * 24 * HOUR; ts <= end; ts += HOUR / 2) {
    out.push({ stationId: 'a', ts, price: fn(ts), isFocus: 1 });
    out.push({ stationId: 'b', ts, price: fn(ts) + 0.02, isFocus: 1 });
    out.push({ stationId: 'x', ts, price: fn(ts) - 0.03, isFocus: 0 });
  }
  return out;
}

test('hourlySeries mittelt Shell und andere Marken getrennt', () => {
  const series = hourlySeries([
    { stationId: 'a', ts: 7200, price: 1.8, isFocus: 1 },
    { stationId: 'a', ts: 9000, price: 1.9, isFocus: 1 },
    { stationId: 'b', ts: 7300, price: 1.75, isFocus: 1 },
    { stationId: 'x', ts: 7400, price: 1.7, isFocus: 0 },
  ]);
  assert.equal(series.length, 1);
  assert.ok(Math.abs(series[0].focus - 1.8) < 1e-9); // (1,85 + 1,75) / 2
  assert.equal(series[0].area, 1.7);
});

test('erkennt das Abendtief und empfiehlt zu warten', () => {
  const a = analyze(rows(10), { now: NOW, timeZone: TZ });
  assert.equal(a.profileSource, 'history');
  assert.ok(a.dataDays >= 9);
  assert.equal(a.recommendation.action, 'wait');
  assert.equal(a.window.startHour, 18);
  assert.equal(a.window.endHour, 21);
  assert.ok(Math.abs(a.recommendation.savingCt - 4) < 0.2);
  assert.equal(a.recommendation.confidence, 'hoch');
  assert.ok(Math.abs(a.stationOffsets.a + 1) < 0.01);
  assert.ok(Math.abs(a.stationOffsets.b - 1) < 0.01);
});

test('empfiehlt jetzt zu tanken, wenn gerade das Tagestief ist', () => {
  const now = Date.UTC(2026, 10, 9, 18, 30) / 1000; // 19:30 Uhr in Berlin
  const a = analyze(rows(10, price, now), { now, timeZone: TZ });
  assert.equal(a.recommendation.action, 'now');
  assert.equal(a.recommendation.window, null);
});

test('nutzt mit wenig Historie den Erfahrungswert und kennzeichnet ihn', () => {
  const a = analyze(rows(1), { now: NOW, timeZone: TZ });
  assert.equal(a.profileSource, 'prior');
  assert.equal(a.recommendation.confidence, 'niedrig');
  assert.ok(a.recommendation.reasons.some((r) => r.includes('typische Tagesmuster')));
});

test('ohne aktuelle Preise gibt es keine Empfehlung', () => {
  const a = analyze(rows(5), { now: NOW + 6 * HOUR, timeZone: TZ });
  assert.equal(a.current, null);
  assert.equal(a.recommendation.action, 'unknown');
  assert.equal(analyze([], { now: NOW, timeZone: TZ }).recommendation.action, 'unknown');
});

test('Trend und Wochentagsprofil', () => {
  const rising = (ts) => price(ts) + ((ts - NOW) / 86400) * 0.01; // +1 ct pro Tag
  const a = analyze(rows(20, rising), { now: NOW, timeZone: TZ });
  assert.ok(Math.abs(a.trendCtPerDay - 1) < 0.05);
  assert.equal(a.weekdayProfile.length, 7);
});

test('ohne Vergleichsgruppe (alle Marken gewählt) bleibt der Vergleichswert leer', () => {
  const all = rows(5).map((r) => ({ ...r, isFocus: 1 }));
  const a = analyze(all, { now: NOW, timeZone: TZ });
  assert.equal(a.currentArea, null);
  assert.ok(a.series.every((p) => p.area == null));
  assert.ok(a.current > 0);
});
