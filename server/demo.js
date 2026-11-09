// Demo-Modus: simulierte Tankstellen und Preise, damit die App ohne API-Key
// ausprobiert werden kann. Die Preise sind eine reine Funktion von Station und
// Zeit, dadurch passen "Live"-Werte und nachträglich erzeugte Historie zusammen.
import { localParts } from './time.js';

const TEMPLATES = [
  ['Shell', 'Hauptstraße', 0.6, 0.012], ['Aral', 'Bahnhofstraße', 0.9, 0.018],
  ['Shell', 'Berliner Allee', 1.4, -0.004], ['JET', 'Industriestraße', 1.7, -0.035],
  ['TotalEnergies', 'Am Markt', 2.1, 0.004], ['Shell', 'Ringstraße', 2.6, 0.022],
  ['Esso', 'Kölner Straße', 3.0, 0.008], ['Shell', 'An der Autobahn', 3.8, 0.041],
  ['HEM', 'Gewerbepark', 4.2, -0.03], ['Shell', 'Schillerstraße', 4.7, 0.002],
  ['Aral', 'Nordring', 5.5, 0.015], ['Shell', 'Südtangente', 7.5, -0.012],
  ['star', 'Feldweg', 9.0, -0.025], ['Shell', 'Flughafenstraße', 14.0, 0.03],
];
const BASE = { e5: 1.789, e10: 1.729, diesel: 1.639 };

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export function demoStations({ lat, lng, rad }) {
  return TEMPLATES.filter((t) => t[2] <= rad).map(([brand, street, dist], i) => {
    const angle = hash(`a${i}`) * 2 * Math.PI;
    return {
      id: `demo-${i}`,
      name: `${brand} Station ${street} (Demo)`,
      brand,
      street,
      houseNumber: String(1 + Math.floor(hash(`h${i}`) * 120)),
      postCode: '00000',
      place: 'Demostadt',
      lat: lat + (dist / 111) * Math.cos(angle),
      lng: lng + (dist / (111 * Math.cos((lat * Math.PI) / 180))) * Math.sin(angle),
      dist,
      isOpen: true,
    };
  });
}

// Typischer Tagesgang: morgens am teuersten, danach in Wellen fallend, abends am günstigsten.
function dailyCycle(hour) {
  const morning = 0.06 * Math.exp(-((hour - 7) ** 2) / 5);
  const night = hour >= 23 || hour < 5 ? 0.045 : 0;
  const evening = -0.035 * Math.exp(-((hour - 19.5) ** 2) / 6);
  const sawtooth = hour >= 9 && hour < 22 ? 0.012 * (1 - (hour % 3) / 3) : 0;
  return morning + night + evening + sawtooth;
}

export function demoPrice(stationId, fuel, ts, timeZone) {
  const idx = Number(stationId.split('-')[1]);
  const offset = TEMPLATES[idx]?.[3] ?? 0;
  const { hour, minute, weekday } = localParts(ts, timeZone);
  const weekdayEffect = [0.008, 0.004, -0.004, -0.002, 0.006, 0.012, 0.01][weekday]; // So..Sa
  const drift = 0.02 * Math.sin(ts / 86400 / 9);
  const noise = (hash(`${stationId}:${Math.floor(ts / 1800)}`) - 0.5) * 0.02;
  const raw = BASE[fuel] + offset + dailyCycle(hour + minute / 60) + weekdayEffect + drift + noise;
  return Math.round(raw * 100) / 100 + 0.009;
}

export function demoSample(stationId, ts, timeZone) {
  return {
    stationId,
    ts,
    isOpen: true,
    e5: demoPrice(stationId, 'e5', ts, timeZone),
    e10: demoPrice(stationId, 'e10', ts, timeZone),
    diesel: demoPrice(stationId, 'diesel', ts, timeZone),
  };
}

/** Rückwirkende Historie (Standard: 21 Tage, alle 30 Minuten) für eine Demo-Station. */
export function demoHistory(stationId, nowTs, timeZone, days = 21) {
  const out = [];
  const start = Math.floor((nowTs - days * 86400) / 1800) * 1800;
  for (let ts = start; ts < nowTs; ts += 1800) out.push(demoSample(stationId, ts, timeZone));
  return out;
}
