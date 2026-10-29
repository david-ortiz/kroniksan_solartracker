// Background sync with a credit budget.
//
// The free tier gives 2,000 credits a month (1 per call, 10 per minute). The
// dashboard never calls SolarEdge itself: it reads the local database, and this
// scheduler spends credits in groups, spacing them out by what's left.

import { config } from './config.js';
import { db, kv } from './db.js';
import {
  ingestCounters,
  ingestInverterTelemetry,
  ingestMeterTelemetry,
  ingestStorageTelemetry,
  deriveConsumption,
  deriveProduction,
  rebuildDays,
} from './ingest.js';
import * as se from './solaredge.js';
import { localParts, nowTs, parseDay, fromLocal, addDays, localDay } from './time.js';
import { writeDaily } from './db.js';

const MIN = 60;
const HOUR = 3600;
const DAY = 86400;
const TICK_MS = 5 * 60 * 1000;
const TELEMETRY_SPAN = 12 * HOUR; // max window per telemetry call
const COUNTER_SPAN = 7 * DAY - 5 * MIN; // API max for lifetime-energy windows
const LAG = 45 * MIN; // re-read recent buckets, SolarEdge data lags 15-30 min

const GROUPS = {
  inventory: { every: 7 * DAY },
  counters: { every: 4 * HOUR },
  inverters: { every: 3 * HOUR },
  alerts: { every: DAY },
};

// ---------------------------------------------------------------- Status & log

const log = kv.get('sync_log', []);
function note(level, message) {
  log.unshift({ ts: nowTs(), level, message });
  log.length = Math.min(log.length, 60);
  kv.set('sync_log', log);
  (level === 'error' ? console.error : console.log)(`[sync] ${message}`);
}

export const syncLog = () => log;

// ---------------------------------------------------------------- Budget

export function cycle(now = nowTs()) {
  const d = new Date(now * 1000);
  let start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), config.billingDay);
  if (start / 1000 > now) start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, config.billingDay);
  const s = new Date(start);
  const end = Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, config.billingDay);
  return { start: start / 1000, end: end / 1000 };
}

const countCalls = db.prepare('SELECT COUNT(*) n FROM api_calls WHERE ts >= ?');
const callsByPath = db.prepare(
  `SELECT path, COUNT(*) n FROM api_calls WHERE ts >= ? GROUP BY path ORDER BY n DESC`,
);
const callsPerDay = db.prepare(
  `SELECT date(ts, 'unixepoch') day, COUNT(*) n FROM api_calls WHERE ts >= ? GROUP BY day ORDER BY day`,
);

export function budget() {
  const now = nowTs();
  const { start, end } = cycle(now);
  const used = countCalls.get(start).n;
  const remaining = Math.max(0, config.monthlyBudget - used);
  const daysLeft = Math.max((end - now) / DAY, 0.25);
  const elapsedDays = Math.max((now - start) / DAY, 0.25);
  return {
    budget: config.monthlyBudget,
    used,
    remaining,
    cycleStart: start,
    cycleEnd: end,
    perDayAllowance: remaining / daysLeft,
    projected: Math.round((used / elapsedDays) * ((end - start) / DAY)),
    byEndpoint: callsByPath.all(start).map((r) => ({ path: r.path.replace(/\/sites\/\d+/, ''), calls: r.n })),
    perDay: callsPerDay.all(start),
    exhausted: kv.get('credits_exhausted_until', 0) > now,
  };
}

const hasBattery = () => kv.get('has_battery', false) || (kv.get('devices', []) || []).some((d) => d.type === 'BATTERY');
const liveCost = () => 1 + (hasBattery() ? 1 : 0);

function isDaylight(ts, tz) {
  const h = localParts(ts, tz).hour;
  return h >= 6 && h < 21;
}

/** Seconds between live polls, from the credits left in the cycle. */
export function liveInterval(now = nowTs()) {
  const tz = site()?.timezone || 'UTC';
  const b = budget();
  const fixedPerDay = 2 * (DAY / GROUPS.counters.every) + DAY / GROUPS.inverters.every / 2 + 1 + 0.3;
  const livePerDay = Math.max(b.perDayAllowance - fixedPerDay, liveCost() * 4);
  const polls = livePerDay / liveCost();
  const dayPolls = Math.max(polls * 0.75, 1);
  const nightPolls = Math.max(polls * 0.25, 1);
  const interval = isDaylight(now, tz) ? (15 * HOUR) / dayPolls : (9 * HOUR) / nightPolls;
  return Math.round(Math.min(Math.max(interval, 15 * MIN), 6 * HOUR));
}

// ---------------------------------------------------------------- Site

export const site = () => kv.get('site');
const siteId = () => kv.get('site_id') || config.siteId;

async function refreshInventory() {
  const id = siteId();
  const body = await se.get(`/sites/${id}`);
  const location = body?.location || {};
  kv.set('site', {
    id: Number(body?.siteId ?? id),
    name: body?.name || `Site ${id}`,
    peakPowerKw: body?.peakPower ?? null,
    installationDate: body?.installationDate ?? null,
    activationStatus: body?.activationStatus ?? null,
    timezone: location.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    latitude: location.latitude ?? null,
    longitude: location.longitude ?? null,
    location: [location.city, location.state, location.country].filter(Boolean).join(', '),
    raw: body,
  });
  const types = ['INVERTER', 'METER', 'BATTERY', 'OPTIMIZER', 'EV_CHARGER', 'GATEWAY', 'BUI'];
  const devices = await se.get(`/sites/${id}/devices`, types.map((t) => ['types', t]));
  kv.set('devices', Array.isArray(devices) ? devices : []);
  note('info', `Inventory: ${kv.get('site').name}, ${kv.get('devices').length} devices`);
}

// ---------------------------------------------------------------- Windowed calls

/** Call a from/to endpoint. SolarEdge expects UTC instants ("…Z"). */
function windowed(path, from, to, extra = []) {
  return se.get(path, [...se.windowParams(from, to), ...extra]);
}

async function fetchTelemetry(kinds, from, to) {
  const id = siteId();
  const tz = site()?.timezone || 'UTC';
  const touched = [];
  for (let a = from; a < to; a += TELEMETRY_SPAN) {
    const b = Math.min(a + TELEMETRY_SPAN, to);
    const res = [['resolution', 'QUARTER_HOUR']];
    if (kinds.includes('meters')) touched.push(...ingestMeterTelemetry(await windowed(`/sites/${id}/meters/telemetry`, a, b, res)));
    if (kinds.includes('storage') && hasBattery())
      touched.push(...ingestStorageTelemetry(await windowed(`/sites/${id}/storage/telemetry`, a, b, res)));
    if (kinds.includes('inverters'))
      touched.push(...ingestInverterTelemetry(await windowed(`/sites/${id}/inverters/telemetry`, a, b, res)));
  }
  deriveProduction(from - HOUR, to + HOUR);
  deriveConsumption(from - HOUR, to + HOUR);
  rebuildDays(touched.length ? touched : [from, to], tz);
}

async function fetchCounters(from, to) {
  const id = siteId();
  const tz = site()?.timezone || 'UTC';
  const touched = [];
  for (let a = from; a < to; a += COUNTER_SPAN) {
    const b = Math.min(a + COUNTER_SPAN, to);
    const meters = await windowed(`/sites/${id}/meters/lifetime-energy`, a, b);
    touched.push(...ingestCounters(meters?.meters));
    if (hasBattery()) {
      const storage = await windowed(`/sites/${id}/storage/lifetime-energy`, a, b);
      touched.push(...ingestCounters(storage?.batteries));
    }
  }
  rebuildDays(touched, tz);
}

/** Daily production since installation from /energy (DAY allows at most 1 month per call). */
async function fetchEnergyHistory() {
  const s = site();
  const tz = s?.timezone || 'UTC';
  const today = localDay(nowTs(), tz);
  let cursor = kv.get('energy_history_cursor') || (s?.installationDate || addDays(today, -365)).slice(0, 10);
  while (cursor <= today) {
    const { y, m, d } = parseDay(cursor);
    const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const end = addDays(nextMonth, -1) < today ? addDays(nextMonth, -1) : today;
    const e = parseDay(addDays(end, 1));
    const body = await windowed(`/sites/${siteId()}/energy`, fromLocal(y, m, d, 0, 0, tz), fromLocal(e.y, e.m, e.d, 0, 0, tz), [
      ['resolution', 'DAY'],
      ['unit', 'WH'],
    ]);
    const rows = se
      .series(body?.values, body?.unit || 'WH')
      .map(([ts, v]) => ['production', localDay(ts, tz), 'api', v])
      // Today is still in progress: a partial total would outrank the live curve.
      .filter(([, day]) => day < today);
    writeDaily(rows);
    cursor = addDays(end, 1);
    kv.set('energy_history_cursor', cursor);
    if (!(await canBackfill())) return false;
  }
  return true;
}

// ---------------------------------------------------------------- Scheduler

const due = (key, every) => nowTs() - kv.get(`last_${key}`, 0) >= every;
const mark = (key) => kv.set(`last_${key}`, nowTs());

async function canBackfill() {
  const b = budget();
  // Spend on history only when there's clearly more than the live schedule needs.
  const spentToday = kv.get('backfill_day', {});
  const today = new Date().toISOString().slice(0, 10);
  const used = spentToday.day === today ? spentToday.n : 0;
  return b.remaining > 150 && b.perDayAllowance > 45 && used < Math.min(40, b.perDayAllowance * 0.5);
}

function countBackfill(n) {
  const today = new Date().toISOString().slice(0, 10);
  const cur = kv.get('backfill_day', {});
  kv.set('backfill_day', { day: today, n: (cur.day === today ? cur.n : 0) + n });
}

let running = null;
let timer = null;

export function syncState() {
  const last = kv.get('last_live', 0);
  return {
    running: Boolean(running),
    lastLive: last || null,
    nextLive: last ? last + liveInterval() : null,
    liveInterval: liveInterval(),
    lastCounters: kv.get('last_counters', null),
    lastInventory: kv.get('last_inventory', null),
    backfill: {
      energyHistory: kv.get('energy_history_done', false),
      powerDays: kv.get('power_backfill_done', false),
      countersCursor: kv.get('counter_backfill_cursor', null),
    },
  };
}

export function runSync({ force = false } = {}) {
  running ??= doSync(force)
    .catch((err) => {
      if (err instanceof se.CreditLimitError) {
        kv.set('credits_exhausted_until', cycle().end);
        note('error', 'Monthly credit limit reached. Polling paused until the next billing cycle.');
      } else if (err instanceof se.RateLimitError) {
        note('warn', 'Per-minute rate limit hit; will retry next tick.');
      } else {
        note('error', err.message);
      }
    })
    .finally(() => (running = null));
  return running;
}

async function doSync(force) {
  if (!se.isConnected() || !siteId()) return;
  if (kv.get('credits_exhausted_until', 0) > nowTs() && !force) return;
  const now = nowTs();

  if (!site() || due('inventory', GROUPS.inventory.every)) {
    mark('inventory');
    await refreshInventory();
  }
  const tz = site().timezone;

  // Live power: meters + storage since the last poll.
  if (force || due('live', liveInterval())) {
    mark('live');
    const last = kv.get('telemetry_to', now - 6 * HOUR);
    const from = Math.max(last - LAG, now - 2 * DAY);
    await fetchTelemetry(['meters', 'storage'], from, now);
    kv.set('telemetry_to', now);
    note('info', `Live data updated (next in ${Math.round(liveInterval() / 60)} min)`);
  }

  if (force || (isDaylight(now, tz) && due('inverters', GROUPS.inverters.every))) {
    mark('inverters');
    const last = kv.get('inverters_to', now - 6 * HOUR);
    await fetchTelemetry(['inverters'], Math.max(last - LAG, now - DAY), now);
    kv.set('inverters_to', now);
  }

  if (force || due('counters', GROUPS.counters.every)) {
    mark('counters');
    const last = kv.get('counters_to', now - 2 * DAY);
    await fetchCounters(Math.max(last - HOUR, now - 14 * DAY), now);
    kv.set('counters_to', now);
    if (!kv.get('counter_backfill_cursor')) kv.set('counter_backfill_cursor', now - 2 * DAY);
  }

  if (due('alerts', GROUPS.alerts.every)) {
    mark('alerts');
    const alerts = await se.get(`/sites/${siteId()}/alerts`, [['alerts-in-page', '100']]);
    kv.set('alerts', Array.isArray(alerts) ? alerts : alerts?.alerts ?? []);
  }

  await backfill(now, tz);
}

/** Run one backfill step; give up on it after 3 failures so errors can't drain credits. */
async function step(name, fn) {
  if (kv.get(`skip_${name}`)) return;
  try {
    await fn();
  } catch (err) {
    if (err instanceof se.CreditLimitError || err instanceof se.RateLimitError) throw err;
    const fails = kv.get(`fail_${name}`, 0) + 1;
    kv.set(`fail_${name}`, fails);
    note('warn', `Backfill "${name}" failed (${fails}/3): ${err.message}`);
    if (fails >= 3) kv.set(`skip_${name}`, true);
  }
}

async function backfill(now, tz) {
  await step('energy', () => backfillEnergy());
  await step('power', () => backfillPower(now));
  await step('counters', () => backfillCounters(now));
}

async function backfillEnergy() {
  // 1) Production history since installation (cheap: one call per year).
  if (!kv.get('energy_history_done') && (await canBackfill())) {
    const before = budget().used;
    if (await fetchEnergyHistory()) {
      kv.set('energy_history_done', true);
      note('info', 'Production history since installation imported');
    }
    countBackfill(budget().used - before);
  }
}

async function backfillPower(now) {
  // 2) A few days of detailed 15-minute curves.
  if (!kv.get('power_backfill_done') && (await canBackfill())) {
    let cursor = kv.get('power_backfill_cursor', now - 6 * HOUR);
    const stop = now - config.initialPowerDays * DAY;
    const before = budget().used;
    while (cursor > stop && (await canBackfill())) {
      const from = Math.max(cursor - TELEMETRY_SPAN, stop);
      await fetchTelemetry(['meters', 'storage', 'inverters'], from, cursor);
      cursor = from;
      kv.set('power_backfill_cursor', cursor);
      countBackfill(budget().used - before);
    }
    if (cursor <= stop) {
      kv.set('power_backfill_done', true);
      note('info', `Backfilled ${config.initialPowerDays} days of power curves`);
    }
  }
}

async function backfillCounters(now) {
  // 3) Lifetime counters back to installation, a week per step (import/export/consumption history).
  const s = site();
  const install = s?.installationDate ? Date.parse(s.installationDate) / 1000 : now - 365 * DAY;
  let cursor = kv.get('counter_backfill_cursor');
  while (cursor && cursor > install && (await canBackfill())) {
    const before = budget().used;
    const from = Math.max(cursor - COUNTER_SPAN, install);
    await fetchCounters(from, cursor);
    cursor = from;
    kv.set('counter_backfill_cursor', cursor);
    countBackfill(budget().used - before);
    if (cursor <= install) note('info', 'Energy counter history complete');
  }
}

/** One-time repair: production used to include battery discharge on hybrid inverters. */
function repairProduction() {
  if (kv.get('repair_production_v1') || !site()) return;
  const roles = kv.get('meter_roles', []);
  if (!roles.includes('production') && roles.includes('consumption')) {
    db.prepare("DELETE FROM samples WHERE metric = 'production'").run();
    deriveProduction(0, nowTs() + DAY);
    const all = db.prepare("SELECT DISTINCT ts FROM samples WHERE metric = 'production'").all().map((r) => r.ts);
    rebuildDays(all, site().timezone);
    note('info', 'Recalculated solar production from meter balance');
  }
  kv.set('repair_production_v1', true);
}

/** One-time: the history import used to save the day it ran on as a (partial) total. */
function dropPartialApiDay() {
  if (kv.get('repair_partial_api_day_v1')) return;
  db.prepare("DELETE FROM daily WHERE source = 'api' AND day = (SELECT MAX(day) FROM daily WHERE source = 'api')").run();
  kv.set('repair_partial_api_day_v1', true);
}

/** One-time: add grid→battery energy to days that already have 15-min data. */
function backfillGridCharge() {
  if (kv.get('repair_grid_charge_v1') || !site()) return;
  const all = db.prepare("SELECT DISTINCT ts FROM samples WHERE metric = 'charge'").all().map((r) => r.ts);
  rebuildDays(all, site().timezone);
  kv.set('repair_grid_charge_v1', true);
}

export function startScheduler() {
  if (timer) return;
  repairProduction();
  backfillGridCharge();
  dropPartialApiDay();
  setTimeout(() => runSync(), 3000);
  timer = setInterval(() => runSync(), TICK_MS);
}

/** After OAuth: remember the site and sync straight away. */
export function onConnected(id) {
  if (id) kv.set('site_id', String(id));
  kv.delete('credits_exhausted_until');
  note('info', `Connected to SolarEdge site ${siteId()}`);
  return runSync({ force: true });
}
