import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new DatabaseSync(path.join(config.dataDir, config.demo ? 'demo.db' : 'solar.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  CREATE TABLE IF NOT EXISTS kv (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
  );

  -- Power and state samples. ts = bucket start (unix seconds).
  -- Site metrics: production, consumption, import, export, charge, discharge (W),
  -- soc (%), battery_energy (Wh). Device metrics: "inverter:<serial>:<name>".
  CREATE TABLE IF NOT EXISTS samples (
    metric TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (metric, ts)
  ) WITHOUT ROWID;

  -- Lifetime energy counters (Wh) per device: metric = "<direction>@<serial>".
  CREATE TABLE IF NOT EXISTS counters (
    metric TEXT NOT NULL,
    ts INTEGER NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (metric, ts)
  ) WITHOUT ROWID;

  -- Daily energy (Wh) per metric, by source: counter > api > power (integrated).
  CREATE TABLE IF NOT EXISTS daily (
    metric TEXT NOT NULL,
    day TEXT NOT NULL,
    source TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (metric, day, source)
  ) WITHOUT ROWID;

  -- Credit ledger: every request that reached SolarEdge.
  CREATE TABLE IF NOT EXISTS api_calls (
    id INTEGER PRIMARY KEY,
    ts INTEGER NOT NULL,
    path TEXT NOT NULL,
    status INTEGER NOT NULL,
    ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS api_calls_ts ON api_calls (ts);
`);

const getKv = db.prepare('SELECT v FROM kv WHERE k = ?');
const setKv = db.prepare('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT (k) DO UPDATE SET v = excluded.v');
const delKv = db.prepare('DELETE FROM kv WHERE k = ?');

export const kv = {
  get(key, fallback = null) {
    const row = getKv.get(key);
    return row ? JSON.parse(row.v) : fallback;
  },
  set(key, value) {
    setKv.run(key, JSON.stringify(value));
  },
  delete(key) {
    delKv.run(key);
  },
};

const upsertSample = db.prepare(
  'INSERT INTO samples (metric, ts, value) VALUES (?, ?, ?) ON CONFLICT (metric, ts) DO UPDATE SET value = excluded.value',
);
const upsertCounter = db.prepare(
  'INSERT INTO counters (metric, ts, value) VALUES (?, ?, ?) ON CONFLICT (metric, ts) DO UPDATE SET value = excluded.value',
);
const upsertDaily = db.prepare(
  'INSERT INTO daily (metric, day, source, value) VALUES (?, ?, ?, ?) ON CONFLICT (metric, day, source) DO UPDATE SET value = excluded.value',
);

export function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** rows: [metric, ts, value][] */
export const writeSamples = (rows) => transaction(() => rows.forEach((r) => upsertSample.run(...r)));
export const writeCounters = (rows) => transaction(() => rows.forEach((r) => upsertCounter.run(...r)));
/** rows: [metric, day, source, value][] */
export const writeDaily = (rows) => transaction(() => rows.forEach((r) => upsertDaily.run(...r)));
