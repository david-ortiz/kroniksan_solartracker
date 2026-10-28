// Turns SolarEdge payloads into rows: site power samples, device telemetry,
// lifetime counters, and the daily energy table the dashboard reads.

import { db, kv, writeCounters, writeDaily, writeSamples } from './db.js';
import { series, toBase } from './solaredge.js';
import { dayRange, localDay } from './time.js';

export const ENERGY_METRICS = ['production', 'consumption', 'import', 'export', 'charge', 'discharge'];

const METER_POWER = {
  productionPower: 'production',
  consumptionPower: 'consumption',
  importPower: 'import',
  exportPower: 'export',
};
const STORAGE_POWER = { chargePower: 'charge', dischargePower: 'discharge' };
const INVERTER_POWER = /^(total)?(ac)?(active)?power$/i;

function addTo(map, metric, ts, value) {
  let m = map.get(metric);
  if (!m) map.set(metric, (m = new Map()));
  m.set(ts, (m.get(ts) ?? 0) + value);
}

function flatten(map) {
  const rows = [];
  for (const [metric, points] of map) for (const [ts, value] of points) rows.push([metric, ts, value]);
  return rows;
}

function eachMetric(devices, fn) {
  for (const [serial, metrics] of Object.entries(devices || {})) {
    for (const [name, payload] of Object.entries(metrics || {})) {
      if (payload && typeof payload === 'object' && Array.isArray(payload.values)) {
        fn(serial, name, payload.unit, series(payload.values, payload.unit));
      }
    }
  }
}

export function ingestMeterTelemetry(body) {
  const site = new Map();
  const device = new Map();
  const roles = new Set(kv.get('meter_roles', []));
  eachMetric(body?.meters, (serial, name, unit, points) => {
    const target = METER_POWER[name];
    for (const [ts, v] of points) {
      if (target) addTo(site, target, ts, v);
      else addTo(device, `meter:${serial}:${name}`, ts, v);
    }
    if (target && points.length) roles.add(target);
  });
  kv.set('meter_roles', [...roles]);
  writeSamples([...flatten(site), ...flatten(device)]);
  return touchedTs(site);
}

export function ingestStorageTelemetry(body) {
  const site = new Map();
  const device = new Map();
  const soc = new Map(); // ts → [values]
  eachMetric(body?.storage, (serial, name, unit, points) => {
    for (const [ts, v] of points) {
      if (STORAGE_POWER[name]) addTo(site, STORAGE_POWER[name], ts, v);
      else if (name === 'stateOfEnergy') {
        const list = soc.get(ts) ?? [];
        list.push(v);
        soc.set(ts, list);
      } else if (name === 'remainingEnergy') addTo(site, 'battery_energy', ts, v);
      else addTo(device, `battery:${serial}:${name}`, ts, v);
      addTo(device, `battery:${serial}:${name}`, ts, v);
    }
  });
  // stateOfEnergy may come as 0..1 or 0..100.
  const allSoc = [...soc.values()].flat();
  const scale = allSoc.length && Math.max(...allSoc) <= 1 ? 100 : 1;
  for (const [ts, list] of soc) addTo(site, 'soc', ts, (list.reduce((a, b) => a + b, 0) / list.length) * scale);
  if (soc.size || site.size) kv.set('has_battery', true);
  writeSamples([...flatten(site), ...flatten(device)]);
  return touchedTs(site);
}

export function ingestInverterTelemetry(body) {
  const device = new Map();
  const production = new Map();
  eachMetric(body?.inverters, (serial, name, unit, points) => {
    for (const [ts, v] of points) {
      addTo(device, `inverter:${serial}:${name}`, ts, v);
      if (INVERTER_POWER.test(name)) addTo(production, 'production', ts, v);
    }
  });
  const rows = flatten(device);
  // Last resort for production: inverter AC power. On hybrid (battery) inverters this
  // also carries battery discharge, so it's only used when the meters can't give
  // production by balance (see deriveProduction).
  const roles = kv.get('meter_roles', []);
  if (!roles.includes('production') && !roles.includes('consumption')) rows.push(...flatten(production));
  writeSamples(rows);
  return touchedTs(production).concat(touchedTs(device));
}

/** /sites/{id}/power fallback for production. */
export function ingestSitePower(body) {
  const rows = series(body?.values, body?.unit || 'W').map(([ts, v]) => ['production', ts, v]);
  if (!kv.get('meter_roles', []).includes('production')) writeSamples(rows);
  return rows.map((r) => r[1]);
}

function touchedTs(map) {
  const out = [];
  for (const points of map.values()) out.push(...points.keys());
  return out;
}

function balanceRows(from, to) {
  const rows = db
    .prepare(
      `SELECT ts, metric, value FROM samples
       WHERE ts >= ? AND ts < ? AND metric IN ('production','consumption','import','export','charge','discharge')`,
    )
    .all(from, to);
  const byTs = new Map();
  for (const r of rows) {
    const o = byTs.get(r.ts) ?? {};
    o[r.metric] = r.value;
    byTs.set(r.ts, o);
  }
  return byTs;
}

/**
 * Without a production meter but with consumption + grid meters:
 * production = consumption + export + charge − import − discharge.
 * Matches SolarEdge's own daily production within ~1% on a hybrid inverter.
 */
export function deriveProduction(from, to) {
  const roles = kv.get('meter_roles', []);
  if (roles.includes('production') || !roles.includes('consumption')) return;
  const out = [];
  for (const [ts, o] of balanceRows(from, to)) {
    if (o.consumption == null || (o.import == null && o.export == null)) continue;
    const v = o.consumption + (o.export ?? 0) + (o.charge ?? 0) - (o.import ?? 0) - (o.discharge ?? 0);
    out.push(['production', ts, Math.max(0, v)]);
  }
  writeSamples(out);
}

/** Without a consumption meter: consumption = production + import − export + discharge − charge. */
export function deriveConsumption(from, to) {
  if (kv.get('meter_roles', []).includes('consumption')) return;
  const out = [];
  for (const [ts, o] of balanceRows(from, to)) {
    if (o.import == null && o.export == null) continue; // grid unknown, can't derive
    const v = (o.production ?? 0) + (o.import ?? 0) - (o.export ?? 0) + (o.discharge ?? 0) - (o.charge ?? 0);
    out.push(['consumption', ts, Math.max(0, v)]);
  }
  writeSamples(out);
}

// ---------------------------------------------------------------- Counters

const COUNTER_MAP = {
  productionEnergy: 'production',
  consumptionEnergy: 'consumption',
  importEnergy: 'import',
  exportEnergy: 'export',
  lifetimeEnergyCharged: 'charge',
  lifetimeEnergyDischarged: 'discharge',
};

export function ingestCounters(list) {
  const rows = [];
  for (const item of list || []) {
    const serial = item.serialNumber || 'device';
    for (const [key, metric] of Object.entries(COUNTER_MAP)) {
      if (!Array.isArray(item[key])) continue;
      for (const [ts, v] of series(item[key], null)) rows.push([`${metric}@${serial}`, ts, toBase(v, item.unit || 'WH')]);
    }
  }
  writeCounters(rows);
  return rows.map((r) => r[1]);
}

// ---------------------------------------------------------------- Daily table

/** Recompute daily rows for every local day touched by these timestamps. */
export function rebuildDays(timestamps, tz) {
  if (!timestamps.length) return;
  const days = new Set(timestamps.map((ts) => localDay(ts, tz)));
  for (const day of days) rebuildDay(day, tz);
}

const samplesFor = db.prepare('SELECT ts, value FROM samples WHERE metric = ? AND ts >= ? AND ts < ? ORDER BY ts');
const counterMetrics = db.prepare("SELECT DISTINCT metric FROM counters WHERE metric LIKE ? || '@%'");
const counterWindow = db.prepare(
  `SELECT ts, value FROM counters WHERE metric = ? AND ts >= ? AND ts <= ? ORDER BY ts`,
);
const counterBefore = db.prepare('SELECT ts, value FROM counters WHERE metric = ? AND ts < ? ORDER BY ts DESC LIMIT 1');

export function rebuildDay(day, tz) {
  const [start, end] = dayRange(day, tz);
  const rows = [];
  for (const metric of ENERGY_METRICS) {
    // Integrated power. Bucket width = gap to the next sample, capped at 1 h.
    const pts = samplesFor.all(metric, start, end);
    if (pts.length) {
      let wh = 0;
      for (let i = 0; i < pts.length; i++) {
        const next = pts[i + 1]?.ts ?? pts[i].ts + (i ? pts[i].ts - pts[i - 1].ts : 900);
        wh += pts[i].value * (Math.min(next - pts[i].ts, 3600) / 3600);
      }
      rows.push([metric, day, 'power', wh]);
    }

    // Lifetime counters: last reading in the day minus the last one before it.
    let total = null;
    for (const { metric: key } of counterMetrics.all(metric)) {
      const inDay = counterWindow.all(key, start, end - 1);
      if (!inDay.length) continue;
      const before = counterBefore.get(key, start);
      const hasBase = before && start - before.ts < 6 * 3600;
      // Skip days the counter only partly covers; integrated power fills those.
      if (!hasBase && inDay[0].ts - start > 2 * 3600) continue;
      if (end - inDay.at(-1).ts > 2 * 3600 && end < Date.now() / 1000) continue;
      const base = hasBase ? before.value : inDay[0].value;
      const delta = inDay.at(-1).value - base;
      if (delta >= 0) total = (total ?? 0) + delta;
    }
    if (total != null) rows.push([metric, day, 'counter', total]);
  }

  // Battery energy that came from the grid (off-peak charging), from the 15-min flows.
  const byTs = balanceRows(start, end);
  if (byTs.size) {
    const list = [...byTs].sort((a, b) => a[0] - b[0]);
    let gridCharge = 0;
    for (let i = 0; i < list.length; i++) {
      const width = Math.min((list[i + 1]?.[0] ?? list[i][0] + 900) - list[i][0], 3600) / 3600;
      gridCharge += allocateFlows(list[i][1]).gridToBattery * width;
    }
    rows.push(['grid_charge', day, 'power', gridCharge]);
  }
  writeDaily(rows);
}

/**
 * Split one instant's power (W) into source → destination flows. Solar serves
 * the home first, then the battery, then the grid; the battery serves the home
 * before the grid does; anything else charging the battery came from the grid.
 */
export function allocateFlows(o) {
  const P = Math.max(0, o.production ?? 0);
  const C = Math.max(0, o.consumption ?? 0);
  const charge = Math.max(0, o.charge ?? 0);
  const discharge = Math.max(0, o.discharge ?? 0);
  const solarToHome = Math.min(P, C);
  const solarToBattery = Math.min(charge, P - solarToHome);
  const solarToGrid = Math.max(0, P - solarToHome - solarToBattery);
  const batteryToHome = Math.min(discharge, C - solarToHome);
  const gridToBattery = Math.max(0, charge - solarToBattery);
  const gridToHome = Math.max(0, C - solarToHome - batteryToHome);
  const batteryToGrid = Math.max(0, discharge - batteryToHome);
  return { solarToHome, solarToBattery, solarToGrid, batteryToHome, batteryToGrid, gridToHome, gridToBattery };
}
