// SolarEdge Monitoring API v2 client (Site Access, OAuth 2.0).
// Every API request costs one credit, so each one is written to the api_calls ledger.

import crypto from 'node:crypto';
import { config, SOLAREDGE } from './config.js';
import { db, kv } from './db.js';
import { formatUtcIso, nowTs } from './time.js';

export class SolarEdgeError extends Error {
  constructor(message, status = 0, body = '') {
    super(message);
    this.status = status;
    this.body = body;
  }
}
export class AuthError extends SolarEdgeError {}
export class RateLimitError extends SolarEdgeError {}
export class CreditLimitError extends SolarEdgeError {}

const logCall = db.prepare('INSERT INTO api_calls (ts, path, status, ms) VALUES (?, ?, ?, ?)');

// ---------------------------------------------------------------- OAuth

/** Sign-in link. SolarEdge returns `external_id` (not `state`) on the redirect. */
export function authorizeUrl() {
  const externalId = crypto.randomBytes(16).toString('base64url');
  kv.set('oauth_pending', { externalId, at: nowTs() });
  const url = new URL(SOLAREDGE.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    scope: SOLAREDGE.scopes,
    access_duration: SOLAREDGE.accessDuration,
    external_id: externalId,
    redirect_uri: config.redirectUri,
  }).toString();
  return url.toString();
}

async function tokenRequest(payload) {
  // SolarEdge's reference takes a JSON body with the client credentials. Older
  // guides show form-encoded + HTTP Basic, so fall back to that on a 4xx.
  const attempts = [
    () =>
      fetch(SOLAREDGE.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ ...payload, client_id: config.clientId, client_secret: config.clientSecret }),
      }),
    () =>
      fetch(SOLAREDGE.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
          Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
        },
        body: new URLSearchParams({ ...payload, redirect_uri: config.redirectUri }).toString(),
      }),
  ];
  let last;
  for (const attempt of attempts) {
    const res = await attempt();
    const text = await res.text();
    if (res.ok) return JSON.parse(text);
    last = new AuthError(`Token request failed (HTTP ${res.status}): ${text.slice(0, 300)}`, res.status, text);
    if (res.status === 429 || res.status >= 500) throw last;
  }
  throw last;
}

function storeTokens(data) {
  const previous = kv.get('tokens', {});
  kv.set('tokens', {
    accessToken: data.access_token,
    // Refresh tokens rotate: always keep the newest one.
    refreshToken: data.refresh_token || previous.refreshToken,
    expiresAt: nowTs() + Number(data.expires_in || 3600),
    obtainedAt: nowTs(),
  });
}

export async function exchangeCode(code) {
  storeTokens(await tokenRequest({ grant_type: 'authorization_code', code }));
}

let refreshing = null;

async function accessToken() {
  const tokens = kv.get('tokens');
  if (!tokens?.refreshToken && !tokens?.accessToken) throw new AuthError('Not connected to SolarEdge yet');
  if (tokens.accessToken && tokens.expiresAt - nowTs() > 120) return tokens.accessToken;
  if (!tokens.refreshToken) throw new AuthError('Access token expired and no refresh token stored');
  refreshing ??= tokenRequest({ grant_type: 'refresh_token', refresh_token: tokens.refreshToken })
    .then(storeTokens)
    .finally(() => (refreshing = null));
  await refreshing;
  return kv.get('tokens').accessToken;
}

export const isConnected = () => Boolean(kv.get('tokens')?.refreshToken || kv.get('tokens')?.accessToken);

// ---------------------------------------------------------------- Requests

const recentCalls = [];

async function throttle() {
  for (;;) {
    const now = Date.now();
    while (recentCalls.length && now - recentCalls[0] >= 60_000) recentCalls.shift();
    if (recentCalls.length < config.maxCallsPerMinute) break;
    await new Promise((r) => setTimeout(r, 60_000 - (now - recentCalls[0]) + 250));
  }
  recentCalls.push(Date.now());
}

export async function get(path, params = []) {
  const token = await accessToken();
  await throttle();
  const url = new URL(SOLAREDGE.apiBase + path);
  for (const [k, v] of params) url.searchParams.append(k, v);
  const started = Date.now();
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new SolarEdgeError(`Network error calling ${path}: ${err.message}`);
  }
  // The request reached the gateway, so assume it was billed.
  logCall.run(nowTs(), path, res.status, Date.now() - started);
  const text = await res.text();
  if (res.ok) return text ? JSON.parse(text) : null;

  const detail = text.slice(0, 300);
  if (res.status === 401) {
    // Force a refresh on the next call.
    const tokens = kv.get('tokens');
    if (tokens) kv.set('tokens', { ...tokens, expiresAt: 0 });
    throw new AuthError(`401 on ${path}: ${detail}`, 401, text);
  }
  if (res.status === 429) {
    const minuteLeft = res.headers.get('x-ratelimit-remaining-minute');
    if (/credit limit/i.test(text) || (minuteLeft && minuteLeft !== '0')) {
      throw new CreditLimitError(`Monthly credit limit reached: ${detail}`, 429, text);
    }
    throw new RateLimitError(`Rate limited on ${path}`, 429, text);
  }
  throw new SolarEdgeError(`HTTP ${res.status} on ${path}: ${detail}`, res.status, text);
}

// ---------------------------------------------------------------- Timestamps

// The API types from/to as Instants: UTC with a "Z" (offset-free local times are rejected).
export function windowParams(from, to) {
  return [
    ['from', formatUtcIso(from)],
    ['to', formatUtcIso(to)],
  ];
}

// ---------------------------------------------------------------- Units

const POWER = { W: 1, KW: 1e3, MW: 1e6 };
const ENERGY = { WH: 1, KWH: 1e3, MWH: 1e6, GWH: 1e9 };

export function toBase(value, unit) {
  const u = String(unit || '').toUpperCase();
  return value * (POWER[u] ?? ENERGY[u] ?? 1);
}

export function parseTs(value) {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** [{timestamp, value}] → [[ts, value]] without nulls. */
export function series(values, unit) {
  const out = [];
  for (const item of values || []) {
    const ts = parseTs(item?.timestamp);
    if (ts == null || typeof item.value !== 'number') continue;
    out.push([ts, unit && String(unit).toUpperCase() !== 'PERCENTAGE' ? toBase(item.value, unit) : item.value]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
