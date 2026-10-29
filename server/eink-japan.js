// "Japan" e-ink design: a random shin-hanga print (early-modern Japanese, 1900s-1930s), full-bleed,
// with a compact band carrying two numbers. Portrait 1200 × 1600.
//
// GET /api/eink-japan.png             random print every request (full colour; the display dithers)
// GET /api/eink-japan.png?preview=1   dithered in colours close to how the panel looks
// GET /api/eink-japan.png?dither=1    pre-dithered to the six pure inks
// GET /api/eink-japan.png?art=<id>    a specific print (Wikimedia Commons page ID)

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { ROOT } from './config.js';
import { C, clock, collect, esc, svgToColorPng } from './eink.js';
import { bottomKpi, topKpi } from './eink-art.js';
import { sunAltitude } from './sun.js';

const W = 1200;
const H = 1600;
const M = 56;
const ART_DIR = path.join(ROOT, 'server', 'art-shinhanga');
const RECENT = 6;

let pool = [];
function prints() {
  // Re-read when the folder changes so new prints can be dropped in without a restart.
  const file = path.join(ART_DIR, 'manifest.json');
  const mtime = fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0;
  if (pool.mtime !== mtime) {
    pool = mtime ? JSON.parse(fs.readFileSync(file, 'utf8')).filter((a) => fs.existsSync(path.join(ART_DIR, a.file))) : [];
    pool.mtime = mtime;
  }
  return pool;
}

const recent = [];
function pick(artId) {
  const list = prints();
  if (!list.length) throw new Error('No prints in server/art-shinhanga yet');
  const forced = artId && list.find((a) => String(a.id) === String(artId));
  if (forced) return forced;
  const fresh = list.filter((a) => !recent.includes(a.id));
  const choice = (fresh.length ? fresh : list)[Math.floor(Math.random() * (fresh.length || list.length))];
  recent.push(choice.id);
  if (recent.length > Math.min(RECENT, list.length - 1)) recent.shift();
  return choice;
}

const images = new Map();
function imageData(file) {
  if (!images.has(file)) images.set(file, `data:image/jpeg;base64,${fs.readFileSync(path.join(ART_DIR, file)).toString('base64')}`);
  return images.get(file);
}

function isNight(d) {
  const lat = d.s?.latitude ?? d.s?.raw?.location?.latitude;
  const lon = d.s?.longitude ?? d.s?.raw?.location?.longitude;
  if (lat == null || lon == null) return d.sun.sunrise && d.sun.sunset ? d.now < d.sun.sunrise || d.now > d.sun.sunset : false;
  return sunAltitude(d.now * 1000, lat, lon) < -2;
}

export function buildJapanSvg({ art: artId } = {}) {
  const d = collect();
  const art = pick(artId);

  // The print fills the full width; its window height leans towards the print's shape.
  const aspect = art.width / art.height;
  const artH = Math.round(Math.min(1250, Math.max(1100, W / aspect)));
  const winAspect = W / artH;
  // Cover-crop the print to the window, centred.
  // Optional per-print trim removes colour bars / mount edges from museum photos.
  const tw = art.width * (1 - 2 * (art.trim ?? 0.02));
  const th = art.height * (1 - 2 * (art.trim ?? 0.02));
  let sw = tw;
  let sh = th;
  if (tw / th > winAspect) sw = th * winAspect;
  else sh = tw / winAspect;
  const sx = (art.width - sw) / 2;
  const sy = (art.height - sh) / 2;

  const band = H - artH;
  const rowH = (band - 70) / 2;
  const numSize = Math.round(Math.min(150, rowH * 0.95));
  const top = topKpi(d, isNight(d));
  const bottom = bottomKpi(d);

  const row = (y, k) =>
    [
      `<text x="${M}" y="${y + rowH * 0.42}" font-family="Geist" font-size="22" font-weight="600" letter-spacing="5" fill="${C.black}">${esc(k.label)}</text>`,
      `<text x="${M}" y="${y + rowH * 0.42 + 38}" font-family="Geist" font-size="26" fill="${C.black}">${esc(k.context)}</text>`,
      `<text x="${W - M}" y="${y + rowH * 0.5 + numSize * 0.36}" font-family="Instrument Serif" font-size="${numSize}" text-anchor="end" fill="${C.black}">${esc(k.value)}<tspan font-style="italic" font-size="${Math.round(numSize * 0.38)}" dx="12">${esc(k.unit)}</tspan></text>`,
    ].join('');

  const out = [];
  out.push(`<rect width="${W}" height="${H}" fill="${C.white}"/>`);
  out.push(`<svg x="0" y="0" width="${W}" height="${artH}" viewBox="${sx} ${sy} ${sw} ${sh}" preserveAspectRatio="none"><image width="${art.width}" height="${art.height}" href="${imageData(art.file)}"/></svg>`);
  const y0 = artH + 10;
  out.push(row(y0, top));
  out.push(`<rect x="${M}" y="${y0 + rowH}" width="${W - 2 * M}" height="2" fill="${C.black}"/>`);
  out.push(row(y0 + rowH + 4, bottom));
  // Caption: title and artist as separate runs (mixed-font tspans can drop out in resvg).
  const capY = H - 26;
  const clean = art.title.split(/[",]\s*illustration/i)[0].replace(/["“”]/g, '').trim();
  const title = clean.length > 48 ? `${clean.slice(0, 46)}…` : clean;
  out.push(`<text x="${M}" y="${capY}" font-family="Instrument Serif" font-style="italic" font-size="26" fill="${C.black}">${esc(title)}</text>`);
  out.push(`<text x="${M + title.length * 26 * 0.43 + 12}" y="${capY}" font-family="Geist" font-size="18" fill="${C.black}">${esc(`${art.artist}, ${art.date}`)}</text>`);
  out.push(`<text x="${W - M}" y="${capY}" font-family="Geist" font-size="18" text-anchor="end" fill="${C.black}">${esc(clock(d.now, d.tz))}</text>`);

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`, art };
}

// ---------------------------------------------------------------- Routes

export const einkJapan = Router();

const flag = (v) => v === '1' || v === 'true';

einkJapan.get('/eink-japan.png', (req, res) => {
  try {
    const { svg, art } = buildJapanSvg({ art: req.query.art });
    const mode = flag(req.query.preview) ? 'preview' : flag(req.query.dither) ? 'dither' : 'color';
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Artwork': String(art.id) }).send(svgToColorPng(svg, { mode }));
  } catch (err) {
    console.error('[eink-japan]', err);
    res.status(500).json({ error: err.message });
  }
});
