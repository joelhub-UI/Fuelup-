// Preiskarte: alle beobachteten Tankstellen mit aktuellem Preis auf einer OpenStreetMap-Karte.
// Leaflet wird als globales `L` aus public/vendor/leaflet geladen.
const L = window.L;

let map;
let layer;
let lastView = '';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function popup(station, { fuelName, eur, km }) {
  const box = el('div', 'map-popup');
  box.append(el('strong', '', station.name));
  box.append(el('div', 'sub', `${station.brand || 'ohne Marke'} · ${station.address}`));
  const state = station.isOpen === false ? 'geschlossen' : station.price == null ? 'kein aktueller Preis' : `${fuelName}: ${eur(station.price)}`;
  box.append(el('div', 'map-popup-price', state));
  const route = el('a', '', `Route (${km(station.distKm)})`);
  route.href = `https://www.google.com/maps/dir/?api=1&destination=${station.lat},${station.lng}`;
  route.target = '_blank';
  route.rel = 'noopener';
  box.append(route);
  return box;
}

/**
 * @param container  Element für die Karte
 * @param d          Antwort von /api/overview
 * @param fmt        { fuelName, eur, km } – Formatierer aus app.js
 */
export function renderMap(container, d, fmt) {
  if (!L) {
    container.textContent = 'Die Kartenbibliothek konnte nicht geladen werden.';
    return;
  }
  if (!map) {
    map = L.map(container, { scrollWheelZoom: false, attributionControl: true });
    map.attributionControl.setPrefix(false);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap-Mitwirkende',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    // Mausrad zoomt erst nach einem Klick in die Karte, damit das Scrollen der Seite nicht hängen bleibt.
    map.on('click', () => map.scrollWheelZoom.enable());
    container.addEventListener('mouseleave', () => map.scrollWheelZoom.disable());
  }
  layer.clearLayers();

  const { lat, lng, rad } = d.location;
  L.circle([lat, lng], { radius: rad * 1000, className: 'map-radius', interactive: false }).addTo(layer);
  L.marker([lat, lng], {
    icon: L.divIcon({ className: 'map-me', iconSize: [16, 16] }),
    title: 'Dein Standort',
    keyboard: false,
    interactive: false,
  }).addTo(layer);

  const priced = d.allStations.filter((s) => s.isFocus && s.price != null);
  const best = priced.reduce((a, b) => (!a || b.price < a.price ? b : a), null);
  // Gewählte Marke zuletzt zeichnen, damit sie über den Vergleichsstationen liegt.
  const ordered = [...d.allStations].sort((a, b) => Number(a.isFocus) - Number(b.isFocus) || Number(a === best) - Number(b === best));
  for (const s of ordered) {
    const label = s.isOpen === false ? 'zu' : s.price == null ? '–' : s.price.toFixed(3).replace('.', ',');
    const tag = el('span', '', label);
    const classes = ['map-price', s.isFocus ? 'focus' : 'other'];
    if (s === best) classes.push('best');
    if (s.price == null) classes.push('none');
    L.marker([s.lat, s.lng], {
      icon: L.divIcon({ className: classes.join(' '), html: tag, iconSize: [58, 24], iconAnchor: [29, 12] }),
      title: `${s.name}: ${label}`,
      alt: `${s.name}: ${label}`,
      zIndexOffset: s === best ? 1000 : s.isFocus ? 500 : 0,
    }).bindPopup(popup(s, fmt)).addTo(layer);
  }

  // Ausschnitt nur neu setzen, wenn sich Standort oder Umkreis geändert haben – nicht bei jeder Preisaktualisierung.
  const view = `${lat},${lng},${rad}`;
  map.invalidateSize();
  if (view !== lastView) {
    const points = [[lat, lng], ...d.allStations.map((s) => [s.lat, s.lng])];
    map.fitBounds(L.latLngBounds(points).pad(0.12), { maxZoom: 15 });
    lastView = view;
  }
}
