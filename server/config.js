import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const envFile = path.join(ROOT, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const env = (key, fallback = '') => (process.env[key] ?? '').trim() || fallback;
const num = (key, fallback) => {
  const value = Number(env(key));
  return Number.isFinite(value) && env(key) !== '' ? value : fallback;
};

const clientId = env('SOLAREDGE_CLIENT_ID');
const clientSecret = env('SOLAREDGE_CLIENT_SECRET');
const port = num('PORT', 8787);

export const config = {
  port,
  appUrl: env('APP_URL', `http://localhost:${port}`).replace(/\/$/, ''),
  clientId,
  clientSecret,
  // Optional: pin a site id. Normally it comes back from the OAuth redirect.
  siteId: env('SOLAREDGE_SITE_ID'),
  // Demo mode fills the dashboard with simulated data until real credentials exist.
  demo: env('DEMO') === 'true' || !clientId || !clientSecret,

  // Free tier: 2,000 credits / month, 10 calls / minute. Keep headroom.
  monthlyBudget: num('SOLAREDGE_MONTHLY_BUDGET', 1800),
  billingDay: num('SOLAREDGE_BILLING_DAY', 1),
  maxCallsPerMinute: Math.min(num('SOLAREDGE_MAX_CALLS_PER_MINUTE', 8), 10),
  // How many days of 15-minute power curves to fetch right after connecting.
  initialPowerDays: num('SOLAREDGE_INITIAL_POWER_DAYS', 3),

  // Money and CO2 figures shown on the dashboard.
  currency: env('CURRENCY', 'EUR'),
  importPrice: num('ENERGY_IMPORT_PRICE', 0.3),
  exportPrice: num('ENERGY_EXPORT_PRICE', 0.08),
  co2KgPerKwh: num('GRID_CO2_KG_PER_KWH', 0.4),

  dataDir: path.resolve(ROOT, env('DATA_DIR', 'data')),
};

config.redirectUri = `${config.appUrl}/auth/callback`;

export const SOLAREDGE = {
  apiBase: 'https://monitoringapi.solaredge.com/v2',
  authorizeUrl: 'https://connect.solaredge.com/authorize',
  tokenUrl: 'https://monitoringapi.solaredge.com/v2/oauth2/token',
  scopes: 'SITE_DATA DEVICE_DATA',
  // Months the consent grant stays valid (SolarEdge maximum).
  accessDuration: '24',
};
