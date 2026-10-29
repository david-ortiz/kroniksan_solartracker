// "Gallery" e-ink design: a public-domain masterpiece chosen to match the sky
// outside, mounted on a white mat with a museum-style label carrying two numbers.
// Portrait 1200 × 1600.
//
// GET /api/eink-art.png             full-colour PNG; the display (InkyPi / inky) dithers it
// GET /api/eink-art.png?preview=1   dithered in colours close to how the panel looks
// GET /api/eink-art.png?dither=1    pre-dithered to the six pure inks
// GET /api/eink-art.png?mood=night  force a mood: clear, cloudy, dawn, dusk, night
// GET /api/eink-art.png?art=436535  force an artwork by Met object ID
// GET /api/eink-art.svg             the vector source

import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { ROOT } from './config.js';
import { C, clock, collect, esc, svgToColorPng } from './eink.js';
import { bottomKpi, topKpi } from './eink-art.js';
import { sunAltitude } from './sun.js';

const W = 1200;
const H = 1600;
const M = 80;
const ART_DIR = path.join(ROOT, 'server', 'art');
const ARTWORKS = JSON.parse(fs.readFileSync(path.join(ART_DIR, 'manifest.json'), 'utf8'));
const TRIM = 0.018; // museum photos often include a sliver of frame at the edges
const MOODS = ['clear', 'cloudy', 'dawn', 'dusk', 'night'];

const images = new Map();
function imageData(file) {
  if (!images.has(file)) images.set(file, `data:image/jpeg;base64,${fs.readFileSync(path.join(ART_DIR, file)).toString('base64')}`);
  return images.get(file);
}

/** What the sky is doing: night, dawn, dusk, or daytime clear vs cloudy (from output vs a clear-sky guess). */
function moodNow(d) {
  const lat = d.s?.latitude ?? d.s?.raw?.location?.latitude;
  const lon = d.s?.longitude ?? d.s?.raw?.location?.longitude;
  if (lat == null || lon == null) {
    const h = Number(new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: d.tz }).format(new Date(d.now * 1000)));
    return h < 6 || h >= 20 ? 'night' : h < 9 ? 'dawn' : h >= 17 ? 'dusk' : 'clear';
  }
  const alt = sunAltitude(d.now * 1000, lat, lon);
  const rising = sunAltitude((d.now + 1800) * 1000, lat, lon) > alt;
  if (alt < -5) return 'night';
  if (alt < 9) return rising ? 'dawn' : 'dusk';
  const expected = d.peakW * Math.sin((alt * Math.PI) / 180) * 0.75;
  if (d.peakW > 0 && expected > 300 && (d.v.production ?? 0) / expected < 0.45) return 'cloudy';
  return 'clear';
}

/** Same artwork all day for a given mood; a different one tomorrow. */
function pickArtwork(mood, now, artId) {
  if (artId) {
    const forced = ARTWORKS.find((a) => String(a.objectID) === String(artId));
    if (forced) return forced;
  }
  const list = ARTWORKS.filter((a) => a.mood === mood);
  const pool = list.length ? list : ARTWORKS;
  return pool[Math.floor(now / 86400) % pool.length];
}

function kpiRow(top, { label, value, unit, context }) {
  return [
    `<text x="${M}" y="${top + 34}" font-family="Geist" font-size="22" font-weight="600" letter-spacing="5" fill="${C.black}">${esc(label)}</text>`,
    `<text x="${M}" y="${top + 76}" font-family="Geist" font-size="27" font-weight="400" fill="${C.black}">${esc(context)}</text>`,
    `<text x="${W - M}" y="${top + 118}" font-family="Instrument Serif" font-size="164" text-anchor="end" fill="${C.black}">${esc(value)}<tspan font-style="italic" font-size="62" dx="14">${esc(unit)}</tspan></text>`,
  ].join('');
}

export function buildGallerySvg({ mood: forcedMood, art: artId } = {}) {
  const d = collect();
  const mood = MOODS.includes(forcedMood) ? forcedMood : moodNow(d);
  const art = pickArtwork(mood, d.now, artId);

  // Fit the whole artwork (never crop the art itself) inside the mat window.
  const trim = art.trim ?? TRIM;
  const srcX = art.width * trim;
  const srcY = art.height * trim;
  const srcW = art.width - 2 * srcX;
  const srcH = art.height - 2 * srcY;
  const aspect = srcW / srcH;
  const maxW = W - 2 * M;
  const maxH = 960;
  const boxW = Math.min(maxW, maxH * aspect);
  const boxH = boxW / aspect;

  // Centre artwork + label as one group on the mat.
  const LABEL_H = 400;
  const GAP = 76;
  const top = Math.max(76, (H - (boxH + GAP + LABEL_H)) / 2 - 12);
  const x = (W - boxW) / 2;
  const y = top;
  const labelTop = y + boxH + GAP;

  const night = mood === 'night';
  const out = [];
  out.push(`<rect width="${W}" height="${H}" fill="${C.white}"/>`);
  // Mat window keyline, then the artwork.
  out.push(`<rect x="${x - 18}" y="${y - 18}" width="${boxW + 36}" height="${boxH + 36}" fill="none" stroke="${C.black}" stroke-width="2"/>`);
  out.push(
    `<svg x="${x}" y="${y}" width="${boxW}" height="${boxH}" viewBox="${srcX} ${srcY} ${srcW} ${srcH}" preserveAspectRatio="none"><image width="${art.width}" height="${art.height}" href="${imageData(art.file)}"/></svg>`,
  );

  // Museum label: two numbers, then the caption.
  out.push(kpiRow(labelTop, topKpi(d, night)));
  out.push(`<rect x="${M}" y="${labelTop + 158}" width="${W - 2 * M}" height="2" fill="${C.black}"/>`);
  out.push(kpiRow(labelTop + 178, bottomKpi(d)));
  out.push(`<rect x="${M}" y="${labelTop + 336}" width="${W - 2 * M}" height="2" fill="${C.black}"/>`);
  const place = d.s?.location?.split(',')[0] || '';
  // Title and artist as separate <text> runs (mixed-font tspans can drop out in resvg).
  const titleWidth = art.title.length * 31 * 0.43;
  out.push(`<text x="${M}" y="${labelTop + 384}" font-family="Instrument Serif" font-style="italic" font-size="31" fill="${C.black}">${esc(art.title)}</text>`);
  out.push(`<text x="${M + titleWidth + 14}" y="${labelTop + 384}" font-family="Geist" font-size="20" fill="${C.black}">${esc(`${art.artist}, ${art.date.replace(/^ca\. /, 'c. ')}`)}</text>`);
  out.push(`<text x="${W - M}" y="${labelTop + 384}" font-family="Geist" font-size="20" text-anchor="end" fill="${C.black}">${esc([place, clock(d.now, d.tz)].filter(Boolean).join(' · '))}</text>`);

  return { svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${out.join('')}</svg>`, mood, art };
}

// ---------------------------------------------------------------- Routes

export const einkGallery = Router();

const flag = (v) => v === '1' || v === 'true';

einkGallery.get('/eink-art.png', (req, res) => {
  try {
    const { svg, mood, art } = buildGallerySvg({ mood: req.query.mood, art: req.query.art });
    const mode = flag(req.query.preview) ? 'preview' : flag(req.query.dither) ? 'dither' : 'color';
    res
      .set({ 'Content-Type': 'image/png', 'Cache-Control': 'no-store', 'X-Mood': mood, 'X-Artwork': `${art.objectID}` })
      .send(svgToColorPng(svg, { mode }));
  } catch (err) {
    console.error('[eink-gallery]', err);
    res.status(500).json({ error: err.message });
  }
});

einkGallery.get('/eink-art.svg', (req, res) => {
  res.set({ 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' }).send(buildGallerySvg({ mood: req.query.mood, art: req.query.art }).svg);
});
