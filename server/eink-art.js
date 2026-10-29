// "Wall frame" e-ink design: a flat-colour poster scene that follows the real
// sun, with two big numbers underneath. Portrait 1200 × 1600, Spectra 6 inks.
//
// GET /api/eink-poster.png                 for the panel
// GET /api/eink-poster.png?preview=1       in colours close to how the panel looks
// GET /api/eink-poster.png?scene=day|night  force the day or night scene (for previewing)
// GET /api/eink-poster.svg                 the vector source

import { Router } from 'express';
import { C, clock, collect, esc, money, power, powerParts, svgToPng } from './eink.js';
import { sunAltitude } from './sun.js';

const W = 1200;
const H = 1600;
const SCENE_H = 860; // scene above, numbers below
const PAD = 80;

// ---------------------------------------------------------------- Helpers

function energyParts(wh) {
  if (wh == null || !Number.isFinite(wh)) return ['—', ''];
  const a = Math.abs(wh);
  if (a >= 1e6) return [(wh / 1e6).toFixed(2), 'MWh'];
  if (a >= 1000) return [(wh / 1000).toFixed(a >= 1e5 ? 0 : a >= 1e4 ? 1 : 2), 'kWh'];
  return [String(Math.round(wh)), 'Wh'];
}

/** Deterministic pseudo-random in [0, 1). */
const rand = (i, salt) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

function cloud(x, y, scale, ink, outline) {
  // Outline first (slightly bigger circles), then the fill, so only the outer edge shows.
  const lobes = [
    [0, 0, 62],
    [70, -30, 78],
    [150, -6, 64],
    [210, 14, 46],
    [-56, 18, 44],
  ];
  const draw = (grow, fill) =>
    lobes.map(([dx, dy, r]) => `<circle cx="${x + dx * scale}" cy="${y + dy * scale}" r="${(r + grow) * scale}" fill="${fill}"/>`).join('') +
    `<rect x="${x - 56 * scale - grow}" y="${y + 14 * scale}" width="${(266 + 0) * scale + grow * 2}" height="${(46 + grow) * scale}" rx="${(23 + grow) * scale}" fill="${fill}"/>`;
  return draw(6, outline) + draw(0, ink);
}

function house(x, base, night) {
  // A small house with a solar roof, seen from the front.
  const body = night ? C.black : C.white;
  const line = night ? C.white : C.black;
  const bw = 190;
  const bh = 104;
  const top = base - bh;
  const roofTop = top - 78;
  const out = [];
  // Roof plane as a trapezoid, panels follow its perspective.
  const left = [x - 18, top];
  const right = [x + bw + 18, top];
  const tl = [x + 26, roofTop];
  const tr = [x + bw - 26, roofTop];
  out.push(`<polygon points="${[left, right, tr, tl].map((p) => p.join(',')).join(' ')}" fill="${C.black}" stroke="${line}" stroke-width="5" stroke-linejoin="round"/>`);
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const rows = 2;
  const cols = 4;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const v0 = 0.14 + (r / rows) * 0.76;
      const v1 = 0.14 + ((r + 1) / rows) * 0.76 - 0.07;
      const edge = (v) => [lerp(left, tl, v), lerp(right, tr, v)];
      const [l0, r0] = edge(v0);
      const [l1, r1] = edge(v1);
      const u0 = 0.08 + (c / cols) * 0.84 + 0.015;
      const u1 = 0.08 + ((c + 1) / cols) * 0.84 - 0.015;
      const pts = [lerp(l0, r0, u0), lerp(l0, r0, u1), lerp(l1, r1, u1), lerp(l1, r1, u0)];
      out.push(`<polygon points="${pts.map((p) => p.map((n) => n.toFixed(1)).join(',')).join(' ')}" fill="${C.blue}"/>`);
    }
  }
  // Body, door, window.
  out.push(`<rect x="${x}" y="${top}" width="${bw}" height="${bh}" fill="${body}" stroke="${line}" stroke-width="5"/>`);
  out.push(`<rect x="${x + 30}" y="${top + 36}" width="42" height="${bh - 36}" fill="${line}"/>`);
  out.push(`<rect x="${x + 104}" y="${top + 26}" width="58" height="44" fill="${C.yellow}" stroke="${line}" stroke-width="4"/>`);
  out.push(`<rect x="${x + 131}" y="${top + 26}" width="4" height="44" fill="${line}"/>`);
  out.push(`<rect x="${x + 104}" y="${top + 46}" width="58" height="4" fill="${line}"/>`);
  return out.join('');
}

// ---------------------------------------------------------------- Scene

function scenery(d) {
  const { sun, now, s, v, peakW } = d;
  const lat = s?.latitude ?? s?.raw?.location?.latitude;
  const lon = s?.longitude ?? s?.raw?.location?.longitude;
  const night = sun.sunrise && sun.sunset ? now < sun.sunrise || now > sun.sunset : localHour(d) < 7 || localHour(d) >= 19;
  const out = [];
  const ink = night ? C.white : C.black;

  out.push(`<rect width="${W}" height="${SCENE_H}" fill="${night ? C.black : C.white}"/>`);

  if (night) {
    // Stars and a crescent moon.
    for (let i = 0; i < 70; i++) {
      const x = rand(i, 1) * W;
      const y = 90 + rand(i, 2) * 520;
      const r = rand(i, 3) < 0.15 ? 4 : 2.2;
      out.push(`<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${r}" fill="${C.white}"/>`);
    }
    out.push(`<circle cx="880" cy="250" r="86" fill="${C.white}"/>`);
    out.push(`<circle cx="922" cy="222" r="78" fill="${C.black}"/>`);
  } else {
    // The sun travels an arc from sunrise (left) to sunset (right).
    const t = sun.sunrise && sun.sunset ? Math.min(1, Math.max(0, (now - sun.sunrise) / (sun.sunset - sun.sunrise))) : 0.5;
    const sx = 150 + 900 * t;
    const sy = 700 - 470 * Math.sin(Math.PI * t);
    const R = 2000;
    const rays = 20;
    for (let i = 0; i < rays; i++) {
      const a = ((i / rays) * 360 * Math.PI) / 180;
      const w = (2.4 * Math.PI) / 180;
      const p = (ang, r) => `${(sx + Math.cos(ang) * r).toFixed(1)},${(sy + Math.sin(ang) * r).toFixed(1)}`;
      out.push(`<polygon points="${p(a - w * 0.25, 175)} ${p(a - w, R)} ${p(a + w, R)} ${p(a + w * 0.25, 175)}" fill="${C.yellow}"/>`);
    }
    out.push(`<circle cx="${sx}" cy="${sy}" r="140" fill="${C.white}"/>`);
    out.push(`<circle cx="${sx}" cy="${sy}" r="122" fill="${C.yellow}"/>`);

    // A few birds.
    for (const [bx, by, sc] of [
      [170, 500, 1],
      [245, 540, 0.8],
      [1000, 430, 0.9],
    ]) {
      if (Math.hypot(bx - sx, by - sy) < 220) continue;
      out.push(`<path d="M${bx - 26 * sc} ${by - 10 * sc} Q${bx - 12 * sc} ${by - 22 * sc} ${bx} ${by} Q${bx + 12 * sc} ${by - 22 * sc} ${bx + 26 * sc} ${by - 10 * sc}" fill="none" stroke="${C.black}" stroke-width="6" stroke-linecap="round"/>`);
    }

    // Clouds when the panels make much less than a clear sky would allow.
    const alt = lat != null && lon != null ? sunAltitude(now * 1000, lat, lon) : 30;
    const expected = peakW * Math.max(0, Math.sin((alt * Math.PI) / 180)) * 0.8;
    const ratio = expected > 200 ? (v.production ?? 0) / expected : 1;
    if (ratio < 0.7) out.push(cloud(sx - 210, sy + 70, 1.15, C.white, C.black));
    if (ratio < 0.35) out.push(cloud(sx + 40, sy - 20, 0.95, C.white, C.black));

  }

  // Rolling downs: far hills, then the near hill that runs into the panel below.
  out.push(`<path d="M0 640 C 170 575, 360 560, 560 615 S 930 690, 1200 590 L1200 ${SCENE_H} L0 ${SCENE_H} Z" fill="${night ? C.blue : C.green}"/>`);
  out.push(`<path d="M0 790 C 180 735, 380 725, 560 770 S 900 822, 1200 735 L1200 ${SCENE_H + 2} L0 ${SCENE_H + 2} Z" fill="${C.black}"/>`);
  out.push(house(760, 812, night));

  // Place and time, quietly in the corner.
  const place = (s?.location?.split(',')[0] || s?.name || '').toUpperCase();
  out.push(`<text x="${PAD - 16}" y="70" font-family="Geist" font-size="22" font-weight="600" letter-spacing="5" fill="${ink}">${esc(place)}</text>`);
  out.push(`<text x="${W - PAD + 16}" y="70" font-family="Geist" font-size="22" font-weight="600" letter-spacing="3" text-anchor="end" fill="${ink}">${clock(now, d.tz)}</text>`);
  return { svg: out.join(''), night };
}

function localHour(d) {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: d.tz }).format(new Date(d.now * 1000)));
}

// ---------------------------------------------------------------- Numbers

function kpi(y, { label, value, unit, context }) {
  const cx = W / 2;
  return [
    `<text x="${cx + 3}" y="${y}" font-family="Geist" font-size="28" font-weight="700" letter-spacing="7" text-anchor="middle" fill="${C.yellow}">${esc(label)}</text>`,
    `<text x="${cx}" y="${y + 196}" font-family="Geist" font-size="210" font-weight="700" letter-spacing="-8" text-anchor="middle" fill="${C.white}">${esc(value)}<tspan font-size="70" font-weight="600" letter-spacing="0" dx="22" fill="${C.yellow}">${esc(unit)}</tspan></text>`,
    `<text x="${cx}" y="${y + 252}" font-family="Geist" font-size="32" font-weight="500" text-anchor="middle" fill="${C.white}">${esc(context)}</text>`,
  ].join('');
}

export function topKpi(d, night) {
  const { v } = d;
  if (!night || (v.production ?? 0) > 30) {
    const P = v.production ?? 0;
    const Cn = v.consumption ?? 0;
    const [value, unit] = powerParts(P);
    const context = P <= 30 ? 'Waiting for the sun' : Cn > 0 && P >= Cn ? 'Powering the whole home' : `Covering ${Math.round((P / Math.max(Cn, 1)) * 100)}% of the home`;
    return { label: 'SOLAR NOW', value, unit, context };
  }
  if (v.soc != null) {
    const context =
      (v.discharge ?? 0) > 30 ? `Running the home · ${power(v.discharge)}` : (v.charge ?? 0) > 30 ? `Charging · ${power(v.charge)}` : 'Resting';
    return { label: 'BATTERY', value: String(Math.round(v.soc)), unit: '%', context };
  }
  const [value, unit] = powerParts(v.consumption);
  return { label: 'HOME NOW', value, unit, context: 'From the grid' };
}

export function bottomKpi(d) {
  const [value, unit] = energyParts(d.t.production ?? 0);
  return { label: 'SOLAR TODAY', value, unit, context: `${money(d.k.savings)} of free energy` };
}

/** `scene` forces 'day' or 'night' for previewing; otherwise it follows the real sun. */
export function buildArtSvg({ scene: force } = {}) {
  const d = collect();
  if (force && d.sun.sunrise && d.sun.sunset) {
    d.now = force === 'night' ? Math.round(d.sun.sunset + 3 * 3600) : Math.round(d.sun.sunrise + (d.sun.sunset - d.sun.sunrise) * 0.38);
  }
  const { svg, night } = scenery(d);
  const out = [svg];
  out.push(`<rect y="${SCENE_H}" width="${W}" height="${H - SCENE_H}" fill="${C.black}"/>`);
  out.push(kpi(SCENE_H + 82, topKpi(d, night)));
  // Short dotted rule between the two numbers.
  for (let x = W / 2 - 117; x < W / 2 + 117; x += 18) out.push(`<rect x="${x}" y="${SCENE_H + 380}" width="8" height="4" fill="${C.yellow}"/>`);
  out.push(kpi(SCENE_H + 446, bottomKpi(d)));
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`;
}

// ---------------------------------------------------------------- Routes

export const einkArt = Router();

einkArt.get('/eink-poster.png', (req, res) => {
  try {
    const png = svgToPng(buildArtSvg({ scene: req.query.scene }), { preview: req.query.preview === '1' || req.query.preview === 'true' });
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store' }).send(png);
  } catch (err) {
    console.error('[eink-art]', err);
    res.status(500).json({ error: err.message });
  }
});

einkArt.get('/eink-poster.svg', (req, res) => {
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).send(buildArtSvg({ scene: req.query.scene }));
});
