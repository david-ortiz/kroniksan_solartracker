// Read-only dashboard API. Everything is served from the local database, so the
// dashboard is fast and costs zero SolarEdge credits.

import { Router } from 'express';
import { config } from './config.js';
import { db, kv } from './db.js';
import { ENERGY_METRICS, allocateFlows } from './ingest.js';
import { isConnected } from './solaredge.js';
import { budget, runSync, site, syncLog, syncState } from './sync.js';
import { addDays, dayRange, daysBetween, localDay, localParts, nowTs, parseDay, weekday } from './time.js';

export const api = Router();

const SITE_METRICS = [...ENERGY_METRICS, 'soc', 'battery_energy'];
const SOURCE_RANK = { counter: 3, api: 2, power: 1 };
const tz = () => site()?.timezone || 'UTC';

// ---------------------------------------------------------------- Helpers

const dailyRows = db.prepare('SELECT metric, day, source, value FROM daily WHERE day >= ? AND day <= ?');

/** Map day → {metric: Wh}, best source per metric, consumption derived when missing. */
function daily(fromDay, toDay) {
  const best = new Map();
  for (const r of dailyRows.all(fromDay, toDay)) {
    const key = `${r.day}|${r.metric}`;
    const cur = best.get(key);
    if (!cur || SOURCE_RANK[r.source] > SOURCE_RANK[cur.source]) best.set(key, r);
  }
  const days = new Map();
  for (const r of best.values()) {
    const o = days.get(r.day) ?? {};
    o[r.metric] = r.value;
    days.set(r.day, o);
  }
  for (const o of days.values()) {
    if (o.consumption == null && (o.import != null || o.export != null)) {
      o.consumption = Math.max(0, (o.production ?? 0) + (o.import ?? 0) - (o.export ?? 0) + (o.discharge ?? 0) - (o.charge ?? 0));
    }
  }
  return days;
}

function sum(list) {
  const out = {};
  for (const o of list) for (const m of [...ENERGY_METRICS, 'grid_charge']) if (o[m] != null) out[m] = (out[m] ?? 0) + o[m];
  return out;
}

/** Where energy went for a set of totals (Wh). grid_charge comes from 15-min flows when available. */
function totalFlows(t) {
  const production = t.production ?? 0;
  const consumption = t.consumption ?? 0;
  const imp = t.import ?? 0;
  const exp = t.export ?? 0;
  const charge = t.charge ?? 0;
  const discharge = t.discharge ?? 0;
  // Without 15-min data, assume the battery took solar surplus first, the rest from the grid.
  const gridToBattery = Math.min(charge, t.grid_charge ?? Math.max(0, charge - Math.max(0, production - exp)));
  const solarToBattery = charge - gridToBattery;
  const solarToHome = Math.max(0, Math.min(consumption || Infinity, production - exp - solarToBattery));
  const gridToHome = Math.max(0, imp - gridToBattery);
  return { solarToHome, solarToBattery, solarToGrid: exp, gridToHome, gridToBattery, batteryToHome: discharge };
}

/** Derived figures for a set of energy totals (Wh). */
function kpis(t) {
  const production = t.production ?? 0;
  const consumption = t.consumption ?? 0;
  const imp = t.import ?? 0;
  const exp = t.export ?? 0;
  const flows = totalFlows(t);
  const hasGrid = t.import != null || t.export != null;
  return {
    selfConsumption: production > 0 && hasGrid ? Math.max(0, (production - exp) / production) : null,
    // Share of home energy that did not come straight from the grid.
    selfSufficiency: consumption > 0 && hasGrid ? Math.min(1, Math.max(0, 1 - flows.gridToHome / consumption)) : null,
    flows,
    // What the panels were worth: solar used at home (directly or via the battery) plus export.
    savings: ((flows.solarToHome + flows.solarToBattery) / 1000) * config.importPrice + (exp / 1000) * config.exportPrice,
    gridCost: (imp / 1000) * config.importPrice,
    exportRevenue: (exp / 1000) * config.exportPrice,
    co2AvoidedKg: (production / 1000) * config.co2KgPerKwh,
    netGrid: imp - exp,
  };
}

const sampleRange = db.prepare(
  `SELECT metric, ts, value FROM samples WHERE ts >= ? AND ts < ? AND metric IN (${SITE_METRICS.map(() => '?').join(',')}) ORDER BY ts`,
);

function points(from, to) {
  const byTs = new Map();
  for (const r of sampleRange.all(from, to, ...SITE_METRICS)) {
    const o = byTs.get(r.ts) ?? { ts: r.ts };
    o[r.metric] = r.value;
    byTs.set(r.ts, o);
  }
  return [...byTs.values()];
}

function today() {
  return localDay(nowTs(), tz());
}

function validDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today();
}

const dataBounds = db.prepare('SELECT MIN(day) first, MAX(day) last FROM daily');

// ---------------------------------------------------------------- Routes

api.get('/status', (req, res) => {
  const devices = kv.get('devices', []) || [];
  const counts = {};
  for (const d of devices) counts[d.type] = (counts[d.type] ?? 0) + 1;
  res.json({
    mode: config.demo ? 'demo' : 'live',
    configured: Boolean(config.clientId && config.clientSecret),
    connected: config.demo || isConnected(),
    redirectUri: config.redirectUri,
    site: site()
      ? {
          ...site(),
          latitude: site().latitude ?? site().raw?.location?.latitude ?? null,
          longitude: site().longitude ?? site().raw?.location?.longitude ?? null,
          raw: undefined,
        }
      : null,
    devices,
    deviceCounts: counts,
    hasBattery: Boolean(kv.get('has_battery')) || Boolean(counts.BATTERY),
    alerts: kv.get('alerts', []),
    budget: config.demo ? null : budget(),
    sync: config.demo ? null : syncState(),
    log: config.demo ? [] : syncLog(),
    settings: {
      currency: config.currency,
      importPrice: config.importPrice,
      exportPrice: config.exportPrice,
      co2KgPerKwh: config.co2KgPerKwh,
    },
    range: dataBounds.get(),
    now: nowTs(),
  });
});

api.get('/live', (req, res) => {
  const latestTs = db.prepare("SELECT MAX(ts) ts FROM samples WHERE metric IN ('production','consumption','import','export')").get().ts;
  const values = {};
  if (latestTs) {
    const latest = db.prepare('SELECT value, ts FROM samples WHERE metric = ? AND ts <= ? AND ts > ? ORDER BY ts DESC LIMIT 1');
    for (const m of SITE_METRICS) {
      const row = latest.get(m, latestTs, latestTs - 3 * 3600);
      if (row) values[m] = row.value;
    }
  }
  const day = today();
  const totals = daily(day, day).get(day) ?? {};
  const p = values;
  const flows = allocateFlows(p);
  res.json({ ts: latestTs ?? null, values, flows, today: { day, totals, kpis: kpis(totals) } });
});

api.get('/day', (req, res) => {
  const day = validDay(req.query.date);
  const [from, to] = dayRange(day, tz());
  const pts = points(from, to);
  for (const o of pts) {
    if (o.consumption == null && (o.import != null || o.export != null)) {
      o.consumption = Math.max(0, (o.production ?? 0) + (o.import ?? 0) - (o.export ?? 0) + (o.discharge ?? 0) - (o.charge ?? 0));
    }
  }
  const totals = daily(day, day).get(day) ?? {};
  let peak = null;
  for (const o of pts) if (o.production != null && (!peak || o.production > peak.value)) peak = { ts: o.ts, value: o.production };
  res.json({ date: day, from, to, points: pts, totals, kpis: kpis(totals), peak });
});

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function periodBounds(period, day) {
  const { y, m } = parseDay(day);
  const pad = (v) => String(v).padStart(2, '0');
  if (period === 'week') {
    const start = addDays(day, -((weekday(day) + 6) % 7)); // Monday
    return { start, end: addDays(start, 6), prev: addDays(start, -7), label: `Week of ${start}` };
  }
  if (period === 'month') {
    const start = `${y}-${pad(m)}-01`;
    const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const prev = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10);
    return { start, end: addDays(next, -1), prev, label: `${MONTHS[m - 1]} ${y}` };
  }
  if (period === 'year') return { start: `${y}-01-01`, end: `${y}-12-31`, prev: `${y - 1}-01-01`, label: String(y) };
  const bounds = dataBounds.get();
  return { start: bounds.first || day, end: today(), prev: null, label: 'Lifetime' };
}

function buckets(period, start, end, days) {
  const list = [];
  if (period === 'week' || period === 'month') {
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const { d: dd } = parseDay(d);
      list.push({ key: d, label: period === 'week' ? WEEKDAYS[weekday(d)] : String(dd), ...(days.get(d) ?? {}) });
    }
  } else if (period === 'year') {
    const { y } = parseDay(start);
    for (let m = 1; m <= 12; m++) {
      const prefix = `${y}-${String(m).padStart(2, '0')}`;
      const inMonth = [...days].filter(([d]) => d.startsWith(prefix)).map(([, o]) => o);
      list.push({ key: prefix, label: MONTHS[m - 1], ...sum(inMonth) });
    }
  } else {
    const years = new Map();
    for (const [d, o] of days) {
      const y = d.slice(0, 4);
      years.set(y, [...(years.get(y) ?? []), o]);
    }
    for (const [y, list2] of [...years].sort()) list.push({ key: y, label: y, ...sum(list2) });
  }
  return list;
}

api.get('/energy', (req, res) => {
  const period = ['day', 'week', 'month', 'year', 'lifetime'].includes(req.query.period) ? req.query.period : 'month';
  const day = validDay(req.query.date);

  if (period === 'day') {
    // Hourly energy from the power curve.
    const [from, to] = dayRange(day, tz());
    const pts = points(from, to);
    const hours = Array.from({ length: 24 }, (_, h) => ({ key: String(h), label: `${String(h).padStart(2, '0')}:00` }));
    for (let i = 0; i < pts.length; i++) {
      const o = pts[i];
      const width = Math.min((pts[i + 1]?.ts ?? o.ts + 900) - o.ts, 3600) / 3600;
      const b = hours[localParts(o.ts, tz()).hour];
      for (const m of ENERGY_METRICS) if (o[m] != null) b[m] = (b[m] ?? 0) + o[m] * width;
    }
    const totals = daily(day, day).get(day) ?? sum(hours);
    return res.json({ period, date: day, label: day, buckets: hours, totals, kpis: kpis(totals) });
  }

  const { start, end, prev, label } = periodBounds(period, day);
  const days = daily(start, end);
  const totals = sum([...days.values()]);
  let previous = null;
  if (prev) {
    const pb = periodBounds(period, prev);
    // Compare like-for-like: only as many days as have elapsed in the current period.
    const elapsed = Math.min(daysBetween(start, end), daysBetween(start, today()));
    const pEnd = addDays(pb.start, Math.max(0, elapsed));
    previous = sum([...daily(pb.start, pEnd < pb.end ? pEnd : pb.end).values()]);
  }
  res.json({
    period,
    date: day,
    start,
    end,
    label,
    buckets: buckets(period, start, end, days),
    totals,
    kpis: kpis(totals),
    previous,
    daysWithData: days.size,
  });
});

api.get('/calendar', (req, res) => {
  const year = Number(req.query.year) || Number(today().slice(0, 4));
  const days = daily(`${year}-01-01`, `${year}-12-31`);
  const list = [...days].map(([day, o]) => ({ day, production: o.production ?? null, consumption: o.consumption ?? null }));
  const bounds = dataBounds.get();
  res.json({
    year,
    days: list,
    years: bounds.first ? { first: Number(bounds.first.slice(0, 4)), last: Number(today().slice(0, 4)) } : null,
  });
});

api.get('/insights', (req, res) => {
  const t = today();
  const all = daily('0000-01-01', t);
  const allDays = [...all];
  const lifetime = sum(allDays.map(([, o]) => o));

  let bestDay = null;
  let worstDay = null;
  for (const [day, o] of allDays) {
    if (o.production == null || day === t) continue;
    if (!bestDay || o.production > bestDay.value) bestDay = { day, value: o.production };
    if (!worstDay || o.production < worstDay.value) worstDay = { day, value: o.production };
  }

  const last30 = allDays.filter(([d]) => d > addDays(t, -31) && d < t).map(([, o]) => o);
  const avg30 = last30.length ? sum(last30) : {};
  for (const k of Object.keys(avg30)) avg30[k] /= last30.length;

  const peak = db.prepare("SELECT ts, value FROM samples WHERE metric = 'production' ORDER BY value DESC LIMIT 1").get() ?? null;
  const peakLoad = db.prepare("SELECT ts, value FROM samples WHERE metric = 'consumption' ORDER BY value DESC LIMIT 1").get() ?? null;

  // Typical day: average power per 15-minute slot over the last 14 days.
  const since = nowTs() - 14 * 86400;
  const slots = Array.from({ length: 96 }, (_, i) => ({ slot: i, production: 0, consumption: 0, n: 0, nc: 0 }));
  for (const r of db
    .prepare("SELECT ts, metric, value FROM samples WHERE ts >= ? AND metric IN ('production','consumption')")
    .all(since)) {
    const p = localParts(r.ts, tz());
    const s = slots[p.hour * 4 + Math.floor(p.minute / 15)];
    if (r.metric === 'production') {
      s.production += r.value;
      s.n++;
    } else {
      s.consumption += r.value;
      s.nc++;
    }
  }
  const typical = slots.map((s) => ({
    slot: s.slot,
    label: `${String(Math.floor(s.slot / 4)).padStart(2, '0')}:${String((s.slot % 4) * 15).padStart(2, '0')}`,
    production: s.n ? s.production / s.n : null,
    consumption: s.nc ? s.consumption / s.nc : null,
  }));

  // Current month vs same month last year.
  const ym = t.slice(0, 7);
  const lastYm = `${Number(t.slice(0, 4)) - 1}${t.slice(4, 7)}`;
  const monthNow = sum(allDays.filter(([d]) => d.startsWith(ym)).map(([, o]) => o));
  const monthLastYear = sum(allDays.filter(([d]) => d.startsWith(lastYm) && d.slice(8) <= t.slice(8)).map(([, o]) => o));

  const peakKw = site()?.peakPowerKw;
  res.json({
    lifetime,
    lifetimeKpis: kpis(lifetime),
    bestDay,
    worstDay,
    avg30,
    peak,
    peakLoad,
    typical,
    daysTracked: allDays.length,
    specificYield: peakKw && avg30.production ? avg30.production / 1000 / peakKw : null,
    treesEquivalent: (kpis(lifetime).co2AvoidedKg || 0) / 21,
    monthCompare: { current: monthNow, lastYear: Object.keys(monthLastYear).length ? monthLastYear : null },
  });
});

api.get('/devices', (req, res) => {
  const day = validDay(req.query.date);
  const [from, to] = dayRange(day, tz());
  const rows = db
    .prepare("SELECT metric, ts, value FROM samples WHERE ts >= ? AND ts < ? AND (metric LIKE 'inverter:%' OR metric LIKE 'battery:%' OR metric LIKE 'meter:%') ORDER BY ts")
    .all(from, to);
  const telemetry = {};
  for (const r of rows) {
    const [kind, serial, name] = r.metric.split(':');
    const key = `${kind}:${serial}`;
    telemetry[key] ??= { kind, serial, metrics: {} };
    (telemetry[key].metrics[name] ??= []).push([r.ts, r.value]);
  }
  res.json({ date: day, from, to, devices: kv.get('devices', []), telemetry: Object.values(telemetry) });
});

api.post('/sync', async (req, res) => {
  if (config.demo) return res.json({ ok: true, demo: true });
  if (!isConnected()) return res.status(400).json({ error: 'Not connected to SolarEdge' });
  await runSync({ force: true });
  res.json({ ok: true, sync: syncState(), budget: budget() });
});
