// Statistische Auswertung der gesammelten Preishistorie.
// Preise in Euro, Abweichungen und Ersparnisse in Cent pro Liter.
import { localParts } from './time.js';

const HOUR = 3600;
const DAY = 86400;
const MIN_HOURS_PER_DAY = 18; // ab so vielen Stundenwerten zählt ein Tag als vollständig
const MIN_DAYS_FOR_PROFILE = 3;
const WAIT_THRESHOLD_CT = 1.5;

// Grober Erfahrungswert für den Tagesgang deutscher Tankstellen (morgens am
// teuersten, abends am günstigsten). Wird nur genutzt, solange noch nicht genug
// eigene Messwerte vorliegen, und in der Ausgabe als solcher gekennzeichnet.
export const PRIOR_PROFILE_CT = [
  2.5, 2.5, 2.5, 2.5, 2.5, 3.5, 5, 5.5, 3.5, 1.5, 0.5, -0.5,
  0.5, -0.5, -1, -1.5, -1, -2, -3, -3.5, -3.5, -3, -1, 1.5,
];

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x, digits = 1) => (x == null ? null : Math.round(x * 10 ** digits) / 10 ** digits);

/** Fasst Einzelmessungen zu Stundenwerten zusammen (Mittel über Shell- bzw. übrige Stationen). */
export function hourlySeries(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const key = Math.floor(r.ts / HOUR);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = new Map()));
    let s = b.get(r.stationId);
    if (!s) b.set(r.stationId, (s = { sum: 0, n: 0, isShell: Boolean(r.isShell) }));
    s.sum += r.price;
    s.n += 1;
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, stations]) => {
      const shell = [];
      const area = [];
      const byStation = {};
      for (const [id, s] of stations) {
        const avg = s.sum / s.n;
        (s.isShell ? shell : area).push(avg);
        if (s.isShell) byStation[id] = avg;
      }
      return {
        ts: key * HOUR,
        shell: shell.length ? mean(shell) : null,
        area: area.length ? mean(area) : null,
        byStation,
      };
    });
}

function completeDays(series, timeZone) {
  const days = new Map();
  for (const p of series) {
    if (p.shell == null) continue;
    const { day, hour, weekday } = localParts(p.ts, timeZone);
    let d = days.get(day);
    if (!d) days.set(day, (d = { day, weekday, ts: p.ts, points: [] }));
    d.points.push({ hour, price: p.shell });
  }
  return [...days.values()]
    .filter((d) => d.points.length >= MIN_HOURS_PER_DAY)
    .map((d) => ({ ...d, mean: mean(d.points.map((p) => p.price)) }));
}

/** Mittlere Abweichung vom Tagesmittel je Stunde (Cent). */
function hourProfile(days) {
  const acc = Array.from({ length: 24 }, () => []);
  for (const d of days) for (const p of d.points) acc[p.hour].push((p.price - d.mean) * 100);
  const minN = Math.max(2, Math.ceil(days.length * 0.4));
  return acc.map((xs, hour) => ({
    hour,
    devCt: xs.length >= minN ? mean(xs) : null,
    n: xs.length,
  }));
}

function weekdayProfile(days) {
  if (days.length < 14) return null;
  const acc = Array.from({ length: 7 }, () => []);
  for (const d of days) {
    const near = days.filter((o) => Math.abs(o.ts - d.ts) <= 3.5 * DAY);
    if (near.length < 5) continue;
    acc[d.weekday].push((d.mean - mean(near.map((o) => o.mean))) * 100);
  }
  if (acc.some((xs) => xs.length < 2)) return null;
  return acc.map((xs, weekday) => ({ weekday, devCt: round(mean(xs), 2), n: xs.length }));
}

function trendCtPerDay(days) {
  const recent = days.slice(-7);
  if (recent.length < 4) return null;
  const xs = recent.map((d) => d.ts / DAY);
  const ys = recent.map((d) => d.mean * 100);
  const mx = mean(xs);
  const my = mean(ys);
  const denom = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  if (!denom) return null;
  return xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / denom;
}

function stationOffsets(series, now) {
  const acc = {};
  for (const p of series) {
    if (p.ts < now - 14 * DAY || p.shell == null) continue;
    for (const [id, price] of Object.entries(p.byStation)) (acc[id] ||= []).push((price - p.shell) * 100);
  }
  const out = {};
  for (const [id, xs] of Object.entries(acc)) if (xs.length >= 12) out[id] = round(mean(xs), 1);
  return out;
}

function forecast(current, profile, now, timeZone) {
  const dev = (ts) => profile[localParts(ts, timeZone).hour].devCt;
  const base = dev(now);
  if (current == null || base == null) return [];
  const startOfHour = Math.floor(now / HOUR) * HOUR;
  const out = [];
  for (let i = 0; i <= 24; i++) {
    const ts = i === 0 ? now : startOfHour + i * HOUR;
    const d = dev(ts);
    if (d == null) continue; // zu dieser Stunde liegen kaum Preise vor (z. B. nachts geschlossen)
    out.push({ ts, hour: localParts(ts, timeZone).hour, expected: i === 0 ? current : current + (d - base) / 100 });
  }
  return out;
}

function bestWindow(fc) {
  const future = fc.slice(1);
  if (!future.length) return null;
  let best = 0;
  for (let i = 1; i < future.length; i++) if (future[i].expected < future[best].expected - 1e-9) best = i;
  const limit = future[best].expected + 0.005;
  let lo = best;
  let hi = best;
  while (lo > 0 && future[lo - 1].expected <= limit && future[lo].ts - future[lo - 1].ts === HOUR) lo--;
  while (hi < future.length - 1 && future[hi + 1].expected <= limit && future[hi + 1].ts - future[hi].ts === HOUR) hi++;
  return {
    startTs: future[lo].ts,
    endTs: future[hi].ts + HOUR,
    startHour: future[lo].hour,
    endHour: (future[hi].hour + 1) % 24,
    expectedPrice: future[best].expected,
  };
}

/**
 * @param rows  Messwerte [{ stationId, ts, price, isShell }] für eine Kraftstoffsorte
 * @param opts  { now (Unix-Sekunden), timeZone }
 */
export function analyze(rows, { now, timeZone }) {
  const series = hourlySeries(rows);
  const days = completeDays(series, timeZone);
  const ownProfile = days.length >= MIN_DAYS_FOR_PROFILE;
  const profile = ownProfile
    ? hourProfile(days)
    : PRIOR_PROFILE_CT.map((devCt, hour) => ({ hour, devCt, n: 0 }));

  const shellPoints = series.filter((p) => p.shell != null);
  const last = shellPoints.at(-1);
  const current = last && now - last.ts <= 2 * HOUR ? last.shell : null;
  const currentArea = last && last.area != null && current != null ? last.area : null;

  const week = shellPoints.filter((p) => p.ts >= now - 7 * DAY).map((p) => p.shell);
  const weekStats = week.length >= 24
    ? {
        min: Math.min(...week),
        max: Math.max(...week),
        mean: mean(week),
        // Anteil der Stundenwerte der letzten 7 Tage, die günstiger waren als jetzt
        cheaperShare: current == null ? null : week.filter((x) => x < current - 1e-9).length / week.length,
      }
    : null;

  const fc = forecast(current, profile, now, timeZone);
  const window = bestWindow(fc);
  const analysis = {
    dataDays: days.length,
    samples: rows.length,
    profileSource: ownProfile ? 'history' : 'prior',
    profile: profile.map((p) => ({ ...p, devCt: round(p.devCt, 2) })),
    weekdayProfile: weekdayProfile(days),
    trendCtPerDay: round(trendCtPerDay(days), 2),
    current,
    currentArea,
    weekStats,
    forecast: fc,
    window,
    stationOffsets: stationOffsets(series, now),
    series: series.map(({ ts, shell, area }) => ({ ts, shell: round(shell, 4), area: round(area, 4) })),
  };
  analysis.recommendation = recommend(analysis);
  return analysis;
}

/** Regelbasierte Empfehlung – dient auch als Rückfall, wenn keine KI verfügbar ist. */
export function recommend(a) {
  if (a.current == null || !a.window) {
    return { action: 'unknown', confidence: 'niedrig', savingCt: null, window: null, reasons: ['Es liegen noch keine aktuellen Preise vor.'] };
  }
  const savingCt = round((a.current - a.window.expectedPrice) * 100, 1);
  const cheap = a.weekStats?.cheaperShare != null && a.weekStats.cheaperShare <= 0.1;
  const reasons = [];
  let action = savingCt >= WAIT_THRESHOLD_CT ? 'wait' : 'now';

  if (action === 'wait' && cheap && savingCt < 3) {
    action = 'now';
    reasons.push('Der aktuelle Preis gehört zu den günstigsten 10 % der letzten 7 Tage.');
  } else if (action === 'wait') {
    reasons.push(`Zwischen ${a.window.startHour} und ${a.window.endHour} Uhr ist der Preis erfahrungsgemäß rund ${savingCt.toFixed(1).replace('.', ',')} ct/l niedriger als jetzt.`);
  } else {
    reasons.push('In den nächsten 24 Stunden ist kein nennenswert günstigerer Zeitpunkt zu erwarten.');
    if (cheap) reasons.push('Der aktuelle Preis gehört zu den günstigsten 10 % der letzten 7 Tage.');
  }
  if (a.trendCtPerDay != null && Math.abs(a.trendCtPerDay) >= 0.3) {
    reasons.push(`Das Preisniveau ${a.trendCtPerDay > 0 ? 'steigt' : 'fällt'} derzeit um etwa ${Math.abs(a.trendCtPerDay).toFixed(1).replace('.', ',')} ct pro Tag.`);
  }
  if (a.profileSource === 'prior') {
    reasons.push('Grundlage ist bisher nur das typische Tagesmuster deutscher Tankstellen – eigene Messwerte werden noch gesammelt.');
  }
  const confidence = a.profileSource === 'prior' ? 'niedrig' : a.dataDays >= 7 ? 'hoch' : 'mittel';
  return {
    action,
    confidence,
    savingCt: action === 'wait' ? savingCt : 0,
    window: action === 'wait' ? a.window : null,
    reasons,
  };
}
