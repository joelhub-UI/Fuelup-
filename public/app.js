import { lineChart, barChart } from './charts.js';

const $ = (id) => document.getElementById(id);
const FUEL_NAMES = { e5: 'Super E5', e10: 'Super E10', diesel: 'Diesel' };
const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const TANK_LITERS = 50;

const state = {
  fuel: localStorage.getItem('fuel') || 'e5',
  range: 7,
  data: null,
  ai: {}, // KI-Ergebnis je Kraftstoff
};

// ---------- Hilfsfunktionen ----------
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c);
  return el;
}
function key(color) {
  const el = h('span', { class: 'key' });
  el.style.borderColor = color; // per Skript gesetzt, damit die Content-Security-Policy keine Inline-Styles braucht
  return el;
}
const eur = (v, digits = 3) => (v == null ? '–' : `${v.toFixed(digits).replace('.', ',')} €`);
const ct = (v, sign = false) => (v == null ? '–' : `${sign && v > 0 ? '+' : ''}${v.toFixed(1).replace('.', ',').replace('-', '−')} ct`);
const km = (v) => (v == null ? '–' : `${v.toFixed(1).replace('.', ',')} km`);
const fmt = (opts) => new Intl.DateTimeFormat('de-DE', { timeZone: state.data?.timeZone, ...opts });
const time = (ts) => fmt({ hour: '2-digit', minute: '2-digit' }).format(ts * 1000);
const dayTime = (ts) => fmt({ weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(ts * 1000);

async function api(path, options) {
  let res;
  try {
    res = await fetch(path, options);
  } catch {
    throw new Error('Der FuelUp-Server ist nicht erreichbar.');
  }
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    location.href = '/login.html';
    throw new Error('Bitte anmelden.');
  }
  if (!res.ok) throw new Error(body.error || `Fehler ${res.status}`);
  return body;
}

function showError(message) {
  $('error').textContent = message || '';
  $('error').hidden = !message;
}

async function busy(button, fn) {
  button.disabled = true;
  showError('');
  try {
    await fn();
  } catch (err) {
    showError(err.message);
  } finally {
    button.disabled = false;
  }
}

// ---------- Darstellung ----------
function windowText(w) {
  const sameDay = fmt({ day: '2-digit' }).format(w.startTs * 1000) === fmt({ day: '2-digit' }).format(state.data.now * 1000);
  return `${sameDay ? 'heute' : 'morgen'} zwischen ${time(w.startTs)} und ${time(w.endTs)} Uhr`;
}

function tile(value, label) {
  return h('div', { class: 'tile' }, h('div', { class: 'value', text: value }), h('div', { class: 'label', text: label }));
}

function renderReco(d) {
  const a = d.analysis;
  const r = a.recommendation;
  const headline = { now: 'Jetzt tanken', unknown: 'Noch keine Empfehlung möglich' }[r.action]
    ?? `Besser warten – ${windowText(r.window)} tanken`;
  $('reco-headline').textContent = headline;

  const tiles = [tile(eur(a.current), `${d.brandLabel ? `${d.brandLabel}-Durchschnitt` : 'Durchschnitt aller Marken'} jetzt (${FUEL_NAMES[d.fuel]})`)];
  if (r.action === 'wait') {
    tiles.push(tile(eur(r.window.expectedPrice), 'erwarteter Preis im Zeitfenster'));
    tiles.push(tile(`${ct(r.savingCt)}/l`, `Ersparnis, ca. ${eur((r.savingCt * TANK_LITERS) / 100, 2)} bei ${TANK_LITERS} l`));
  } else if (a.weekStats) {
    tiles.push(tile(`${eur(a.weekStats.min)} – ${eur(a.weekStats.max)}`, 'Spanne der letzten 7 Tage'));
  }
  tiles.push(tile(r.confidence, a.profileSource === 'prior'
    ? 'Verlässlichkeit – noch kaum eigene Daten'
    : `Verlässlichkeit – ${a.dataDays} vollständige Tage Historie`));
  $('reco-tiles').replaceChildren(...tiles);
  $('reco-reasons').replaceChildren(...r.reasons.map((text) => h('li', { text })));

  const ai = state.ai[d.fuel];
  $('ai-run').hidden = !d.aiEnabled;
  $('ai-run').textContent = ai ? 'KI-Analyse erneuern' : 'KI-Analyse starten';
  $('ai-hint').textContent = d.aiEnabled
    ? (ai ? '' : 'Claude bewertet aktuelle Preise, Historie und Prognose und begründet die Empfehlung.')
    : 'Nicht aktiv: Für die KI-Analyse die Variable ANTHROPIC_API_KEY setzen – beim Hosting in den Variablen des Anbieters, auf dem eigenen Rechner in der Datei .env. Die Empfehlung oben beruht auf der statistischen Auswertung.';
  $('ai-result').hidden = !ai;
  if (ai) {
    const station = d.stations.find((s) => s.id === ai.station_id);
    $('ai-headline').textContent = ai.headline;
    $('ai-reasoning').textContent = ai.reasoning;
    $('ai-caveats').replaceChildren(...ai.caveats.map((text) => h('li', { text })));
    const parts = [];
    if (ai.window_start && ai.window_end) parts.push(`Zeitfenster: ${dayTime(Date.parse(ai.window_start) / 1000)} – ${time(Date.parse(ai.window_end) / 1000)} Uhr`);
    if (ai.expected_saving_ct > 0) parts.push(`Ersparnis: ca. ${ct(ai.expected_saving_ct)}/l`);
    if (station) parts.push(`Station: ${station.name}`);
    if (ai.demo) parts.unshift('Beruht auf simulierten Demo-Daten, nicht auf echten Preisen');
    parts.push(`Verlässlichkeit: ${ai.confidence}`, `erstellt ${time(ai.generatedAt)} Uhr mit ${ai.model}`);
    $('ai-meta').textContent = parts.join(' · ');
  }
}

function renderStations(d) {
  const table = $('stations');
  $('stations-title').textContent = d.brandLabel ? `${d.brandLabel}-Stationen im Umkreis` : 'Alle Tankstellen im Umkreis';
  const open = d.stations.filter((s) => s.price != null);
  const best = open.reduce((a, b) => (!a || b.price < a.price ? b : a), null);
  const sorted = [...d.stations].sort((a, b) => (a.price ?? 99) - (b.price ?? 99) || a.distKm - b.distKm);

  if (!sorted.length) {
    table.replaceChildren(h('caption', { text: 'Im gewählten Umkreis wurde keine Tankstelle gefunden. Vergrößere den Umkreis.' }));
  } else {
    table.replaceChildren(
      h('thead', {}, h('tr', {},
        h('th', { text: 'Station' }), h('th', { class: 'num', text: 'Entfernung' }),
        h('th', { class: 'num', text: `Preis ${FUEL_NAMES[d.fuel]}` }), h('th', { class: 'num', text: 'zur günstigsten' }),
        h('th', { class: 'num', title: 'Durchschnittliche Abweichung vom Mittel der angezeigten Stationen, letzte 14 Tage', text: 'üblich' }),
        h('th', { text: '' }))),
      h('tbody', {}, sorted.map((s) => h('tr', { class: s === best ? 'best' : '' },
        h('td', {}, s.name, s === best ? h('span', { class: 'badge', text: 'günstigste' }) : null,
          s.isOpen === false ? h('span', { class: 'badge', text: 'geschlossen' }) : null,
          h('span', { class: 'sub' }, h('span', { class: 'only-mobile', text: `${km(s.distKm)} · ` }), d.brand ? s.address : `${s.brand || 'ohne Marke'} · ${s.address}`)),
        h('td', { class: 'num', text: km(s.distKm) }),
        h('td', { class: 'num price', text: eur(s.price) }),
        h('td', { class: 'num', text: s.price == null || s === best ? '–' : ct((s.price - best.price) * 100, true) }),
        h('td', { class: 'num', text: ct(s.avgOffsetCt, true) }),
        h('td', {}, h('a', { href: `https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`, target: '_blank', rel: 'noopener', text: 'Route' }))))),
    );
  }

  const area = d.area;
  let text = '';
  if (d.brand && area.count && best) {
    const diff = (best.price - area.avgPrice) * 100;
    text = `Zum Vergleich: ${area.count} Tankstellen anderer Marken kosten im Schnitt ${eur(area.avgPrice)}`
      + ` – die günstigste ${d.brandLabel}-Station liegt ${Math.abs(diff) < 0.05 ? 'gleichauf' : `${ct(Math.abs(diff))} ${diff > 0 ? 'darüber' : 'darunter'}`}.`
      + ` Am günstigsten ist ${area.cheapest.brand || area.cheapest.name} mit ${eur(area.cheapest.price)} (${km(area.cheapest.distKm)}).`;
  }
  $('area').textContent = text;
}

function renderCharts(d) {
  const a = d.analysis;
  const since = d.now - state.range * 86400;
  const points = a.series.filter((p) => p.ts >= since);
  const series = [
    { key: 'focus', label: d.brandLabel || 'Alle Marken', color: 'var(--series-1)' },
    { key: 'area', label: 'Andere Marken', color: 'var(--series-2)' },
  ].filter((s) => points.some((p) => p[s.key] != null));
  $('legend').replaceChildren(...series.map((s) => h('span', {}, key(s.color), s.label)));
  lineChart($('chart-history'), { points, series, timeZone: d.timeZone, days: state.range, format: eur });
  $('table-history').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { text: 'Zeit' }), series.map((s) => h('th', { class: 'num', text: s.label })))),
    h('tbody', {}, points.slice(-200).reverse().map((p) => h('tr', {},
      h('td', { text: dayTime(p.ts) }), series.map((s) => h('td', { class: 'num', text: eur(p[s.key]) }))))));

  $('profile-title').textContent = d.brandLabel ? `Typischer Tagesverlauf bei ${d.brandLabel}` : 'Typischer Tagesverlauf (alle Marken)';
  const nowHour = Number(fmt({ hour: '2-digit', hourCycle: 'h23' }).format(d.now * 1000).slice(0, 2));
  $('profile-note').textContent = (a.profileSource === 'prior'
    ? 'Erfahrungswert für deutsche Tankstellen – wird durch eigene Messwerte ersetzt, sobald 3 vollständige Tage gesammelt sind.'
    : `Gemessen an ${a.dataDays} vollständigen Tagen.`)
    + ' Abweichung vom Tagesmittel in Cent pro Liter; der Strich markiert die aktuelle Stunde.';
  barChart($('chart-profile'), {
    bars: a.profile.map((p) => ({ label: `${p.hour} Uhr`, tick: p.hour % 3 === 0 ? String(p.hour) : '', value: p.devCt })),
    color: 'var(--series-1)', markIndex: nowHour, format: (v) => `${ct(v, true)}/l`,
  });
  $('table-profile').replaceChildren(
    h('thead', {}, h('tr', {}, h('th', { text: 'Uhrzeit' }), h('th', { class: 'num', text: 'Abweichung vom Tagesmittel' }))),
    h('tbody', {}, a.profile.map((p) => h('tr', {}, h('td', { text: `${p.hour}–${p.hour + 1} Uhr` }), h('td', { class: 'num', text: ct(p.devCt, true) })))));

  const wp = a.weekdayProfile;
  if (wp) {
    const lo = wp.reduce((x, y) => (y.devCt < x.devCt ? y : x));
    const hi = wp.reduce((x, y) => (y.devCt > x.devCt ? y : x));
    $('weekday-note').textContent = `Wochentage: Am günstigsten ist im Schnitt der ${WEEKDAYS[lo.weekday]} (${ct(lo.devCt, true)}), am teuersten der ${WEEKDAYS[hi.weekday]} (${ct(hi.devCt, true)}).`;
  } else {
    $('weekday-note').textContent = 'Ein Wochentagsvergleich erscheint, sobald mindestens 14 vollständige Tage gesammelt sind.';
  }
}

function render() {
  const d = state.data;
  if (!d) return;
  $('demo-banner').hidden = !d.demo;
  const hasLocation = Boolean(d.location);
  $('empty').hidden = hasLocation;
  $('content').hidden = !hasLocation;
  document.querySelectorAll('[data-fuel]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.fuel === state.fuel)));
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.range) === state.range)));
  if (!hasLocation) return;
  $('rad').value = String(d.location.rad);
  $('brand-field').hidden = false;
  $('brand').replaceChildren(
    h('option', { value: '', text: `Alle Marken (${d.brands.reduce((n, b) => n + b.count, 0)})` }),
    ...d.brands.map((b) => h('option', { value: b.key, text: `${b.label} (${b.count})` })));
  $('brand').value = d.brand || '';
  $('location-label').textContent = `Standort: ${d.location.label || `${d.location.lat.toFixed(4)}, ${d.location.lng.toFixed(4)}`} · ${d.location.rad} km`;
  renderReco(d);
  renderStations(d);
  renderCharts(d);
  $('logout').hidden = !d.authRequired;
  $('updated').textContent = (d.lastPoll ? `Letzte Preisabfrage: ${dayTime(d.lastPoll)} Uhr · automatische Abfrage alle ${d.pollMinutes} Minuten.` : '')
    + (d.lastPollError ? ` Letzter Abruf fehlgeschlagen: ${d.lastPollError}` : '');
}

// ---------- Aktionen ----------
async function load() {
  state.data = await api(`/api/overview?fuel=${state.fuel}`);
  render();
}

async function setLocation(lat, lng, label) {
  state.ai = {};
  state.data = await api(`/api/location?fuel=${state.fuel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, rad: Number($('rad').value), label }),
  });
  $('geo-results').hidden = true;
  render();
}

$('search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('q').value.trim();
  if (!q) return;
  busy(e.submitter || $('locate'), async () => {
    const results = await api(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!results.length) throw new Error('Kein Ort gefunden.');
    if (results.length === 1) return setLocation(results[0].lat, results[0].lng, results[0].label);
    $('geo-results').replaceChildren(...results.map((r) => h('li', {},
      h('button', { type: 'button', text: r.label, onclick: (ev) => busy(ev.currentTarget, () => setLocation(r.lat, r.lng, r.label)) }))));
    $('geo-results').hidden = false;
  });
});

$('locate').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  if (!navigator.geolocation) throw new Error('Dein Browser unterstützt keine Standortbestimmung.');
  const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 15000 }))
    .catch(() => { throw new Error('Der Standort konnte nicht bestimmt werden – bitte Ort oder Postleitzahl eingeben.'); });
  await setLocation(pos.coords.latitude, pos.coords.longitude, 'Mein Standort');
}));

$('brand').addEventListener('change', (e) => busy(e.currentTarget, async () => {
  state.ai = {};
  state.data = await api(`/api/brand?fuel=${state.fuel}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ brand: e.target.value || null }),
  });
  render();
}));

$('rad').addEventListener('change', (e) => {
  const loc = state.data?.location;
  if (loc) busy(e.currentTarget, () => setLocation(loc.lat, loc.lng, loc.label));
});

document.querySelectorAll('[data-fuel]').forEach((b) => b.addEventListener('click', () => busy(b, async () => {
  state.fuel = b.dataset.fuel;
  localStorage.setItem('fuel', state.fuel);
  await load();
})));

document.querySelectorAll('[data-range]').forEach((b) => b.addEventListener('click', () => {
  state.range = Number(b.dataset.range);
  render();
}));

$('refresh').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const d = await api(`/api/refresh?fuel=${state.fuel}`, { method: 'POST' });
  state.data = d;
  render();
  if (!d.refreshed) showError('Die Preise wurden vor weniger als 5 Minuten abgerufen – häufiger erlaubt die Tankerkönig-API keine Abfragen.');
}));

$('ai-run').addEventListener('click', (e) => busy(e.currentTarget, async () => {
  const fuel = state.fuel;
  $('ai-hint').textContent = 'Claude analysiert die Daten – das kann einen Moment dauern …';
  try {
    state.ai[fuel] = await api(`/api/ai?fuel=${fuel}`, { method: 'POST' });
  } finally {
    render();
  }
}));

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login.html';
});

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => state.data?.location && renderCharts(state.data), 150);
});
setInterval(() => load().catch(() => {}), 5 * 60 * 1000);
load().catch((err) => showError(err.message));

const tick = () => ($('clock').textContent = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' }).format(new Date()));
tick();
setInterval(tick, 15000);
