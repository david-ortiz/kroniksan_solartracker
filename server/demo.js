// Demo mode: a simulated home with 8.4 kWp of PV and a 9.7 kWh battery, so the
// dashboard is fully alive before real SolarEdge credentials are added.
// Every value comes from a deterministic hash of the timestamp, so the
// simulation can resume after a restart without drifting.

import { db, kv, transaction, writeDaily } from './db.js';
import { localParts, localDay, nowTs } from './time.js';

const STEP = 900;
const PEAK_W = 8400;
const BATTERY_WH = 9700;
const BATTERY_MAX_W = 5000;
const MIN_SOC = 0.05;
const DETAIL_DAYS = 21;
const LATITUDE = (40 * Math.PI) / 180;
const INVERTER = '7E1234AB-CD';
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

function hash(n, salt = 0) {
  let h = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function dayOfYear(p) {
  return Math.floor((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(p.year, 0, 0)) / 86400000);
}

function dayIndex(ts) {
  return Math.floor((ts + 43200) / 86400);
}

/** 0 = clear, 1 = overcast. Persistent weather systems over a few days. */
function cloudiness(ts) {
  const d = dayIndex(ts);
  const base = 0.55 * hash(d, 1) + 0.25 * hash(Math.floor(d / 3), 2) + 0.2 * hash(Math.floor(d / 7), 3);
  const clear = hash(d, 4) < 0.38 ? 0.35 : 1; // plenty of sunny days
  const passing = Math.sin(ts / 2300 + hash(d, 5) * 6) * Math.sin(ts / 900 + hash(d, 6) * 6);
  return Math.min(1, Math.max(0, base * clear + passing * 0.18 * base));
}

function production(ts, p) {
  const n = dayOfYear(p);
  const decl = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const solarHour = p.hour + p.minute / 60 + 7.5 / 60 - 1; // bucket centre, rough DST shift
  const hourAngle = ((15 * (solarHour - 12)) * Math.PI) / 180;
  const sinAlt = Math.sin(LATITUDE) * Math.sin(decl) + Math.cos(LATITUDE) * Math.cos(decl) * Math.cos(hourAngle);
  if (sinAlt <= 0) return 0;
  const clear = Math.pow(sinAlt, 1.2) * 0.92;
  const c = cloudiness(ts);
  const noise = 0.94 + hash(ts, 7) * 0.08;
  return Math.max(0, PEAK_W * clear * (1 - c * 0.78) * noise);
}

function consumption(ts, p) {
  const h = p.hour + p.minute / 60;
  const n = dayOfYear(p);
  const winter = Math.max(0, Math.cos(((n - 15) / 365) * 2 * Math.PI)); // 1 in January
  const weekend = ['Sat', 'Sun'].includes(p.weekday);
  let w = 260 + 90 * hash(ts, 8);
  w += 120 * (Math.sin(ts / 1500) > 0.6 ? 1 : 0); // fridge cycling
  w += 1100 * Math.exp(-((h - (weekend ? 9 : 7.5)) ** 2) / 0.9);
  w += 1500 * Math.exp(-((h - 19.5) ** 2) / 2.5);
  if (weekend) w += 500 * Math.exp(-((h - 13.5) ** 2) / 3);
  w += winter * 900 * (h < 8 || h > 17 ? 1 : 0.4); // heat pump
  const d = dayIndex(ts);
  const applianceAt = 10 + Math.floor(hash(d, 9) * 11); // dishwasher / washer run
  if (h >= applianceAt && h < applianceAt + 1.25) w += 1900;
  if (hash(d, 10) < 0.3 && h >= 18 && h < 20.5) w += 3200 * hash(d, 11); // EV / oven
  return w * (0.92 + 0.16 * hash(ts, 12));
}

function inverterMetrics(ts, p, prodW) {
  if (prodW <= 0) return [];
  const n = dayOfYear(p);
  const ambient = 12 + 12 * Math.sin(((n - 105) / 365) * 2 * Math.PI) + 4 * Math.sin(((p.hour - 9) / 24) * 2 * Math.PI);
  const acVoltage = 231 + 3 * Math.sin(ts / 5000) - (prodW / PEAK_W) * -2 + (hash(ts, 13) - 0.5) * 1.5;
  return [
    ['acPower', prodW],
    ['acVoltage', acVoltage],
    ['acCurrent', prodW / acVoltage],
    ['acFrequency', 50 + (hash(ts, 14) - 0.5) * 0.06],
    ['dcVoltage', 370 + 30 * (prodW / PEAK_W) + (hash(ts, 15) - 0.5) * 8],
    ['temperature', ambient + 28 * (prodW / PEAK_W) + hash(ts, 16) * 2],
    ['powerFactor', 0.99 + hash(ts, 17) * 0.01],
  ].map(([k, v]) => [`inverter:${INVERTER}:${k}`, ts, v]);
}

const insertSample = db.prepare(
  'INSERT INTO samples (metric, ts, value) VALUES (?, ?, ?) ON CONFLICT (metric, ts) DO UPDATE SET value = excluded.value',
);

/** Simulate from the last simulated bucket up to now. */
export function simulate() {
  const now = nowTs();
  const end = Math.floor(now / STEP) * STEP - STEP; // last complete bucket, like real lag
  const start = kv.get('demo_cursor') ?? Math.floor((now - 3 * 365 * 86400) / STEP) * STEP;
  if (start > end) return;

  let energy = kv.get('demo_battery_wh', BATTERY_WH * 0.5);
  const detailFrom = now - DETAIL_DAYS * 86400;
  const daily = new Map();

  transaction(() => {
    for (let ts = start + STEP; ts <= end; ts += STEP) {
      const p = localParts(ts, tz);
      const P = production(ts, p);
      const C = consumption(ts, p);
      const h = STEP / 3600;
      let charge = 0;
      let discharge = 0;
      let imp = 0;
      let exp = 0;
      const net = P - C;
      if (net > 0) {
        charge = Math.min(net, BATTERY_MAX_W, Math.max(0, (BATTERY_WH - energy) / h / 0.95));
        energy += charge * h * 0.95;
        exp = net - charge;
      } else {
        discharge = Math.min(-net, BATTERY_MAX_W, Math.max(0, (energy - BATTERY_WH * MIN_SOC) / h));
        energy -= discharge * h;
        imp = -net - discharge;
      }

      const day = localDay(ts, tz);
      const acc = daily.get(day) ?? { production: 0, consumption: 0, import: 0, export: 0, charge: 0, discharge: 0 };
      acc.production += P * h;
      acc.consumption += C * h;
      acc.import += imp * h;
      acc.export += exp * h;
      acc.charge += charge * h;
      acc.discharge += discharge * h;
      daily.set(day, acc);

      if (ts >= detailFrom) {
        const rows = [
          ['production', ts, P],
          ['consumption', ts, C],
          ['import', ts, imp],
          ['export', ts, exp],
          ['charge', ts, charge],
          ['discharge', ts, discharge],
          ['soc', ts, (energy / BATTERY_WH) * 100],
          ['battery_energy', ts, energy],
          ...inverterMetrics(ts, p, P),
        ];
        for (const r of rows) insertSample.run(...r);
      }
    }
  });

  // Merge into existing daily rows (the first and last day may be partial).
  const existing = db.prepare("SELECT value FROM daily WHERE metric = ? AND day = ? AND source = 'counter'");
  const rows = [];
  for (const [day, acc] of daily) {
    for (const [metric, value] of Object.entries(acc)) {
      const prev = kv.get('demo_cursor') && day === localDay(start, tz) ? existing.get(metric, day)?.value ?? 0 : 0;
      rows.push([metric, day, 'counter', prev + value]);
    }
  }
  writeDaily(rows);
  db.prepare('DELETE FROM samples WHERE ts < ?').run(now - (DETAIL_DAYS + 1) * 86400);

  kv.set('demo_cursor', end);
  kv.set('demo_battery_wh', energy);
}

export function setupDemo() {
  const install = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
  kv.set('site', {
    id: 1234567,
    name: 'Demo Home',
    peakPowerKw: PEAK_W / 1000,
    installationDate: install,
    activationStatus: 'ACTIVE',
    timezone: tz,
    latitude: 40,
    longitude: 0,
    location: 'Simulated site',
  });
  kv.set('has_battery', true);
  kv.set('devices', [
    { type: 'INVERTER', serialNumber: INVERTER, name: 'Inverter 1', manufacturer: 'SolarEdge', model: 'SE8K-RWB48', firmwareVersion: '4.21.18', active: true },
    { type: 'METER', serialNumber: '2644513869', name: 'Grid meter', manufacturer: 'SolarEdge', model: 'Energy Meter', meterType: 'FeedIn', active: true },
    { type: 'METER', serialNumber: '617887617', name: 'Consumption meter', manufacturer: 'SolarEdge', model: 'Energy Meter', meterType: 'Consumption', active: true },
    { type: 'BATTERY', serialNumber: 'BATT-001', name: 'Home Battery', manufacturer: 'SolarEdge', model: 'Home Battery 9.7kWh', active: true },
    ...Array.from({ length: 21 }, (_, i) => ({
      type: 'OPTIMIZER',
      serialNumber: `OPT-${String(i + 1).padStart(3, '0')}`,
      name: `Optimizer 1.0.${i + 1}`,
      manufacturer: 'SolarEdge',
      model: 'S440',
      active: true,
    })),
  ]);
  kv.set('alerts', [
    {
      alertId: 1001,
      type: 'OPTIMIZER_UNDERPERFORMING',
      category: 'PV',
      impact: 2,
      status: 'CLOSED',
      openedAt: new Date(Date.now() - 12 * 86400000).toISOString(),
      closedAt: new Date(Date.now() - 10 * 86400000).toISOString(),
      component: { serialNumber: 'OPT-014', name: 'Optimizer 1.0.14' },
    },
  ]);
  const first = !kv.get('demo_cursor');
  if (first) console.log('[demo] simulating three years of data…');
  simulate();
  setInterval(simulate, 5 * 60 * 1000);
}
