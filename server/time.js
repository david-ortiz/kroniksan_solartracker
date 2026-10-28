// Timezone helpers. All stored timestamps are unix seconds (UTC); days are site-local.

const partsCache = new Map();

function formatter(tz) {
  let f = partsCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(tz, f);
  }
  return f;
}

/** Wall-clock parts of a unix timestamp in a timezone. */
export function localParts(ts, tz) {
  const out = {};
  for (const p of formatter(tz).formatToParts(new Date(ts * 1000))) out[p.type] = p.value;
  return {
    year: +out.year,
    month: +out.month,
    day: +out.day,
    hour: +out.hour,
    minute: +out.minute,
    second: +out.second,
    weekday: out.weekday,
  };
}

/** Offset of the timezone from UTC at ts, in seconds. */
export function tzOffset(ts, tz) {
  const p = localParts(ts, tz);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) / 1000 - Math.floor(ts);
}

/** "YYYY-MM-DD" in the site timezone. */
export function localDay(ts, tz) {
  const p = localParts(ts, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Unix seconds of a local wall-clock time. */
export function fromLocal(year, month, day, hour = 0, minute = 0, tz) {
  const guess = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz); // second pass handles DST edges
  return ts;
}

export function parseDay(day) {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

/** [start, end) unix seconds of a local day. */
export function dayRange(day, tz) {
  const { y, m, d } = parseDay(day);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return [fromLocal(y, m, d, 0, 0, tz), fromLocal(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, tz)];
}

/** Calendar arithmetic on "YYYY-MM-DD" strings (timezone-free). */
export function addDays(day, n) {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(a, b) {
  const pa = parseDay(a);
  const pb = parseDay(b);
  return Math.round((Date.UTC(pb.y, pb.m - 1, pb.d) - Date.UTC(pa.y, pa.m - 1, pa.d)) / 86400000);
}

export function weekday(day) {
  const { y, m, d } = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
}

export function formatUtcIso(ts) {
  return new Date(Math.floor(ts) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export const nowTs = () => Math.floor(Date.now() / 1000);
