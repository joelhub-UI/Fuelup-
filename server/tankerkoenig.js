// Anbindung an die Tankerkönig-API (Echtzeit-Preise der Markttransparenzstelle
// für Kraftstoffe, Lizenz CC BY 4.0) – https://creativecommons.tankerkoenig.de
import { config } from './config.js';

async function call(endpoint, params) {
  const url = new URL(`${config.tankerkoenigBase}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  url.searchParams.set('apikey', config.tankerkoenigKey);
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (err) {
    throw new Error(`Tankerkönig nicht erreichbar: ${err.cause?.code || err.message}`);
  }
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error(`Tankerkönig antwortete mit HTTP ${res.status}`);
  }
  if (!body.ok) throw new Error(`Tankerkönig: ${body.message || 'unbekannter Fehler'}`);
  return body;
}

const price = (v) => (typeof v === 'number' && v > 0 ? v : null);

/** Umkreissuche: alle Tankstellen mit aktuellen Preisen, nach Entfernung sortiert. */
export async function listStations({ lat, lng, rad }) {
  const body = await call('list.php', { lat, lng, rad, sort: 'dist', type: 'all' });
  return (body.stations || []).map((s) => ({
    id: s.id,
    name: s.name,
    brand: s.brand,
    street: s.street,
    houseNumber: s.houseNumber,
    postCode: s.postCode,
    place: s.place,
    lat: s.lat,
    lng: s.lng,
    dist: s.dist,
    isOpen: Boolean(s.isOpen),
    e5: price(s.e5),
    e10: price(s.e10),
    diesel: price(s.diesel),
  }));
}

/** Aktuelle Preise für bekannte Stationen (max. 10 IDs pro Abfrage). */
export async function fetchPrices(ids) {
  const out = [];
  for (let i = 0; i < ids.length; i += 10) {
    const chunk = ids.slice(i, i + 10);
    const body = await call('prices.php', { ids: chunk.join(',') });
    for (const id of chunk) {
      const p = body.prices?.[id];
      if (!p || p.status === 'no prices') continue;
      out.push({
        stationId: id,
        isOpen: p.status === 'open',
        e5: price(p.e5),
        e10: price(p.e10),
        diesel: price(p.diesel),
      });
    }
  }
  return out;
}
