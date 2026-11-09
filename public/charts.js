// Kleine SVG-Diagramme ohne Abhängigkeiten: Linienverlauf mit Fadenkreuz und Balkenprofil.
const NS = 'http://www.w3.org/2000/svg';
const tooltip = () => document.getElementById('tooltip');

function s(tag, attrs = {}, text) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text != null) el.textContent = text;
  return el;
}

function showTip(x, y, title, rows) {
  const tip = tooltip();
  const titleEl = document.createElement('div');
  titleEl.className = 't-title';
  titleEl.textContent = title;
  tip.replaceChildren(titleEl, ...rows.map((r) => {
    const row = document.createElement('div');
    if (r.color) {
      const key = document.createElement('span');
      key.className = 'key';
      key.style.borderColor = r.color;
      row.append(key);
    }
    const strong = document.createElement('strong');
    strong.textContent = r.value;
    row.append(strong, r.label || '');
    return row;
  }));
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8))}px`;
  tip.style.top = `${Math.max(8, y - box.height - 12)}px`;
}
const hideTip = () => (tooltip().hidden = true);

function niceStep(span, target) {
  const raw = span / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  return [1, 2, 5, 10].map((m) => m * mag).find((st) => st >= raw);
}

function empty(container, message) {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = message;
  container.replaceChildren(p);
}

export function lineChart(container, { points, series, timeZone, days, format }) {
  const values = points.flatMap((p) => series.map((sr) => p[sr.key])).filter((v) => v != null);
  if (points.length < 2 || !values.length) return empty(container, 'Für diesen Zeitraum liegen noch zu wenige Messwerte vor.');

  const W = Math.max(320, container.clientWidth || 640);
  const H = 260;
  const m = { top: 12, right: 64, bottom: 28, left: 52 };
  const t0 = points[0].ts;
  const t1 = points.at(-1).ts;
  const step = niceStep(Math.max(0.02, Math.max(...values) - Math.min(...values)), 4);
  const y0 = Math.floor(Math.min(...values) / step) * step;
  const y1 = Math.ceil(Math.max(...values) / step) * step || y0 + step;
  const x = (ts) => m.left + ((ts - t0) / (t1 - t0)) * (W - m.left - m.right);
  const y = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * (H - m.top - m.bottom);

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Preisverlauf als Liniendiagramm; die Werte stehen in der Tabelle darunter.' });
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    svg.append(s('line', { class: 'grid', x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
    svg.append(s('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, v.toFixed(2).replace('.', ',')));
  }

  // X-Achse: bei kurzen Zeiträumen Uhrzeiten, sonst Tage
  const hourFmt = new Intl.DateTimeFormat('de-DE', { timeZone, hour: '2-digit', hourCycle: 'h23' });
  const dayFmt = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit' });
  const maxTicks = Math.floor((W - m.left - m.right) / 80);
  const ticks = points.filter((p) => {
    const hour = Number(hourFmt.format(p.ts * 1000).slice(0, 2));
    return days <= 2 ? hour % 6 === 0 : hour === 0;
  });
  const every = Math.ceil(ticks.length / Math.max(1, maxTicks));
  ticks.filter((_, i) => i % every === 0).forEach((p) => {
    const label = days <= 2 ? `${hourFmt.format(p.ts * 1000).slice(0, 2)} Uhr` : dayFmt.format(p.ts * 1000);
    svg.append(s('line', { class: 'axis', x1: x(p.ts), x2: x(p.ts), y1: H - m.bottom, y2: H - m.bottom + 4 }));
    svg.append(s('text', { x: x(p.ts), y: H - 8, 'text-anchor': 'middle' }, label));
  });
  svg.append(s('line', { class: 'axis', x1: m.left, x2: W - m.right, y1: H - m.bottom, y2: H - m.bottom }));

  const ends = [];
  for (const sr of series) {
    let d = '';
    let pen = false;
    let prevTs = 0;
    for (const p of points) {
      const v = p[sr.key];
      if (v == null) { pen = false; continue; }
      if (p.ts - prevTs > 3 * 3600) pen = false; // Datenlücken nicht überbrücken
      d += `${pen ? 'L' : 'M'}${x(p.ts).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
      prevTs = p.ts;
    }
    svg.append(s('path', { d, fill: 'none', stroke: sr.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    const last = points.findLast((p) => p[sr.key] != null);
    if (last) ends.push({ sr, y: y(last[sr.key]), value: last[sr.key], x: x(last.ts) });
  }
  // Direkte Beschriftung am Linienende; überlappende Labels auseinanderschieben
  ends.sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 14) ends[i].y = ends[i - 1].y + 14;
  for (const e of ends) {
    svg.append(s('circle', { cx: e.x, cy: y(e.value), r: 4, fill: e.sr.color, stroke: 'var(--surface)', 'stroke-width': 2 }));
    svg.append(s('text', { class: 'direct', x: W - m.right + 8, y: e.y + 4 }, e.value.toFixed(3).replace('.', ',')));
  }

  const hair = s('line', { class: 'hair', y1: m.top, y2: H - m.bottom, visibility: 'hidden' });
  const dots = series.map((sr) => s('circle', { r: 4, fill: sr.color, stroke: 'var(--surface)', 'stroke-width': 2, visibility: 'hidden' }));
  svg.append(hair, ...dots);
  const timeFmt = new Intl.DateTimeFormat('de-DE', { timeZone, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  svg.addEventListener('pointermove', (ev) => {
    const rect = svg.getBoundingClientRect();
    const ts = t0 + (((ev.clientX - rect.left) / rect.width) * W - m.left) / (W - m.left - m.right) * (t1 - t0);
    const p = points.reduce((a, b) => (Math.abs(b.ts - ts) < Math.abs(a.ts - ts) ? b : a));
    hair.setAttribute('x1', x(p.ts));
    hair.setAttribute('x2', x(p.ts));
    hair.setAttribute('visibility', 'visible');
    series.forEach((sr, i) => {
      const v = p[sr.key];
      dots[i].setAttribute('visibility', v == null ? 'hidden' : 'visible');
      if (v != null) { dots[i].setAttribute('cx', x(p.ts)); dots[i].setAttribute('cy', y(v)); }
    });
    showTip(ev.clientX, ev.clientY, `${timeFmt.format(p.ts * 1000)} Uhr`,
      series.filter((sr) => p[sr.key] != null).map((sr) => ({ color: sr.color, value: format(p[sr.key]), label: sr.label })));
  });
  svg.addEventListener('pointerleave', () => {
    hair.setAttribute('visibility', 'hidden');
    dots.forEach((dot) => dot.setAttribute('visibility', 'hidden'));
    hideTip();
  });
  container.replaceChildren(svg);
}

export function barChart(container, { bars, color, markIndex, format }) {
  const values = bars.map((b) => b.value).filter((v) => v != null);
  if (!values.length) return empty(container, 'Noch keine Daten.');

  const W = Math.max(320, container.clientWidth || 640);
  const H = 220;
  const m = { top: 12, right: 12, bottom: 28, left: 44 };
  const step = niceStep(Math.max(1, Math.max(...values, 0) - Math.min(...values, 0)), 4);
  const y0 = Math.floor(Math.min(...values, 0) / step) * step;
  const y1 = Math.ceil(Math.max(...values, 0) / step) * step;
  const band = (W - m.left - m.right) / bars.length;
  const y = (v) => m.top + (1 - (v - y0) / (y1 - y0)) * (H - m.top - m.bottom);
  const bw = Math.max(2, Math.min(24, band - 2));

  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Typische Preisabweichung je Uhrzeit als Balkendiagramm; die Werte stehen in der Tabelle darunter.' });
  for (let v = y0; v <= y1 + 1e-9; v += step) {
    svg.append(s('line', { class: 'grid', x1: m.left, x2: W - m.right, y1: y(v), y2: y(v) }));
    svg.append(s('text', { x: m.left - 8, y: y(v) + 4, 'text-anchor': 'end' }, `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}`));
  }
  bars.forEach((b, i) => {
    const cx = m.left + band * (i + 0.5);
    if (b.tick) svg.append(s('text', { x: cx, y: H - 8, 'text-anchor': 'middle' }, b.tick));
    if (b.value == null) return;
    const top = Math.min(y(b.value), y(0));
    const height = Math.max(1, Math.abs(y(b.value) - y(0)));
    const r = Math.min(4, bw / 2, height);
    // abgerundetes Datenende, gerade Kante an der Nulllinie
    const d = b.value >= 0
      ? `M${cx - bw / 2},${top + height}v${-(height - r)}q0,${-r} ${r},${-r}h${bw - 2 * r}q${r},0 ${r},${r}v${height - r}z`
      : `M${cx - bw / 2},${top}v${height - r}q0,${r} ${r},${r}h${bw - 2 * r}q${r},0 ${r},${-r}v${-(height - r)}z`;
    svg.append(s('path', { d, fill: color }));
    if (i === markIndex) {
      const edge = b.value >= 0 ? top - 5 : top + height + 5;
      svg.append(s('line', { class: 'now-bar', x1: cx - bw / 2, x2: cx + bw / 2, y1: edge, y2: edge }));
    }
    const hit = s('rect', { x: cx - band / 2, y: m.top, width: band, height: H - m.top - m.bottom, fill: 'transparent', tabindex: 0 });
    const show = (ev) => {
      const rect = hit.getBoundingClientRect();
      showTip(ev.clientX ?? rect.left + rect.width / 2, ev.clientY ?? rect.top, b.label + (i === markIndex ? ' (jetzt)' : ''), [{ value: format(b.value), label: 'ggü. Tagesmittel' }]);
    };
    hit.addEventListener('pointermove', show);
    hit.addEventListener('focus', show);
    hit.addEventListener('pointerleave', hideTip);
    hit.addEventListener('blur', hideTip);
    svg.append(hit);
  });
  svg.append(s('line', { class: 'axis', x1: m.left, x2: W - m.right, y1: y(0), y2: y(0) }));
  container.replaceChildren(svg);
}
