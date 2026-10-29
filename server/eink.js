// E-ink endpoint for a Pimoroni Inky Impression 13.3" (1600 × 1200, Spectra 6).
//
// GET /api/eink.png                       exact 6-colour indexed PNG, landscape 1600 × 1200
// GET /api/eink.png?orientation=portrait  portrait layout, 1200 × 1600 (also /api/eink-portrait.png)
// GET /api/eink.png?preview=1             same image in colours close to how the panel looks
// GET /api/eink.svg                       the vector source, for debugging
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

const M = 56;

const ORDER = ['black', 'white', 'yellow', 'red', 'blue', 'green'];
const INK = { black: [0, 0, 0], white: [255, 255, 255], yellow: [255, 255, 0], red: [255, 0, 0], blue: [0, 0, 255], green: [0, 255, 0] };
// Roughly what Spectra 6 pigments look like on the real panel.
const PREVIEW = { black: [30, 30, 30], white: [236, 234, 226], yellow: [228, 202, 44], red: [178, 46, 44], blue: [40, 66, 152], green: [44, 122, 82] };
export const C = Object.fromEntries(ORDER.map((k) => [k, `#${INK[k].map((v) => v.toString(16).padStart(2, '0')).join('')}`]));

const FONTS = [
  ...['Regular', 'Medium', 'SemiBold', 'Bold'].map((w) => `Geist-${w}.ttf`),
  'InstrumentSerif-Regular.ttf',
  'InstrumentSerif-Italic.ttf',
].map((f) => path.join(ROOT, 'server', 'fonts', f));

// ---------------------------------------------------------------- Formatting

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function powerParts(w) {
  if (w == null || !Number.isFinite(w)) return ['—', ''];
  const a = Math.abs(w);
  return a >= 1000 ? [(w / 1000).toFixed(a >= 10000 ? 1 : 2), 'kW'] : [String(Math.round(w)), 'W'];
}
export const power = (w) => powerParts(w).join(' ').trim();

export function energy(wh) {
  if (wh == null || !Number.isFinite(wh)) return '—';
  const a = Math.abs(wh);
  if (a >= 1e6) return `${(wh / 1e6).toFixed(2)} MWh`;
  if (a >= 1000) return `${(wh / 1000).toFixed(a >= 1e5 ? 0 : a >= 1e4 ? 1 : 2)} kWh`;
  return `${Math.round(wh)} Wh`;
}

export const money = (v) =>
  v == null ? '—' : new Intl.NumberFormat('en-GB', { style: 'currency', currency: config.currency, maximumFractionDigits: 2 }).format(v);

export function clock(ts, tz) {
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

export function text(x, y, content, { size = 24, weight = 400, anchor = 'start', fill = C.black, spacing = 0 } = {}) {
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

// Coordinates for each orientation. Landscape is the panel's native 1600 × 1200;
// portrait stacks the same sections into 1200 × 1600.
const LAYOUTS = {
  landscape: {
    w: 1600,
    h: 1200,
    rules: [160, 826],
    solar: { x: M, w: 800, labelY: 222, numY: 418, numSize: 236, unitSize: 78, gaugeY: 448, captionY: 522, storyY: 576 },
    tiles: { x: M, w: 800, y: 648 },
    today: { x: 920, labelY: 222, ring: { cx: 1024, cy: 344, r: 92 }, statsX: 1180, producedY: 272, usedY: 396, rows: { x: 920, top: 530, h: 66, label: 28, value: 32 } },
    chart: { titleY: 878, legend: { x: 560, y: 876 }, px0: M + 78, px1: 1060, py0: 912, py1: 1112, step: 3 },
    week: { x: 1120, titleY: 878, totalBelow: false, py1: 1112, maxH: 150 },
  },
  portrait: {
    w: 1200,
    h: 1600,
    rules: [160, 806, 1166],
    solar: { x: M, w: 1088, labelY: 214, numY: 404, numSize: 230, unitSize: 76, gaugeY: 434, captionY: 506, storyY: 558 },
    tiles: { x: M, w: 1088, y: 630 },
    today: { x: M, labelY: 856, ring: { cx: M + 100, cy: 980, r: 88 }, statsX: M + 250, producedY: 906, usedY: 1030, rows: { x: 620, top: 878, h: 66, label: 25, value: 28 } },
    chart: { titleY: 1214, legend: { x: M, y: 1254 }, px0: M + 78, px1: 760, py0: 1290, py1: 1500, step: 6 },
    week: { x: 810, titleY: 1214, totalBelow: true, py1: 1500, maxH: 170 },
  },
};

export function collect() {
  const s = site();
  const tz = s?.timezone || 'UTC';
  const live = liveSnapshot();
  const day = dayData(today());
  const lat = s?.latitude ?? s?.raw?.location?.latitude;
  const lon = s?.longitude ?? s?.raw?.location?.longitude;
  return {
    s,
    tz,
    live,
    day,
    week: recentDays(7),
    v: live.values,
    k: live.today.kpis,
    t: live.today.totals,
    now: Math.floor(Date.now() / 1000),
    sun: lat != null && lon != null ? sunTimes(day.from, day.to, lat, lon) : { sunrise: null, sunset: null },
    peakW: (s?.peakPowerKw ?? 0) * 1000,
  };
}

/** "9.72 / 3.09 kWh" when both sides share a unit, otherwise each with its own. */
function energyPair(a, b) {
  if (a != null && b != null && a >= 1000 && b >= 1000 && a < 1e5 && b < 1e5) return `${(a / 1000).toFixed(2)} / ${(b / 1000).toFixed(2)} kWh`;
  return `${energy(a)} / ${energy(b)}`;
}

function drawHeader(out, d, L) {
  const dateLabel = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: d.tz }).format(new Date());
  const sub = [d.s?.location?.split(',')[0], d.s?.peakPowerKw ? `${d.s.peakPowerKw} kWp` : null, d.sun.sunrise && d.sun.sunset ? `sun ${clock(d.sun.sunrise, d.tz)} – ${clock(d.sun.sunset, d.tz)}` : null]
    .filter(Boolean)
    .join('  ·  ');
  out.push(text(M, 92, esc(dateLabel), { size: 46, weight: 700, spacing: -1 }));
  out.push(text(M, 134, esc(sub), { size: 26, weight: 500 }));
  out.push(text(L.w - M, 92, `Updated ${clock(d.now, d.tz)}`, { size: 30, weight: 600, anchor: 'end' }));
  out.push(text(L.w - M, 134, d.live.ts ? `Latest reading ${clock(d.live.ts, d.tz)}` : 'Waiting for data', { size: 24, weight: 500, anchor: 'end' }));
  for (const y of L.rules) out.push(`<rect x="${M}" y="${y}" width="${L.w - 2 * M}" height="4" fill="${C.black}"/>`);
}

function drawSolarNow(out, d, S) {
  const { v, peakW } = d;
  out.push(text(S.x, S.labelY, 'SOLAR NOW', { size: 26, weight: 700, spacing: 4 }));
  const [num, unit] = powerParts(v.production);
  out.push(`<text x="${S.x - 8}" y="${S.numY}" font-family="Geist" font-size="${S.numSize}" font-weight="700" letter-spacing="-10" fill="${C.black}">${num}<tspan font-size="${S.unitSize}" font-weight="600" letter-spacing="0" dx="22">${unit}</tspan></text>`);

  // Output vs system size gauge.
  const share = peakW > 0 && v.production != null ? Math.min(1, Math.max(0, v.production / peakW)) : 0;
  out.push(`<rect x="${S.x}" y="${S.gaugeY}" width="${S.w}" height="36" fill="${C.white}" stroke="${C.black}" stroke-width="4"/>`);
  if (share > 0) out.push(`<rect x="${S.x + 4}" y="${S.gaugeY + 4}" width="${Math.max(4, (S.w - 8) * share)}" height="28" fill="${C.yellow}"/>`);
  if (peakW > 0) out.push(text(S.x, S.captionY, `${Math.round(share * 100)}% of the ${d.s.peakPowerKw} kWp system`, { size: 24, weight: 500 }));

  wrap(story(v), 34, S.w).forEach((line, i) => out.push(text(S.x, S.storyY + i * 44, esc(line), { size: 34, weight: 500 })));
}

function drawTiles(out, d, T) {
  const { v } = d;
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
          },
        ]
      : []),
  ];
  const tw = (T.w - (tiles.length - 1) * 20) / tiles.length;
  tiles.forEach((tile, i) => {
    const x = T.x + i * (tw + 20);
    const y = T.y;
    out.push(`<rect x="${x}" y="${y}" width="${tw}" height="144" fill="${C.white}" stroke="${C.black}" stroke-width="4"/>`);
    out.push(`<rect x="${x + 2}" y="${y + 2}" width="${tw - 4}" height="16" fill="${tile.color}"/>`);
    out.push(`<rect x="${x}" y="${y + 18}" width="${tw}" height="3" fill="${C.black}"/>`);
    out.push(text(x + 20, y + 56, esc(tile.label), { size: 22, weight: 700, spacing: 2 }));
    out.push(text(x + 20, y + 104, tile.value, { size: 46, weight: 700, spacing: -1 }));
    out.push(text(x + 20, y + 132, tile.caption, { size: 22, weight: 500 }));
  });
}

function drawToday(out, d, D, width) {
  const { k, t } = d;
  out.push(text(D.x, D.labelY, 'TODAY', { size: 26, weight: 700, spacing: 4 }));

  // Self-powered ring.
  const { cx, cy, r } = D.ring;
  const ss = Math.min(1, Math.max(0, k.selfSufficiency ?? 0));
  const circ = 2 * Math.PI * r;
  out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.black}" stroke-width="3"/>`);
  if (ss > 0) out.push(`<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.green}" stroke-width="30" stroke-dasharray="${(circ * ss).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>`);
  out.push(text(cx, cy + 20, k.selfSufficiency == null ? '—' : `${Math.round(ss * 100)}%`, { size: 58, weight: 700, anchor: 'middle', spacing: -2 }));
  out.push(text(cx, cy + r + 52, 'self-powered', { size: 24, weight: 500, anchor: 'middle' }));

  // Produced / used.
  const SX = D.statsX;
  out.push(`<rect x="${SX}" y="${D.producedY - 20}" width="22" height="22" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`);
  out.push(text(SX + 34, D.producedY, 'Produced', { size: 26, weight: 500 }));
  out.push(text(SX, D.producedY + 68, energy(t.production), { size: 58, weight: 700, spacing: -2 }));
  out.push(`<rect x="${SX}" y="${D.usedY - 20}" width="22" height="22" fill="${C.blue}"/>`);
  out.push(text(SX + 34, D.usedY, 'Used', { size: 26, weight: 500 }));
  out.push(text(SX, D.usedY + 68, energy(t.consumption), { size: 58, weight: 700, spacing: -2 }));

  // Detail rows.
  const R = D.rows;
  const rows = [
    { swatch: C.red, label: 'From grid', value: `${energy(t.import)} · ${money(k.gridCost)}` },
    { swatch: C.green, label: 'To grid', value: `${energy(t.export)} · ${money(k.exportRevenue)}` },
    ...(t.charge != null || t.discharge != null ? [{ swatch: 'url(#batt)', label: 'Battery in/out', value: energyPair(t.charge, t.discharge) }] : []),
    { swatch: C.yellow, label: 'Solar value', value: money(k.savings) },
  ];
  out.push(`<rect x="${R.x}" y="${R.top - 12}" width="${width - M - R.x}" height="3" fill="${C.black}"/>`);
  rows.forEach((row, i) => {
    const y = R.top + i * R.h + 36;
    out.push(`<rect x="${R.x}" y="${y - 22}" width="22" height="22" fill="${row.swatch}" stroke="${C.black}" stroke-width="3"/>`);
    out.push(text(R.x + 36, y, row.label, { size: R.label, weight: 500 }));
    out.push(text(width - M, y, esc(row.value), { size: R.value, weight: 700, anchor: 'end' }));
    if (i < rows.length - 1) out.push(`<rect x="${R.x}" y="${y + 20}" width="${width - M - R.x}" height="2" fill="${C.black}" />`);
  });
}

function drawChart(out, d, P) {
  const { day, sun, now } = d;
  const { px0, px1, py0, py1 } = P;
  out.push(text(M, P.titleY, 'TODAY&#8217;S POWER', { size: 26, weight: 700, spacing: 4 }));
  const legend = [
    ['Solar', `<rect width="26" height="18" y="-17" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`],
    ['Home', `<rect width="30" height="6" y="-11" fill="${C.blue}"/>`],
    ['Grid import', `<rect width="30" height="4" y="-10" fill="${C.red}"/>`],
  ];
  let lx = P.legend.x;
  for (const [label, swatch] of legend) {
    out.push(`<g transform="translate(${lx} ${P.legend.y})">${swatch}</g>`);
    out.push(text(lx + 40, P.legend.y, label, { size: 22, weight: 500 }));
    lx += 40 + label.length * 12 + 40;
  }

  const pts = day.points;
  const maxW = niceMax(Math.max(1000, ...pts.map((p) => Math.max(p.production ?? 0, p.consumption ?? 0, p.import ?? 0))));
  const X = (ts) => px0 + ((ts - day.from) / (day.to - day.from)) * (px1 - px0);
  const Y = (w) => py1 - (Math.max(0, w) / maxW) * (py1 - py0);

  if (sun.sunrise) out.push(`<rect x="${px0}" y="${py0}" width="${X(sun.sunrise) - px0}" height="${py1 - py0}" fill="url(#night)"/>`);
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
    const path = solar.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
    out.push(`<path d="${path} L${solar.at(-1)[0].toFixed(1)} ${py1} L${solar[0][0].toFixed(1)} ${py1} Z" fill="${C.yellow}" stroke="${C.black}" stroke-width="3" stroke-linejoin="round"/>`);
  }
  const line = (pairs, color, width) =>
    pairs.length > 1 ? `<polyline points="${pairs.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round"/>` : '';
  out.push(line(series('import'), C.red, 4));
  out.push(line(series('consumption'), C.blue, 6));

  out.push(`<rect x="${px0}" y="${py1}" width="${px1 - px0}" height="4" fill="${C.black}"/>`);
  for (let h = 0; h <= 24; h += P.step) {
    const x = px0 + (h / 24) * (px1 - px0);
    out.push(`<rect x="${x - 1}" y="${py1 + 4}" width="3" height="10" fill="${C.black}"/>`);
    out.push(text(x, py1 + 42, `${String(h % 24).padStart(2, '0')}:00`, { size: 20, weight: 500, anchor: h === 0 ? 'start' : h === 24 ? 'end' : 'middle' }));
  }
  if (now > day.from && now < day.to) {
    const x = X(now);
    out.push(`<line x1="${x}" x2="${x}" y1="${py0 - 6}" y2="${py1}" stroke="${C.black}" stroke-width="3" stroke-dasharray="8 6"/>`);
    out.push(text(x, py0 - 14, 'now', { size: 20, weight: 600, anchor: 'middle' }));
  }
}

function drawWeek(out, d, B, width) {
  const { week } = d;
  const BW = width - M - B.x;
  const total = week.reduce((a, x) => a + (x.production ?? 0), 0);
  out.push(text(B.x, B.titleY, 'LAST 7 DAYS', { size: 26, weight: 700, spacing: 4 }));
  if (B.totalBelow) out.push(text(B.x, B.titleY + 40, `${energy(total)} in total`, { size: 22, weight: 600 }));
  else out.push(text(width - M, B.titleY, energy(total), { size: 26, weight: 700, anchor: 'end' }));
  const bmax = Math.max(1, ...week.map((x) => x.production ?? 0));
  const slot = BW / week.length;
  const bw = Math.min(40, slot - 18);
  week.forEach((x, i) => {
    const cxb = B.x + slot * i + slot / 2;
    const h = ((x.production ?? 0) / bmax) * B.maxH;
    const isToday = i === week.length - 1;
    if (h > 0) out.push(`<rect x="${cxb - bw / 2}" y="${B.py1 - h}" width="${bw}" height="${h}" fill="${C.yellow}" stroke="${C.black}" stroke-width="3"/>`);
    const val = x.production == null ? '—' : (x.production / 1000).toFixed(x.production >= 10000 ? 0 : 1);
    out.push(text(cxb, B.py1 - h - 12, val, { size: 20, weight: 600, anchor: 'middle' }));
    const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${x.day}T12:00:00Z`));
    out.push(text(cxb, B.py1 + 42, isToday ? (slot < 56 ? 'Now' : 'Today') : wd, { size: 20, weight: isToday ? 700 : 500, anchor: 'middle' }));
  });
  out.push(`<rect x="${B.x}" y="${B.py1}" width="${BW}" height="4" fill="${C.black}"/>`);
  out.push(text(B.x, B.py1 + 76, 'kWh produced per day', { size: 18, weight: 500 }));
}

export function buildSvg({ orientation = 'landscape' } = {}) {
  const L = LAYOUTS[orientation] ?? LAYOUTS.landscape;
  const d = collect();
  const out = [];
  out.push(`<rect width="${L.w}" height="${L.h}" fill="${C.white}"/>`);
  out.push(`<defs>
    <pattern id="night" width="14" height="14" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="${C.black}"/>
    </pattern>
    <pattern id="batt" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <rect width="5" height="12" fill="${C.black}"/>
    </pattern>
  </defs>`);
  drawHeader(out, d, L);
  drawSolarNow(out, d, L.solar);
  drawTiles(out, d, L.tiles);
  drawToday(out, d, L.today, L.w);
  drawChart(out, d, L.chart);
  drawWeek(out, d, L.week, L.w);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.w}" height="${L.h}" viewBox="0 0 ${L.w} ${L.h}">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------- Raster + PNG

/** smooth only affects how embedded images are scaled; text and shapes are always crisp. */
function render(svg, { smooth = false } = {}) {
  const r = new Resvg(svg, {
    fitTo: { mode: 'original' },
    background: C.white,
    font: { fontFiles: FONTS, loadSystemFonts: false, defaultFontFamily: 'Geist' },
    // Text and shapes stay crisp even for artwork, so dithering can't fringe them with colour.
    shapeRendering: 1, // crispEdges
    textRendering: 0, // optimizeSpeed (no anti-aliasing)
    imageRendering: 0, // optimizeQuality
  }).render();
  return { pixels: r.pixels, width: r.width, height: r.height, png: () => r.asPng() };
}

/**
 * Floyd–Steinberg dither to the six inks, judging error against how the inks
 * really look (PREVIEW), so gradients and paintings keep their tones.
 */
function dither({ pixels, width, height }) {
  const look = ORDER.map((k) => PREVIEW[k]);
  const buf = new Float32Array(width * height * 3);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j += 3) {
    const a = pixels[i + 3] / 255;
    buf[j] = pixels[i] * a + 255 * (1 - a);
    buf[j + 1] = pixels[i + 1] * a + 255 * (1 - a);
    buf[j + 2] = pixels[i + 2] * a + 255 * (1 - a);
  }
  // Stretch input tones into the panel's narrower range (its white isn't paper-white, its black isn't pure).
  const lo = look[0];
  const hi = look[1];
  for (let j = 0; j < buf.length; j += 3) {
    for (let c = 0; c < 3; c++) buf[j + c] = lo[c] + (buf[j + c] / 255) * (hi[c] - lo[c]);
  }
  const out = Buffer.alloc((width + 1) * height);
  const spread = (x, y, er, eg, eb, f) => {
    if (x < 0 || x >= width || y >= height) return;
    const k = (y * width + x) * 3;
    buf[k] += er * f;
    buf[k + 1] += eg * f;
    buf[k + 2] += eb * f;
  };
  for (let y = 0; y < height; y++) {
    const ltr = y % 2 === 0; // serpentine scan avoids directional streaks
    for (let n = 0; n < width; n++) {
      const x = ltr ? n : width - 1 - n;
      const k = (y * width + x) * 3;
      // Clamp so error from colours the panel can't reach doesn't snowball across the image.
      const r = Math.min(255, Math.max(0, buf[k]));
      const g = Math.min(255, Math.max(0, buf[k + 1]));
      const b = Math.min(255, Math.max(0, buf[k + 2]));
      let best = Infinity;
      let idx = 0;
      for (let i = 0; i < look.length; i++) {
        const d = (r - look[i][0]) ** 2 + (g - look[i][1]) ** 2 + (b - look[i][2]) ** 2;
        if (d < best) {
          best = d;
          idx = i;
        }
      }
      out[y * (width + 1) + 1 + x] = idx;
      const er = (r - look[idx][0]) * 0.85;
      const eg = (g - look[idx][1]) * 0.85;
      const eb = (b - look[idx][2]) * 0.85;
      const dir = ltr ? 1 : -1;
      spread(x + dir, y, er, eg, eb, 7 / 16);
      spread(x - dir, y + 1, er, eg, eb, 3 / 16);
      spread(x, y + 1, er, eg, eb, 5 / 16);
      spread(x + dir, y + 1, er, eg, eb, 1 / 16);
    }
  }
  return out;
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

/** Rasterise any SVG to an indexed PNG in the panel's six inks. */
export function svgToPng(svg, { preview = false } = {}) {
  const raster = render(svg);
  return encodePng(toIndexed(raster), raster.width, raster.height, preview ? PREVIEW : INK);
}

/**
 * Full-colour artwork. mode 'color': plain RGB PNG; the display (e.g. InkyPi) dithers it.
 * 'dither': pre-dithered to the six pure inks. 'preview': dithered in panel-like colours.
 */
export function svgToColorPng(svg, { mode = 'color' } = {}) {
  const raster = render(svg, { smooth: true });
  if (mode === 'color') return raster.png();
  return encodePng(dither(raster), raster.width, raster.height, mode === 'preview' ? PREVIEW : INK);
}

export function renderPng({ preview = false, orientation = 'landscape' } = {}) {
  return svgToPng(buildSvg({ orientation }), { preview });
}

// ---------------------------------------------------------------- Routes

export const eink = Router();

const orientationOf = (req) => (req.query.orientation === 'portrait' ? 'portrait' : 'landscape');

function sendPng(req, res, orientation) {
  try {
    const png = renderPng({ preview: req.query.preview === '1' || req.query.preview === 'true', orientation });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  } catch (err) {
    console.error('[eink]', err);
    res.status(500).json({ error: err.message });
  }
}

eink.get('/eink.png', (req, res) => sendPng(req, res, orientationOf(req)));
eink.get('/eink-portrait.png', (req, res) => sendPng(req, res, 'portrait'));

eink.get('/eink.svg', (req, res) => {
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).send(buildSvg({ orientation: orientationOf(req) }));
});
