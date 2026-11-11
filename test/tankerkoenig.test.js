import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Fake-Server mit dem dokumentierten Antwortformat der Tankerkönig-API
const seen = [];
const times = [];
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  seen.push(url);
  times.push(Date.now());
  const json = (body) => res.end(JSON.stringify(body));
  if (url.searchParams.get('apikey') !== 'test-key') return json({ ok: false, message: 'apikey nicht angegeben, falsch, oder im falschen Format' });
  if (url.pathname === '/json/list.php') {
    return json({ ok: true, license: 'CC BY 4.0', status: 'ok', stations: [
      { id: 's1', name: 'Shell Köln', brand: 'Shell', street: 'Hauptstr.', houseNumber: '1', postCode: 50667, place: 'Köln', lat: 50.9, lng: 6.9, dist: 0.5, diesel: 1.609, e5: 1.789, e10: 1.729, isOpen: true },
      { id: 'j1', name: 'JET', brand: 'JET', street: 'Ring', houseNumber: '', postCode: 50668, place: 'Köln', lat: 50.91, lng: 6.91, dist: 1.2, diesel: 1.559, e5: null, e10: 1.699, isOpen: false },
    ] });
  }
  if (url.pathname === '/json/prices.php') {
    const prices = {};
    for (const id of url.searchParams.get('ids').split(',')) {
      prices[id] = id === 'closed' ? { status: 'closed' } : id === 'none' ? { status: 'no prices' } : { status: 'open', e5: 1.799, e10: 1.739, diesel: false };
    }
    return json({ ok: true, prices });
  }
  res.statusCode = 404;
  res.end('nope');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.TANKERKOENIG_API_KEY = 'test-key';
process.env.TANKERKOENIG_MIN_GAP_MS = '200';
process.env.TANKERKOENIG_BASE_URL = `http://127.0.0.1:${server.address().port}/json`;
const { listStations, fetchPrices, resetRateLimit } = await import('../server/tankerkoenig.js');
const { config } = await import('../server/config.js');
test.after(() => server.close());

test('listStations liest Umkreissuche und normalisiert Preise', async () => {
  const stations = await listStations({ lat: 50.9, lng: 6.9, rad: 5 });
  assert.equal(stations.length, 2);
  assert.deepEqual({ id: stations[0].id, e5: stations[0].e5, isOpen: stations[0].isOpen }, { id: 's1', e5: 1.789, isOpen: true });
  assert.equal(stations[1].e5, null);
  assert.equal(seen.at(-1).searchParams.get('type'), 'all');
  assert.equal(seen.at(-1).searchParams.get('rad'), '5');
});

test('fetchPrices teilt in Zehnergruppen und behandelt geschlossene Stationen', async () => {
  seen.length = 0;
  times.length = 0;
  const ids = [...Array.from({ length: 10 }, (_, i) => `id${i}`), 'closed', 'none'];
  const prices = await fetchPrices(ids);
  assert.equal(seen.length, 2);
  assert.ok(times[1] - times[0] >= 190, `Abstand zwischen den Abfragen: ${times[1] - times[0]} ms`);
  assert.equal(prices.length, 11); // "no prices" wird ausgelassen
  assert.deepEqual(prices[0], { stationId: 'id0', isOpen: true, e5: 1.799, e10: 1.739, diesel: null });
  assert.deepEqual(prices.at(-1), { stationId: 'closed', isOpen: false, e5: null, e10: null, diesel: null });
});

test('API-Fehler werden als verständliche Meldung weitergegeben', async () => {
  config.tankerkoenigKey = 'falsch';
  await assert.rejects(listStations({ lat: 1, lng: 1, rad: 1 }), /Tankerkönig: apikey/);
  config.tankerkoenigKey = 'test-key';
});

test('Ratenbegrenzung: Umkreissuche bricht bei langer Wartezeit verständlich ab, Hintergrundabruf wartet', async () => {
  resetRateLimit();
  config.tankerkoenigMinGapMs = 60_000;
  await listStations({ lat: 1, lng: 1, rad: 1 }); // erste Abfrage sofort
  await assert.rejects(listStations({ lat: 1, lng: 1, rad: 1 }), (err) => err.status === 429 && /eine Abfrage pro Minute/.test(err.message));
  // Eine abgelehnte Abfrage darf keinen Platz belegen: nach Ablauf der Minute geht es sofort weiter.
  resetRateLimit();
  config.tankerkoenigMinGapMs = 200;
  const start = Date.now();
  await fetchPrices(['a']);
  await fetchPrices(['b']);
  assert.ok(Date.now() - start >= 190);
});
