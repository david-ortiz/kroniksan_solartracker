// Low-precision solar position (good to ~1°, plenty for a sky and an arc).

const RAD = Math.PI / 180;

/** Sun altitude in degrees above the horizon at a unix time (ms). */
export function sunAltitude(ms: number, lat: number, lon: number) {
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

export interface SunTimes {
  sunrise: number | null; // unix seconds
  sunset: number | null;
  noon: number;
  maxAltitude: number;
}

/** Sunrise, sunset and solar noon for the local day starting at `from` (unix seconds). */
export function sunTimes(from: number, to: number, lat: number, lon: number): SunTimes {
  const step = 120;
  let sunrise: number | null = null;
  let sunset: number | null = null;
  let noon = from;
  let maxAltitude = -90;
  let prev = sunAltitude(from * 1000, lat, lon);
  const horizon = -0.833;
  for (let t = from + step; t <= to; t += step) {
    const alt = sunAltitude(t * 1000, lat, lon);
    if (prev < horizon && alt >= horizon && sunrise == null) sunrise = t - step + (step * (horizon - prev)) / (alt - prev);
    if (prev >= horizon && alt < horizon) sunset = t - step + (step * (prev - horizon)) / (prev - alt);
    if (alt > maxAltitude) {
      maxAltitude = alt;
      noon = t;
    }
    prev = alt;
  }
  return { sunrise, sunset, noon, maxAltitude };
}

type RGB = [number, number, number];
const hex = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const css = (c: RGB) => `rgb(${c.map((v) => Math.round(v)).join(' ')})`;
const lerp = (a: RGB, b: RGB, t: number): RGB => a.map((v, i) => v + (b[i] - v) * t) as RGB;

// Sky keyframes by sun altitude: zenith colour, horizon colour, glow.
const SKY: [number, string, string, string][] = [
  [-18, '#04060d', '#0a1029', '#1b2350'],
  [-9, '#070b22', '#1d1c47', '#3a2f6b'],
  [-3, '#141a45', '#7a3f6a', '#c2587a'],
  [1, '#24306b', '#e0794a', '#ffb067'],
  [6, '#2c4f97', '#f0a86a', '#ffd08a'],
  [15, '#2459a8', '#79aee6', '#fff1c7'],
  [40, '#1b56b0', '#5f9fe3', '#ffffff'],
];

/** Hero sky colours for a sun altitude; stars fade in below the horizon. */
export function skyFor(altitude: number) {
  const a = Math.max(SKY[0][0], Math.min(SKY.at(-1)![0], altitude));
  let i = 0;
  while (i < SKY.length - 2 && a > SKY[i + 1][0]) i++;
  const [a0, t0, b0, g0] = SKY[i];
  const [a1, t1, b1, g1] = SKY[i + 1];
  const t = (a - a0) / (a1 - a0);
  return {
    top: css(lerp(hex(t0), hex(t1), t)),
    bottom: css(lerp(hex(b0), hex(b1), t)),
    glow: css(lerp(hex(g0), hex(g1), t)),
    stars: Math.max(0, Math.min(1, (-altitude - 2) / 8)),
    phase: altitude < -6 ? 'night' : altitude < 0 ? 'twilight' : altitude < 10 ? 'golden' : 'day',
  } as const;
}
