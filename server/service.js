import { config, FUELS } from './config.js';
import { analyze } from './analysis.js';
import { listStations, fetchPrices } from './tankerkoenig.js';
import { demoStations, demoSample, demoHistory } from './demo.js';
import { aiRecommendation, aiErrorMessage } from './ai.js';

const DAY = 86400;
const nowTs = () => Math.floor(Date.now() / 1000);
const NO_BRAND = 'ohne-marke';
/** Einheitlicher Schlüssel für Markennamen (die API liefert z. B. "ARAL" und "Aral"). */
export const brandKey = (brand) => (brand || '').trim().toLowerCase().replace(/\s+/g, ' ') || NO_BRAND;

export class Service {
  constructor(store) {
    this.store = store;
    this.aiCache = new Map();
    this.polling = null;
  }

  status() {
    return {
      demo: config.demo,
      aiEnabled: config.aiEnabled,
      aiModel: config.aiModel,
      pollMinutes: config.pollMinutes,
      location: this.store.getSetting('location'),
      lastPoll: this.store.getSetting('lastPoll'),
      lastPollError: this.store.getSetting('lastPollError'),
    };
  }

  async setLocation({ lat, lng, rad, label }) {
    const ts = nowTs();
    const found = config.demo ? demoStations({ lat, lng, rad }) : await listStations({ lat, lng, rad });
    const tracked = found.slice(0, config.maxStations); // nach Entfernung sortiert
    this.store.setTrackedStations(tracked);
    const keys = new Set(tracked.map((s) => brandKey(s.brand)));
    // Gespeichert wird ein Markenschlüssel oder '*' für alle Marken; null heißt: noch nie gewählt.
    const current = this.store.getSetting('brand');
    if (current === null || (current !== '*' && !keys.has(current))) {
      this.store.setSetting('brand', keys.has(config.defaultBrand) ? config.defaultBrand : '*');
    }
    this.store.setSetting('location', { lat, lng, rad, label: label || null });
    this.aiCache.clear();

    if (config.demo) {
      for (const s of tracked) {
        if (!this.store.hasPrices(s.id)) this.store.insertPrices(demoHistory(s.id, ts, config.timeZone));
      }
      this.store.insertPrices(tracked.map((s) => demoSample(s.id, ts, config.timeZone)));
    } else {
      this.store.insertPrices(tracked.map((s) => ({ stationId: s.id, ts, ...s })));
    }
    this.store.setSetting('lastPoll', ts);
    this.store.setSetting('lastPollError', null);
  }

  /** Holt aktuelle Preise der beobachteten Stationen und schreibt sie in die Historie. */
  async poll() {
    if (this.polling) return this.polling;
    this.polling = this.#poll().finally(() => (this.polling = null));
    return this.polling;
  }

  async #poll() {
    const stations = this.store.trackedStations();
    if (!stations.length) return;
    const ts = nowTs();
    try {
      const samples = config.demo
        ? stations.map((s) => demoSample(s.id, ts, config.timeZone))
        : await fetchPrices(stations.map((s) => s.id));
      this.store.insertPrices(samples.map((p) => ({ ...p, ts })));
      this.store.setSetting('lastPoll', ts);
      this.store.setSetting('lastPollError', null);
      this.store.prune(ts - 180 * DAY);
    } catch (err) {
      this.store.setSetting('lastPollError', err.message);
      throw err;
    }
  }

  /** Manuelle Aktualisierung – respektiert das 5-Minuten-Limit der Tankerkönig-API. */
  async refresh() {
    const last = this.store.getSetting('lastPoll') || 0;
    if (!config.demo && nowTs() - last < 300) return false;
    await this.poll();
    return true;
  }

  startCollector() {
    const tick = () => this.poll().catch((err) => console.error(`[collector] ${err.message}`));
    const last = this.store.getSetting('lastPoll') || 0;
    if (nowTs() - last >= config.pollMinutes * 60) tick();
    return setInterval(tick, config.pollMinutes * 60 * 1000);
  }

  /** Marken der beobachteten Stationen, häufigste zuerst. */
  brands(stations = this.store.trackedStations()) {
    const map = new Map();
    for (const s of stations) {
      const key = brandKey(s.brand);
      const b = map.get(key) || { key, label: key === NO_BRAND ? 'Freie / ohne Marke' : s.brand.trim(), count: 0 };
      b.count += 1;
      map.set(key, b);
    }
    return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'de'));
  }

  /** brand = Markenschlüssel oder null für alle Marken. */
  setBrand(brand) {
    if (brand && !this.brands().some((b) => b.key === brand)) {
      throw Object.assign(new Error('Diese Marke gibt es im gewählten Umkreis nicht.'), { status: 400 });
    }
    this.store.setSetting('brand', brand || '*');
    this.aiCache.clear();
  }

  overview(fuel) {
    const now = nowTs();
    const stations = this.store.trackedStations();
    const brands = this.brands(stations);
    const stored = this.store.getSetting('brand');
    const brand = stored && stored !== '*' ? stored : null;
    const inFocus = (b) => !brand || brandKey(b) === brand;
    const latest = new Map(this.store.latestPrices().map((p) => [p.stationId, p]));
    const analysis = analyze(
      this.store.priceRows(fuel, now - 60 * DAY).map((r) => ({ ...r, isFocus: inFocus(r.brand) })),
      { now, timeZone: config.timeZone });

    const withPrice = stations.map((s) => {
      const p = latest.get(s.id);
      const fresh = p && now - p.ts <= 2 * 3600;
      return {
        id: s.id,
        name: s.name,
        brand: s.brand,
        address: `${s.street} ${s.house_number}`.trim() + `, ${s.post_code} ${s.place}`,
        lat: s.lat,
        lng: s.lng,
        distKm: s.dist,
        isFocus: inFocus(s.brand),
        isOpen: fresh ? Boolean(p.isOpen) : null,
        price: fresh && p.isOpen ? p[fuel] : null,
        avgOffsetCt: analysis.stationOffsets[s.id] ?? null,
      };
    });
    const focus = withPrice.filter((s) => s.isFocus);
    const others = withPrice.filter((s) => !s.isFocus && s.price != null);
    const cheapestOther = others.reduce((a, b) => (!a || b.price < a.price ? b : a), null);
    const { stationOffsets, ...rest } = analysis;

    return {
      ...this.status(),
      now,
      fuel,
      timeZone: config.timeZone,
      brands,
      brand,
      brandLabel: brand ? brands.find((b) => b.key === brand)?.label ?? brand : null,
      stations: focus,
      area: {
        count: others.length,
        avgPrice: others.length ? others.reduce((a, s) => a + s.price, 0) / others.length : null,
        cheapest: cheapestOther,
      },
      analysis: rest,
    };
  }

  async ai(fuel) {
    if (!config.aiEnabled) throw Object.assign(new Error('Kein ANTHROPIC_API_KEY gesetzt.'), { status: 503 });
    const o = this.overview(fuel);
    if (o.analysis.current == null) throw Object.assign(new Error('Es liegen noch keine aktuellen Preise vor.'), { status: 409 });
    const key = `${fuel}:${o.brand}:${o.lastPoll}`;
    const cached = this.aiCache.get(key);
    if (cached) return cached;

    const a = o.analysis;
    const iso = (ts) => new Date(ts * 1000).toISOString();
    const payload = {
      jetzt: iso(o.now),
      zeitzone: o.timeZone,
      kraftstoff: fuel,
      preiseInEuroProLiter: true,
      gewaehlteMarke: o.brandLabel ?? 'alle Marken',
      stationen: o.stations.map(({ lat, lng, isFocus: _, ...s }) => s),
      andereMarken: o.brand && {
        anzahl: o.area.count,
        durchschnittspreis: o.area.avgPrice,
        guenstigste: o.area.cheapest && { marke: o.area.cheapest.brand, preis: o.area.cheapest.price, distKm: o.area.cheapest.distKm },
      },
      historie: {
        vollstaendigeTage: a.dataDays,
        profileSource: a.profileSource,
        abweichungVomTagesmittelJeStundeCt: a.profile.map((p) => ({ stunde: p.hour, ct: p.devCt })),
        wochentagsAbweichungCt: a.weekdayProfile?.map((w) => ({ wochentag: ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'][w.weekday], ct: w.devCt })) ?? null,
        trendCtProTag: a.trendCtPerDay,
        letzte7Tage: a.weekStats,
      },
      durchschnittGewaehlteStationenJetzt: a.current,
      prognose24h: a.forecast.map((f) => ({ zeit: iso(f.ts), lokaleStunde: f.hour, erwarteterPreis: Math.round(f.expected * 1000) / 1000 })),
      statistischeEmpfehlung: a.recommendation,
    };
    try {
      const result = { ...(await aiRecommendation(payload)), generatedAt: nowTs() };
      this.aiCache.clear();
      this.aiCache.set(key, result);
      return result;
    } catch (err) {
      throw Object.assign(new Error(aiErrorMessage(err)), { status: 502 });
    }
  }
}

export const isFuel = (f) => FUELS.includes(f);
