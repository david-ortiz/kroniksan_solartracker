const nf = (digits: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export function splitPower(w: number | null | undefined): [string, string] {
  if (w == null || !Number.isFinite(w)) return ['—', ''];
  const a = Math.abs(w);
  if (a >= 1e6) return [nf(2).format(w / 1e6), 'MW'];
  if (a >= 1000) return [nf(a >= 1e4 ? 1 : 2).format(w / 1000), 'kW'];
  return [nf(0).format(w), 'W'];
}

export function splitEnergy(wh: number | null | undefined): [string, string] {
  if (wh == null || !Number.isFinite(wh)) return ['—', ''];
  const a = Math.abs(wh);
  if (a >= 1e9) return [nf(2).format(wh / 1e9), 'GWh'];
  if (a >= 1e6) return [nf(a >= 1e8 ? 1 : 2).format(wh / 1e6), 'MWh'];
  if (a >= 1000) return [nf(a >= 1e5 ? 0 : a >= 1e4 ? 1 : 2).format(wh / 1000), 'kWh'];
  return [nf(0).format(wh), 'Wh'];
}

export const power = (w: number | null | undefined) => splitPower(w).join(' ').trim();
export const energy = (wh: number | null | undefined) => splitEnergy(wh).join(' ').trim();
export const kwh = (wh: number | null | undefined, digits = 1) => (wh == null ? '—' : `${nf(digits).format(wh / 1000)} kWh`);

export const pct = (v: number | null | undefined, digits = 0) => (v == null || !Number.isFinite(v) ? '—' : `${nf(digits).format(v * 100)}%`);

export function money(v: number | null | undefined, currency: string) {
  if (v == null || !Number.isFinite(v)) return '—';
  return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
}

export function mass(kg: number | null | undefined) {
  if (kg == null) return '—';
  return kg >= 1000 ? `${nf(kg >= 1e4 ? 1 : 2).format(kg / 1000)} t` : `${nf(kg >= 100 ? 0 : 1).format(kg)} kg`;
}

export const int = (v: number) => nf(0).format(v);

export function timeIn(ts: number, tz?: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(ts * 1000);
}

export function dateLabel(day: string, opts: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) {
  const [y, m, d] = day.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

export function ago(ts: number | null | undefined, now = Date.now() / 1000) {
  if (!ts) return 'never';
  const s = Math.round(now - ts);
  if (Math.abs(s) < 60) return s >= 0 ? 'just now' : 'in <1 min';
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 3600) return fmt.format(-Math.round(s / 60), 'minute');
  if (abs < 86400) return fmt.format(-Math.round(s / 3600), 'hour');
  return fmt.format(-Math.round(s / 86400), 'day');
}

export function delta(current: number | undefined, previous: number | undefined) {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / previous;
}

export function addDays(day: string, n: number) {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function shiftPeriod(day: string, period: string, dir: number) {
  const [y, m] = day.split('-').map(Number);
  if (period === 'day') return addDays(day, dir);
  if (period === 'week') return addDays(day, 7 * dir);
  if (period === 'month') return new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10);
  if (period === 'year') return `${y + dir}-01-01`;
  return day;
}

export function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Split camelCase API names: "acVoltage" → "AC voltage". */
export function metricName(s: string) {
  const words = s.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.replace(/^ac\b/, 'AC').replace(/^dc\b/, 'DC').replace(/^./, (c) => c.toUpperCase());
}

export function metricUnit(name: string) {
  const n = name.toLowerCase();
  if (n.includes('voltage')) return 'V';
  if (n.includes('current')) return 'A';
  if (n.includes('frequency')) return 'Hz';
  if (n.includes('temperature')) return '°C';
  if (n.includes('power') && !n.includes('factor')) return 'W';
  if (n.includes('energy')) return 'Wh';
  if (n.includes('state')) return '%';
  return '';
}

/** Compact power for chart axes: "500 W", "1.5 kW", "12 kW". */
export function axisPower(w: number) {
  const a = Math.abs(w);
  if (a < 1000) return `${Math.round(w)} W`;
  const k = w / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(a >= 10000 ? 0 : 1)} kW`;
}
