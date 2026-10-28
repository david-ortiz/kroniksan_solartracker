import { useEffect, useMemo, useState } from 'react';
import { Moon, Sunrise, Sunset } from 'lucide-react';
import type { DayData, Live, Status } from '../lib/api';
import { energy, money, pct, power, splitPower, timeIn } from '../lib/format';
import { skyFor, sunAltitude, sunTimes } from '../lib/sun';
import { useAnimatedNumber } from './ui';

const STARS = Array.from({ length: 46 }, (_, i) => {
  const r = (n: number) => {
    const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  return { x: r(1) * 100, y: r(2) * 62, s: r(3) < 0.15 ? 2.2 : 1.2 + r(4), d: 2.5 + r(5) * 4, o: 0.35 + r(6) * 0.65 };
});

const PHASE_LABEL = { night: 'Night', twilight: 'Twilight', golden: 'Golden hour', day: 'Daylight' } as const;

function useNow(ms = 60_000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function story(live: Live | undefined, sunriseLabel: string | null) {
  const v = live?.values ?? {};
  const P = v.production ?? 0;
  const C = v.consumption ?? 0;
  const soc = v.soc != null ? `${Math.round(v.soc)}%` : null;
  if (!live?.ts) return 'Waiting for the first readings from SolarEdge.';
  if (P > 30) {
    const share = C > 0 ? Math.min(1, P / C) : 1;
    let s = share >= 0.995 ? 'Your panels are powering the whole home' : `Your panels are covering ${pct(share)} of your home`;
    if ((v.export ?? 0) > 30) s += `, with ${power(v.export)} spare going to the grid`;
    else if ((v.charge ?? 0) > 30) s += ` and topping up the battery`;
    return `${s}.`;
  }
  if ((v.discharge ?? 0) > 30) return `The battery is running the home${soc ? ` · ${soc} left` : ''}.`;
  if ((v.charge ?? 0) > 30 && (v.import ?? 0) > 30) return `Charging the battery from the grid${soc ? ` · ${soc} full` : ''}.`;
  if ((v.import ?? 0) > 30) return `Your home is on the grid right now${sunriseLabel ? ` · sun's up at ${sunriseLabel}` : ''}.`;
  return 'All quiet.';
}

/** The sky tile: real sun position for the site, today's solar curve under the sun's arc. */
export function Hero({ live, day, status }: { live: Live | undefined; day: DayData | undefined; status: Status | undefined }) {
  const now = useNow();
  const site = status?.site;
  const tz = site?.timezone;
  const lat = site?.latitude ?? null;
  const lon = site?.longitude ?? null;

  const altitude = lat != null && lon != null ? sunAltitude(now, lat, lon) : 25 * Math.sin(((new Date(now).getHours() - 6) / 12) * Math.PI);
  const sky = skyFor(altitude);
  const times = useMemo(() => (day && lat != null && lon != null ? sunTimes(day.from, day.to, lat, lon) : null), [day?.from, day?.to, lat, lon]); // eslint-disable-line react-hooks/exhaustive-deps

  const nowS = now / 1000;
  const rise = times?.sunrise ?? null;
  const set = times?.sunset ?? null;
  const t = rise && set ? Math.min(1, Math.max(0, (nowS - rise) / (set - rise))) : null;
  const sunUp = rise != null && set != null && nowS >= rise && nowS <= set;

  const P = live?.values.production;
  const shown = useAnimatedNumber(P ?? 0, 1200);
  const [num, unit] = splitPower(P == null ? null : shown);
  const k = live?.today.kpis;
  const cur = status?.settings.currency ?? 'EUR';

  // Arc geometry (viewBox 1000 × 200, horizon at y = 180).
  const X0 = 40;
  const X1 = 960;
  const H = 180;
  const arc = (u: number) => [X0 + (X1 - X0) * u, H - 150 * Math.sin(Math.PI * u)] as const;
  const arcTo = (end: number) => {
    const n = Math.max(2, Math.ceil(end * 60) + 1);
    return Array.from({ length: n }, (_, i) => arc((end * i) / (n - 1)))
      .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
      .join(' ');
  };
  const arcPath = arcTo(1);

  // Today's production, drawn between sunrise and sunset under the arc.
  const peakW = Math.max((site?.peakPowerKw ?? 0) * 1000, ...(day?.points ?? []).map((p) => p.production ?? 0), 1);
  const curve =
    rise && set && day?.points.length
      ? day.points
          .filter((p) => p.production != null && p.ts >= rise - 1800 && p.ts <= set + 1800)
          .map((p) => [X0 + (X1 - X0) * Math.min(1, Math.max(0, (p.ts - rise) / (set - rise))), H - ((p.production ?? 0) / peakW) * 120] as const)
      : [];
  const curvePath = curve.length > 1 ? `M${curve[0][0]} ${H} ` + curve.map(([x, y]) => `L${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ` L${curve.at(-1)![0]} ${H} Z` : '';

  const sun = t != null ? arc(t) : null;
  const dayLength = rise && set ? `${Math.floor((set - rise) / 3600)}h ${Math.round(((set - rise) % 3600) / 60)}m` : null;
  const sunriseLabel = rise ? timeIn(rise, tz) : null;

  return (
    <section
      className="card live-rim reveal relative flex min-h-[460px] flex-col overflow-hidden text-white"
      style={{ background: `linear-gradient(180deg, ${sky.top} 0%, ${sky.bottom} 100%)`, borderColor: 'rgb(255 255 255 / 0.1)', transition: 'background 2s' }}
      aria-label="Solar right now"
    >
      {/* Stars */}
      <div className="pointer-events-none absolute inset-0 transition-opacity duration-1000" style={{ opacity: sky.stars }} aria-hidden>
        {STARS.map((s, i) => (
          <span key={i} className="star" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, opacity: s.o, ['--d' as string]: `${s.d}s` }} />
        ))}
      </div>
      {/* Atmospheric glow near the horizon */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3" style={{ background: `radial-gradient(70% 90% at ${sun ? (sun[0] / 10).toFixed(1) : 50}% 100%, color-mix(in srgb, ${sky.glow} 38%, transparent), transparent 70%)` }} aria-hidden />

      <div className="relative z-10 grid flex-1 gap-6 p-6 sm:p-8 @3xl:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] tracking-[0.16em] text-white/70 uppercase">Solar · right now</span>
            <span className="rounded-full border border-white/20 bg-white/10 px-2.5 py-0.5 text-[11.5px] text-white/90 backdrop-blur">
              {sunUp ? PHASE_LABEL[sky.phase] : rise && nowS < rise ? `Sunrise ${timeIn(rise, tz)}` : 'Night'}
            </span>
          </div>
          <div className="mt-4 flex items-baseline gap-2" aria-live="polite">
            <span className="display text-[clamp(64px,14cqi,140px)] drop-shadow-[0_4px_24px_rgb(0_0_0/0.25)]">{num}</span>
            <span className="text-[clamp(20px,3cqi,30px)] font-medium text-white/75">{unit}</span>
          </div>
          <p className="mt-3 max-w-[34ch] text-[clamp(15px,1.9cqi,19px)] leading-snug text-white/85">{story(live, sunriseLabel)}</p>
        </div>

        <div className="grid grid-cols-3 gap-2.5 self-start @3xl:w-[260px] @3xl:grid-cols-1">
          {[
            ['Produced today', energy(live?.today.totals.production), site?.peakPowerKw && live?.today.totals.production != null ? `${(live.today.totals.production / 1000 / site.peakPowerKw).toFixed(2)} kWh/kWp` : null],
            ['Saved today', money(k?.savings, cur), 'solar used + sold'],
            ['Self-powered', pct(k?.selfSufficiency), 'of home energy today'],
          ].map(([label, value, foot]) => (
            <div key={label} className="rounded-2xl border border-white/15 bg-white/[0.08] px-3.5 py-3 backdrop-blur-md">
              <div className="text-[11.5px] text-white/65">{label}</div>
              <div className="mt-0.5 text-[clamp(16px,2.6cqi,22px)] font-semibold tracking-[-0.02em] num">{value}</div>
              {foot && <div className="truncate text-[11px] text-white/55">{foot}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* Sun arc */}
      <div className="relative z-10 mt-auto h-[clamp(170px,30cqi,260px)] px-2">
        <svg viewBox="0 0 1000 200" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <linearGradient id="hero-curve" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
              <stop offset="1" stopColor="#fff" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {curvePath && <path d={curvePath} fill="url(#hero-curve)" />}
          <path d={arcPath} fill="none" stroke="rgb(255 255 255 / 0.28)" strokeWidth="1.5" strokeDasharray="2 6" vectorEffect="non-scaling-stroke" />
          {t != null && t > 0 && <path d={arcTo(t)} fill="none" stroke="rgb(255 255 255 / 0.85)" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinecap="round" />}
          <line x1="0" x2="1000" y1={H} y2={H} stroke="rgb(255 255 255 / 0.25)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        </svg>
        {sun && sunUp && (
          <div className="pointer-events-none absolute" style={{ left: `${sun[0] / 10}%`, top: `${(sun[1] / 200) * 100}%`, transform: 'translate(-50%,-50%)' }} aria-hidden>
            <span className="absolute top-1/2 left-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: 'radial-gradient(circle, rgb(255 236 170 / 0.55), transparent 65%)' }} />
            <span className="relative block h-5 w-5 rounded-full shadow-[0_0_24px_6px_rgb(255_214_120/0.8)]" style={{ background: 'radial-gradient(circle at 35% 35%, #fffbe6, #ffd36b 60%, #ffb02e)' }} />
          </div>
        )}
        {!sunUp && (
          <Moon size={22} className="absolute top-3 right-8 text-white/70 drop-shadow-[0_0_12px_rgb(255_255_255/0.5)]" aria-hidden />
        )}
        <div className="absolute inset-x-6 bottom-3 flex items-center justify-between text-[11.5px] text-white/70 num">
          <span className="inline-flex items-center gap-1.5">
            <Sunrise size={14} /> {rise ? timeIn(rise, tz) : '—'}
          </span>
          <span className="hidden sm:inline">
            {times ? `Solar noon ${timeIn(times.noon, tz)} · ${dayLength} of daylight · sun ${Math.round(times.maxAltitude)}° high` : ''}
          </span>
          <span className="inline-flex items-center gap-1.5">
            {set ? timeIn(set, tz) : '—'} <Sunset size={14} />
          </span>
        </div>
      </div>
    </section>
  );
}
