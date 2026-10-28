// E-ink endpoint for a Pimoroni Inky Impression 13.3" (1600 × 1200, Spectra 6).
//
// GET /api/eink.png            exact 6-colour indexed PNG for the panel
// GET /api/eink.png?preview=1  same layout in colours close to how the panel looks
// GET /api/eink.svg            the vector source, for debugging
//
// Everything is drawn in the panel's six inks only and rendered without
// anti-aliasing, so the Pi can show it as-is with no dithering.

import path from 'node:path';
import zlib from 'node:zlib';
import { Router } from 'express';
import { Resvg } from '@resvg/resvg-js';
import { config, ROOT } from './config.js';
import { dayData, liveSnapshot, recentDays, today } from './api.js';
import { site } from './sync.js';
import { localParts } from './time.js';
import { sunTimes } from './sun.js';

const W = 1600;
const H = 1200;
const M = 56;

const ORDER = ['black', 'white', 'yellow', 'red', 'blue', 'green'];
const INK = { black: [0, 0, 0], white: [255, 255, 255], yellow: [255, 255, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 255, 0] };
// Roughly what Spectra 6 pigments look like on the real panel.
const PREVIEW = { black: [30, 30, 30], white: [236, 234, 226], yellow: [228, 202, 44], red: [178, 46, 44], blue: [40, 66, 152], green: [44, 122, 82] };
const C = Object.fromEntries(ORDER.map((k) => [k, `#${INK[k].map((v) => v.toString(16).padStart(2, '0')).join('')}`]));

const FONTS = ['Regular', 'Medium', 'SemiBold', 'Bold'].map((w) => path.join(ROOT, 'server', 'fonts', `Geist-${w}.ttf`));

// ---------------------------------------------------------------- Formatting

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function powerParts(w) {
  if (w == null || !Number.isFinite(w)) return ['—', ''];
  const a = Math.abs(w);
  return a >= 1000 ? [(w / 1000).toFixed(a >= 10000 ? 1 : 2), 'kW'] : [String(Math.round(w)), 'W'];
}
const power = (w) => powerParts(w).join(' ').trim();

function energy(wh) {
  if (wh == null || !Number.isFinite(wh)) return '—';
  const a = Math.abs(wh);
  if (a >= 1e6) return `${(wh / 1e6).toFixed(2)} MWh`;
  if (a >= 1000) return `${(wh / 1000).toFixed(a >= 1e5 ? 0 : a >= 1e4 ? 1 : 2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

const money = (v) =>
  v == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: config.currency, maximumFractionDigits: 2 }).format(v);

function clock(ts, tz) {
  const p = localParts(ts, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** Greedy word wrap by estimated glyph width (Geist ≈ 0.53em average). */
function wrap(text, size, maxWidth, maxLines = 2) {
  const words = text.split(' ');
  const lines = [''];
  for (const word of words) {
    const next = lines.at(-1) ? `${lines.at(-1)} ${word}` : word;
    if (next.length * size * 0.53 > maxWidth && lines.at(-1)) lines.push(word);
    else lines[lines.length - 1] = next;
  }
  return lines.slice(0, maxLines);
}

function text(x, y, content, { size = 24, weight = 400, anchor = 'start', fill = C.black, spacing = 0 } = {}) {
  return `<text x="${x}" y="${y}" font-family="Geist" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${spacing ? ` letter-spacing="${spacing}"` : ''}>${content}</text>`;
}

function story(v) {
  const P = v.production ?? 0;
  const Cn = v.consumption ?? 0;
  const soc = v.soc != null ? `${Math.round(v.soc)}%` : null;
  if (P > 30) {
    const share = Cn > 0 ? Math.min(1, P / Cn) : 1;
    let s = share >= 0.995 ? 'Your panels are powering the whole home' : `Your panels are covering ${Math.round(share * 100)}% of your home`;
    if ((v.export ?? 0) > 30) s += `, sending ${power(v.export)} to the grid`;
    else if ((v.charge ?? 0) > 30) s += ' and charging the battery';
    return `${s}.`;
  }
  if ((v.discharge ?? 0) > 30) return `The battery is running the home${soc ? `, ${soc} left` : ''}.`;
  if ((v.charge ?? 0) > 30 && (v.import ?? 0) > 30) return `Charging the battery from the grid${soc ? `, now ${soc}` : ''}.`;
  if ((v.import ?? 0) > 30) return 'Your home is running on the grid right now.';
  return 'All quiet.';
}

function niceMax(v) {
  const steps = [500, 1000, 2000, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 20000];
  return steps.find((s) => s >= v) ?? Math.ceil(v / 5000) * 5000;
}

// ---------------------------------------------------------------- Layout

export function buildSvg() {
  const s = site();
  const tz = s?.timezone || 'UTC';
  const live = liveSnapshot();
  const day = dayData(today());
  const week = recentDays(7);
  const v = live.values;
  const k = live.today.kpis;
  const t = live.today.totals;
  const now = Math.floor(Date.now() / 1000);
  const lat = s?.latitude ?? s?.raw?.location?.latitude;
  const lon = s?.longitude ?? s?.raw?.location?.longitude;
  const sun = lat != null && lon != null ? sunTimes(day.from, day.to, lat, lon) : { sunrise: null, sunset: null };
  const peakW = (s?.peakPowerKw ?? 0) * 1000;
  const out = [];

  out.push(`<rect width="${W}" height="${H}" fill="${C.white}"/>`);
  out.push(`<defs>
    <pattern id="night" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="${C.black}"/>
    </pattern>
    <pattern id="batt" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="5" height="12" fill="${C.black}"/>
    </pattern>
  </defs>`);

  // Header
  const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date());
  const sub = [s?.location?.split(',')[0], s?.peakPowerKw ? `${s.peakPowerKw} kWp` : null, sun.sunrise && sun.sunset ? `sun ${clock(sun.sunrise, tz)} – ${clock(sun.sunset, tz)}` : null]
    .filter(Boolean)
    .join('  ·  ');
  out.push(text(M, 92, esc(dateLabel), { size: 46, weight: 700, spacing: -1 }));
  out.push(text(M, 134, esc(sub), { size: 26, weight: 500 }));
  out.push(text(W - M, 92, `Updated ${clock(now, tz)}`, { size: 30, weight: 600, anchor: 'end' }));
  out.push(text(W - M, 134, live.ts ? `Latest reading ${clock(live.ts, tz)}` : 'Waiting for data', { size: 24, weight: 500, anchor: 'end' }));
  out.push(`<rect x="${M}" y="160" width="${W - 2 * M}" height="4" fill="${C.black}"/>`);

  // ---- Left: solar now
  const LX = M;
  const LW = 800;
  out.push(text(LX, 222, 'SOLAR NOW', { size: 26, weight: 700, spacing: 4 }));
  const [num, unit] = powerParts(v.production);
  out.push(`<text x="${LX - 8}" y="418" font-family="Geist" font-size="236" font-weight="700" letter-spacing="-10" fill="${C.black}">${num}<tspan font-size="78" font-weight="600" letter-spacing="0" dx="22">${unit}</tspan></text>`);

  // Output vs system size gauge.
  const share = peakW > 0 && v.production != null ? Math.min(1, Math.max(0, v.production / peakW)) : 0;
  out.push(`<rect x="${LX}" y="448" width="${LW}" height="36" fill="${C.white}" stroke="${C.black}" stroke-width="4"/>`);
  if (share > 0) out.push(`<rect x="${LX + 4}" y="452" width="${Math.max(4, (LW - 8) * share)}" height="28" fill="${C.yellow}"/>`);
  if (peakW > 0) out.push(text(LX, 522, `${Math.round(share * 100)}% of the ${s.peakPowerKw} kWp system`, { size: 24, weight: 500 }));

  wrap(story(v), 34, LW).forEach((line, i) => out.push(text(LX, 576 + i * 44, esc(line), { size: 34, weight: 500 })));

  // Flow tiles: home, grid, battery.
  const grid = (v.import ?? 0) - (v.export ?? 0);
  const batt = (v.discharge ?? 0) - (v.charge ?? 0);
  const tiles = [
    { label: 'HOME', value: power(v.consumption), caption: 'using now', color: C.blue },
    {
      label: 'GRID',
      value: power(Math.abs(grid)),
      caption: Math.abs(grid) < 15 ? 'idle' : grid > 0 ? 'importing' : 'exporting',
      color: Math.abs(grid) < 15 ? C.black : grid > 0 ? C.red : C.green,
    },
    ...(v.soc != null || v.charge != null
      ? [
          {
            label: v.soc != null ? `BATTERY ${Math.round(v.soc)}%` : 'BATTERY',
            value: power(Math.abs(batt)),
            caption: Math.abs(batt) < 15 ? 'idle' : batt > 0 ? 'discharging' : 'charging',
            color: 'url(#batt)',
            soc: v.soc,
          },
        ]
      : []),
  ];
  const tw = (LW - (tiles.length - 1) * 20) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = LX + i * (tw + 20);
    const y = 648;
    out.push(`<rect x="${x}" y="${y}" width="${tw}" height="144" fill="${C.white}" stroke="${C.black}" stroke-width="4"/>`);
    out.push(`<rect x="${x + 2}" y="${y + 2}" width="${tw - 4}" height="16" fill="${tile.color}"/>`);
    out.push(`<rect x="${x}" y="${y + 18}" width="${tw}" height="3" fill="${C.black}"/>`);
    out.push(text(x + 20, y + 56, esc(tile.label), { size: 22, weight: 700, spacing: 2 }));
    out.push(text(x + 20, y + 104, tile.value, { size: 46, weight: 700, spacing: -1 }));
    out.push(text(x + 20, y + 132, tile.caption, { size: 22, weight: 500 }));
  });

  // ---- Right: today
  const RX = 920;
  const RW = W - M - RX;
  out.push(text(RX, 222, 'TODAY', { size: 26, weight: 700, spacing: 4 }));

  // Self-powered ring.
  const cx = RX + 104;
  const cy = 344;
  const r = 92;
  const ss = Math.min(1, Math.max(0, k.selfSufficiency ?? 0));
  const circ = 2 * Math.PI * r;
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.black}" stroke-width="3"/>`);
  if (ss > 0) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.green}" stroke-width="30" stroke-dasharray="${(circ * ss).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  out.push(text(cx, cy + 20, k.selfSufficiency == null ? '—' : `${Math.round(ss * 100)}%`, { size: 58, weight: 700, anchor: 'middle', spacing: -2 }));
  out.push(text(cx, cy + r + 52, 'self-powered', { size: 24, weight: 500, anchor: 'middle' }));

  // Produced / used.
  const SX = RX + 260;
  out.push(`<rect x="${SX}" y="252" width="22" height="22" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`);
  out.push(text(SX + 34, 272, 'Produced', { size: 26, weight: 500 }));
  out.push(text(SX, 340, energy(t.production), { size: 58, weight: 700, spacing: -2 }));
  out.push(`<rect x="${SX}" y="376" width="22" height="22" fill="${C.blue}"/>`);
  out.push(text(SX + 34, 396, 'Used', { size: 26, weight: 500 }));
  out.push(text(SX, 464, energy(t.consumption), { size: 58, weight: 700, spacing: -2 }));

  // Detail rows.
  const rows = [
    { swatch: C.red, label: 'From grid', value: `${energy(t.import)} · ${money(k.gridCost)}` },
    { swatch: C.green, label: 'To grid', value: `${energy(t.export)} · ${money(k.exportRevenue)}` },
    ...(t.charge != null || t.discharge != null ? [{ swatch: 'url(#batt)', label: 'Battery in / out', value: `${energy(t.charge)} / ${energy(t.discharge)}` }] : []),
    { swatch: C.yellow, label: 'Solar value', value: money(k.savings) },
  ];
  const rowTop = 530;
  const rowH = 66;
  out.push(`<rect x="${RX}" y="${rowTop - 12}" width="${RW}" height="3" fill="${C.black}"/>`);
  rows.forEach((row, i) => {
    const y = rowTop + i * rowH + 36;
    out.push(`<rect x="${RX}" y="${y - 22}" width="22" height="22" fill="${row.swatch}" stroke="${C.black}" stroke-width="3"/>`);
    out.push(text(RX + 36, y, row.label, { size: 28, weight: 500 }));
    out.push(text(W - M, y, esc(row.value), { size: 32, weight: 700, anchor: 'end' }));
    if (i < rows.length - 1) out.push(`<rect x="${RX}" y="${y + 20}" width="${RW}" height="2" fill="${C.black}" />`);
  });

  out.push(`<rect x="${M}" y="826" width="${W - 2 * M}" height="4" fill="${C.black}"/>`);

  // ---- Bottom left: today's power curve
  const px0 = M + 78;
  const px1 = 1060;
  const py0 = 912;
  const py1 = 1112;
  out.push(text(M, 878, "TODAY'S POWER", { size: 26, weight: 700, spacing: 4 }));
  const legend = [
    ['Solar', `<rect width="26" height="18" y="-17" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`],
    ['Home', `<rect width="30" height="6" y="-11" fill="${C.blue}"/>`],
    ['Grid import', `<rect width="30" height="4" y="-10" fill="${C.red}"/>`],
  ];
  let lx = 560;
  for (const [label, swatch] of legend) {
    out.push(`<g transform="translate(${lx} 876)">${swatch}</g>`);
    out.push(text(lx + 40, 876, label, { size: 22, weight: 500 }));
    lx += 40 + label.length * 12 + 40;
  }

  const pts = day.points;
  const maxW = niceMax(Math.max(1000, ...pts.map((p) => Math.max(p.production ?? 0, p.consumption ?? 0, p.import ?? 0))));
  const X = (ts) => px0 + ((ts - day.from) / (day.to - day.from)) * (px1 - px0);
  const Y = (w) => py1 - (Math.max(0, w) / maxW) * (py1 - py0);

  if (sun.sunrise) out.push(`<rect x="${px0}" y="${py0}" width="${X(sun.sunrise) - px0}" height="${py1 - py0}" fill="url(#night)" opacity="1"/>`);
  if (sun.sunset) out.push(`<rect x="${X(sun.sunset)}" y="${py0}" width="${px1 - X(sun.sunset)}" height="${py1 - py0}" fill="url(#night)"/>`);
  for (const frac of [0.5, 1]) {
    const y = Y(maxW * frac);
    out.push(`<line x1="${px0}" x2="${px1}" y1="${y}" y2="${y}" stroke="${C.black}" stroke-width="2" stroke-dasharray="2 10"/>`);
    const w = maxW * frac;
    out.push(text(px0 - 14, y + 8, w >= 1000 ? `${+(w / 1000).toFixed(1)} kW` : `${w} W`, { size: 20, weight: 500, anchor: 'end' }));
  }

  const series = (m) => pts.filter((p) => p[m] != null).map((p) => [X(p.ts), Y(p[m])]);
  const solar = series('production');
  if (solar.length > 1) {
    const d = solar.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    out.push(`<path d="${d} L${solar.at(-1)[0].toFixed(1)} ${py1} L${solar[0][0].toFixed(1)} ${py1} Z" fill="${C.yellow}" stroke="${C.black}" stroke-width="3" stroke-linejoin="round"/>`);
  }
  const line = (pairs, color, width) =>
    pairs.length > 1 ? `<polyline points="${pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>` : '';
  out.push(line(series('import'), C.red, 4));
  out.push(line(series('consumption'), C.blue, 6));

  out.push(`<rect x="${px0}" y="${py1}" width="${px1 - px0}" height="4" fill="${C.black}"/>`);
  for (let h = 0; h <= 24; h += 3) {
    const x = px0 + (h / 24) * (px1 - px0);
    out.push(`<rect x="${x - 1}" y="${py1 + 4}" width="3" height="10" fill="${C.black}"/>`);
    out.push(text(x, py1 + 42, `${String(h % 24).padStart(2, '0')}:00`, { size: 20, weight: 500, anchor: h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }));
  }
  if (now > day.from && now < day.to) {
    const x = X(now);
    out.push(`<line x1="${x}" x2="${x}" y1="${py0 - 6}" y2="${py1}" stroke="${C.black}" stroke-width="3" stroke-dasharray="8 6"/>`);
    out.push(text(x, py0 - 14, 'now', { size: 20, weight: 600, anchor: 'middle' }));
  }

  // ---- Bottom right: last 7 days
  const BX = 1120;
  const BW = W - M - BX;
  const weekTotal = week.reduce((a, d) => a + (d.production ?? 0), 0);
  out.push(text(BX, 878, 'LAST 7 DAYS', { size: 26, weight: 700, spacing: 4 }));
  out.push(text(W - M, 878, energy(weekTotal), { size: 26, weight: 700, anchor: 'end' }));
  const bmax = Math.max(1, ...week.map((d) => d.production ?? 0));
  const slot = BW / week.length;
  const bw = Math.min(40, slot - 18);
  week.forEach((d, i) => {
    const cxb = BX + slot * i + slot / 2;
    const h = ((d.production ?? 0) / bmax) * 150;
    const isToday = i === week.length - 1;
    if (h > 0) out.push(`<rect x="${cxb - bw / 2}" y="${py1 - h}" width="${bw}" height="${h}" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`);
    const val = d.production == null ? '—' : (d.production / 1000).toFixed(d.production >= 10000 ? 0 : 1);
    out.push(text(cxb, py1 - h - 12, val, { size: 20, weight: 600, anchor: 'middle' }));
    const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${d.day}T12:00:00Z`));
    out.push(text(cxb, py1 + 42, isToday ? 'Today' : wd, { size: 20, weight: isToday ? 700 : 500, anchor: 'middle' }));
  });
  out.push(`<rect x="${BX}" y="${py1}" width="${BW}" height="4" fill="${C.black}"/>`);
  out.push(text(BX, py1 + 76, 'kWh produced per day', { size: 18, weight: 500 }));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------- Raster + PNG

function render(svg) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    background: C.white,
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Geist' },
    shapeRendering: 1, // crispEdges: no anti-aliasing, so every pixel is a pure ink
    textRendering: 0, // optimizeSpeed
  }).render();
  return { pixels: r.pixels, width: r.width, height: r.height };
}

/** Map RGBA pixels to the 6 inks (nearest colour), as PNG scanlines with filter bytes. */
function toIndexed({ pixels, width, height }) {
  const inks = ORDER.map((k) => INK[k]);
  const cache = new Map();
  const nearest = (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    let idx = cache.get(key);
    if (idx === undefined) {
      let best = Infinity;
      inks.forEach(([ir, ig, ib], i) => {
        const d = (r - ir) ** 2 + (g - ig) ** 2 + (b - ib) ** 2;
        if (d < best) {
          best = d;
          idx = i;
        }
      });
      cache.set(key, idx);
    }
    return idx;
  };
  const out = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width + 1);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3] / 255;
      const blend = (c) => Math.round(c * a + 255 * (1 - a));
      out[row + 1 + x] = nearest(blend(pixels[i]), blend(pixels[i + 1]), blend(pixels[i + 2]));
    }
  }
  return out;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(scanlines, width, height, palette) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 3; // indexed colour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('PLTE', Buffer.from(ORDER.flatMap((k) => palette[k]))),
    chunk('IDAT', zlib.deflateSync(scanlines, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function renderPng({ preview = false } = {}) {
  const raster = render(buildSvg());
  return encodePng(toIndexed(raster), raster.width, raster.height, preview ? PREVIEW : INK);
}

// ---------------------------------------------------------------- Routes

export const eink = Router();

eink.get('/eink.png', (req, res) => {
  try {
    const png = renderPng({ preview: req.query.preview === '1' || req.query.preview === 'true' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  } catch (err) {
    console.error('[eink]', err);
    res.status(500).json({ error: err.message });
  }
});

eink.get('/eink.svg', (req, res) => {
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).send(buildSvg());
});
