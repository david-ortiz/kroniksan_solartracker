import { Sun, House, UtilityPole, BatteryMedium, Zap } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Live } from '../lib/api';
import { power, splitPower } from '../lib/format';

// Hub-and-spoke layout: every flow passes through the inverter in the middle.
const HUB = { x: 220, y: 236 };
const R = 40;
const NODES = {
  solar: { x: 220, y: 88 },
  grid: { x: 72, y: 236 },
  home: { x: 368, y: 236 },
  battery: { x: 220, y: 384 },
};
// Each spoke runs node → hub; "in" flows travel that way, "out" flows reverse.
const SPOKES = {
  solar: 'M220 128 L220 208',
  grid: 'M112 236 L192 236',
  home: 'M328 236 L248 236',
  battery: 'M220 344 L220 264',
};

type Key = keyof typeof NODES;

function particles(w: number) {
  const n = Math.min(4, Math.max(1, Math.ceil(Math.log10(Math.max(w, 10)) - 0.6)));
  const dur = Math.min(3, Math.max(0.85, 3.4 - Math.log10(Math.max(w, 10)) * 0.62));
  return { n, dur: +dur.toFixed(2) };
}

function Spoke({ id, color, watts, inbound }: { id: Key; color: string; watts: number; inbound: boolean }) {
  const active = watts > 15;
  const { n, dur } = particles(watts);
  const d = SPOKES[id];
  return (
    <g>
      <path d={d} stroke="var(--border-strong)" strokeWidth={2} strokeLinecap="round" />
      {active && (
        <>
          <path d={d} stroke={color} strokeOpacity={0.45} strokeWidth={Math.min(2 + Math.log10(watts) * 0.8, 5)} strokeLinecap="round" />
          <g key={`${dur}-${n}-${inbound}`}>
            {Array.from({ length: n }, (_, i) => (
              <g key={i}>
                <circle r={9} fill={`url(#glow-${id})`} />
                <circle r={3.2} fill={color} />
                <animateMotion
                  dur={`${dur}s`}
                  repeatCount="indefinite"
                  path={d}
                  begin={`-${((dur / n) * i).toFixed(2)}s`}
                  keyPoints={inbound ? '0;1' : '1;0'}
                  keyTimes="0;1"
                  calcMode="linear"
                />
              </g>
            ))}
          </g>
        </>
      )}
    </g>
  );
}

function Node({
  id,
  color,
  icon,
  watts,
  label,
  caption,
  ring,
  labelAbove,
}: {
  id: Key;
  color: string;
  icon: ReactNode;
  watts: number | undefined;
  label: string;
  caption: string;
  ring?: number;
  labelAbove?: boolean;
}) {
  const { x, y } = NODES[id];
  const w = Math.abs(watts ?? 0);
  const active = w > 15;
  const halo = active ? Math.min(0.9, Math.max(0.35, Math.log10(w) / 4)) : 0;
  const [num, unit] = splitPower(w);
  const ty = labelAbove ? y - R - 38 : y + R + 26;
  const circ = 2 * Math.PI * (R + 7);
  return (
    <g>
      {active && <circle cx={x} cy={y} r={R + 26} fill={`url(#glow-${id})`} opacity={halo} className="breathe" />}
      <circle cx={x} cy={y} r={R} fill={`url(#fill-${id})`} stroke={color} strokeOpacity={active ? 0.75 : 0.35} strokeWidth={1.5} />
      {ring != null && (
        <>
          <circle cx={x} cy={y} r={R + 7} fill="none" stroke="var(--border-strong)" strokeWidth={3} />
          <circle
            cx={x}
            cy={y}
            r={R + 7}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${(circ * Math.min(Math.max(ring, 0), 100)) / 100} ${circ}`}
            transform={`rotate(-90 ${x} ${y})`}
            style={{ transition: 'stroke-dasharray 1s' }}
          />
        </>
      )}
      <g style={{ color }}>
        <svg x={x - 12} y={y - 12} width={24} height={24} overflow="visible">
          {icon}
        </svg>
      </g>
      <text x={x} y={ty} textAnchor="middle" className="num" fill="var(--text)" fontSize={19} fontWeight={620} letterSpacing="-0.02em">
        {num}
        <tspan fill="var(--muted)" fontSize={12} fontWeight={500} dx={3}>
          {unit}
        </tspan>
      </text>
      <text x={x} y={ty + 17} textAnchor="middle" fill="var(--muted)" fontSize={11.5}>
        {label} · {caption}
      </text>
    </g>
  );
}

const COLORS: Record<string, string> = {
  solar: 'var(--solar)',
  home: 'var(--home)',
  grid: 'var(--import)',
  battery: 'var(--battery)',
};

export function PowerFlow({ live, hasBattery }: { live: Live | undefined; hasBattery: boolean }) {
  const v = live?.values ?? {};
  const f = live?.flows;
  const P = v.production ?? 0;
  const C = v.consumption ?? 0;
  const grid = (v.import ?? 0) - (v.export ?? 0);
  const batt = (v.discharge ?? 0) - (v.charge ?? 0);
  const gridColor = Math.abs(grid) < 15 ? 'var(--muted)' : grid > 0 ? 'var(--import)' : 'var(--export)';
  const state = (w: number, inWord: string, outWord: string) => (Math.abs(w) < 15 ? 'idle' : w > 0 ? inWord : outWord);

  const chips = f
    ? ([
        ['solar', 'home', 'Solar → Home', f.solarToHome],
        ['solar', 'battery', 'Solar → Battery', f.solarToBattery],
        ['solar', 'export', 'Solar → Grid', f.solarToGrid],
        ['battery', 'home', 'Battery → Home', f.batteryToHome],
        ['grid', 'home', 'Grid → Home', f.gridToHome],
        ['grid', 'battery', 'Grid → Battery', f.gridToBattery],
      ] as const).filter(([, , , w]) => (w ?? 0) > 15)
    : [];

  return (
    <div>
      <svg viewBox="0 -16 440 494" className="mx-auto block w-full max-w-[460px]" role="img" aria-label="Live power flow between solar, home, grid and battery">
        <defs>
          {(['solar', 'home', 'grid', 'battery'] as Key[]).map((k) => {
            const c = k === 'grid' ? gridColor : COLORS[k];
            return (
              <g key={k}>
                <radialGradient id={`glow-${k}`}>
                  <stop offset="0" style={{ stopColor: c, stopOpacity: 0.7 }} />
                  <stop offset="1" style={{ stopColor: c, stopOpacity: 0 }} />
                </radialGradient>
                <radialGradient id={`fill-${k}`} cx="0.5" cy="0.15" r="0.95">
                  <stop offset="0" style={{ stopColor: c, stopOpacity: 0.32 }} />
                  <stop offset="0.75" style={{ stopColor: 'var(--surface-2)', stopOpacity: 1 }} />
                </radialGradient>
              </g>
            );
          })}
        </defs>

        <circle cx={HUB.x} cy={HUB.y} r={148} fill="none" stroke="var(--border)" strokeDasharray="1 7" strokeLinecap="round" />

        <Spoke id="solar" color="var(--solar)" watts={P} inbound />
        <Spoke id="home" color="var(--home)" watts={C} inbound={false} />
        <Spoke id="grid" color={gridColor} watts={Math.abs(grid)} inbound={grid > 0} />
        {hasBattery && <Spoke id="battery" color="var(--battery)" watts={Math.abs(batt)} inbound={batt > 0} />}

        <circle cx={HUB.x} cy={HUB.y} r={26} fill="var(--surface-3)" stroke="var(--border-strong)" />
        <g style={{ color: 'var(--muted)' }}>
          <svg x={HUB.x - 9} y={HUB.y - 9} width={18} height={18} overflow="visible">
            <Zap size={18} />
          </svg>
        </g>

        <Node id="solar" color="var(--solar)" icon={<Sun size={24} />} watts={P} label="Solar" caption={P > 15 ? 'producing' : 'resting'} labelAbove />
        <Node id="grid" color={gridColor} icon={<UtilityPole size={24} />} watts={grid} label="Grid" caption={state(grid, 'importing', 'exporting')} />
        <Node id="home" color="var(--home)" icon={<House size={24} />} watts={C} label="Home" caption="using" />
        {hasBattery && (
          <Node
            id="battery"
            color="var(--battery)"
            icon={<BatteryMedium size={24} />}
            watts={batt}
            label={v.soc != null ? `Battery ${Math.round(v.soc)}%` : 'Battery'}
            caption={state(batt, 'discharging', 'charging')}
            ring={v.soc}
          />
        )}
      </svg>

      {chips.length > 0 && (
        <ul className="mt-2 flex flex-wrap justify-center gap-2" aria-label="Active power flows">
          {chips.map(([from, to, label, w]) => (
            <li key={label} className="chip py-1">
              <span className="flex -space-x-1">
                <span className="h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: COLORS[from] }} />
                <span className="h-2.5 w-2.5 rounded-full ring-2 ring-surface" style={{ background: to === 'export' ? 'var(--export)' : COLORS[to] }} />
              </span>
              <span className="text-ink-2">{label}</span>
              <b className="font-semibold text-ink num">{power(w)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
