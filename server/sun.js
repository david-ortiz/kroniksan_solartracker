// Low-precision solar position (good to ~1°). Mirrors web/src/lib/sun.ts.

const RAD = Math.PI / 180;

/** Sun altitude in degrees at a unix time (ms). */
export function sunAltitude(ms, lat, lon) {
  const d = ms / 86400000 - 10957.5; // days since J2000.0
  const g = (357.529 + 0.98560028 * d) * RAD;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const e = (23.439 - 0.00000036 * d) * RAD;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const gmst = (((18.697374558 + 24.06570982441908 * d) % 24) + 24) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra;
  return Math.asin(Math.sin(lat * RAD) * Math.sin(dec) + Math.cos(lat * RAD) * Math.cos(dec) * Math.cos(ha)) / RAD;
}

/** Sunrise and sunset (unix seconds) within [from, to). */
export function sunTimes(from, to, lat, lon) {
  const step = 120;
  const horizon = -0.833;
  let sunrise = null;
  let sunset = null;
  let prev = sunAltitude(from * 1000, lat, lon);
  for (let t = from + step; t <= to; t += step) {
    const alt = sunAltitude(t * 1000, lat, lon);
    if (prev < horizon && alt >= horizon && sunrise == null) sunrise = t - step + (step * (horizon - prev)) / (alt - prev);
    if (prev >= horizon && alt < horizon) sunset = t - step + (step * (prev - horizon)) / (prev - alt);
    prev = alt;
  }
  return { sunrise, sunset };
}
