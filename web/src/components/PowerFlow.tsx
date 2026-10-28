import { Sun, House, UtilityPole, BatteryMedium } from 'lucide-react';
import type { Live } from '../lib/api';
import { splitPower } from '../lib/format';

const NODES = {
  solar: { x: 200, y: 90 },
  grid: { x: 62, y: 222 },
  home: { x: 338, y: 222 },
  battery: { x: 200, y: 338 },
};
const R = 34;

type FlowKey = keyof Live['flows'];

const PATHS: { key: FlowKey; d: string; color: string }[] = [
  { key: 'solarToHome', d: 'M 226 112 C 290 140, 320 160, 330 189', color: 'var(--solar)' },
  { key: 'solarToGrid', d: 'M 174 112 C 110 140, 80 160, 70 189', color: 'var(--solar)' },
  { key: 'solarToBattery', d: 'M 200 125 L 200 303', color: 'var(--solar)' },
  { key: 'gridToHome', d: 'M 97 222 L 303 222', color: 'var(--import)' },
  { key: 'batteryToHome', d: 'M 226 316 C 290 296, 320 276, 330 255', color: 'var(--battery)' },
];

function speed(w: number) {
  // Faster dashes for more power; 0.5 s (≥5 kW) … 2.6 s (tiny trickle).
  return `${Math.max(0.5, 2.6 - Math.log10(Math.max(w, 10)) * 0.55).toFixed(2)}s`;
}

function Node({
  x,
  y,
  color,
  icon,
  label,
  value,
  sub,
  ring,
  labelBelow = true,
}: {
  x: number;
  y: number;
  color: string;
  icon: React.ReactNode;
  label: string;
  value: number | undefined;
  sub?: string;
  ring?: number;
  labelBelow?: boolean;
}) {
  const [num, unit] = splitPower(value ?? 0);
  const circumference = 2 * Math.PI * (R + 5);
  const ty = labelBelow ? y + R + 22 : y - R - 30;
  return (
    <g>
      <circle cx={x} cy={y} r={R + 10} fill={color} opacity={0.08} />
      <circle cx={x} cy={y} r={R} fill="var(--surface)" stroke={color} strokeWidth={2} />
      {ring != null && (
        <>
          <circle cx={x} cy={y} r={R + 5} fill="none" stroke="var(--border-strong)" strokeWidth={3} />
          <circle
            cx={x}
            cy={y}
            r={R + 5}
            fill="none"
            stroke={color}
            strokeWidth={3}
            strokeLinecap="round"
            strokeDasharray={`${(circumference * Math.min(Math.max(ring, 0), 100)) / 100} ${circumference}`}
            transform={`rotate(-90 ${x} ${y})`}
          />
        </>
      )}
      <g style={{ color }}>
        <svg x={x - 13} y={y - 13} width={26} height={26} overflow="visible">
          {icon}
        </svg>
      </g>
      <text x={x} y={ty} textAnchor="middle" className="num" fill="var(--text)" fontSize={17} fontWeight={650}>
        {num}
        <tspan fill="var(--muted)" fontSize={12} fontWeight={500} dx={3}>
          {unit}
        </tspan>
      </text>
      <text x={x} y={ty + 16} textAnchor="middle" fill="var(--muted)" fontSize={11.5}>
        {label}
        {sub ? ` · ${sub}` : ''}
      </text>
    </g>
  );
}

export function PowerFlow({ live, hasBattery }: { live: Live | undefined; hasBattery: boolean }) {
  const v = live?.values ?? {};
  const f = live?.flows;
  const gridW = (v.import ?? 0) - (v.export ?? 0);
  const batteryW = (v.discharge ?? 0) - (v.charge ?? 0);
  const paths = PATHS.filter((p) => hasBattery || !p.key.includes('attery'));

  return (
    <svg viewBox="0 0 400 420" className="mx-auto block w-full max-w-[440px]" role="img" aria-label="Live power flow between solar, home, grid and battery">
      {paths.map((p) => {
        const w = f?.[p.key] ?? 0;
        const active = w > 15;
        return (
          <g key={p.key}>
            <path d={p.d} fill="none" stroke="var(--border-strong)" strokeWidth={2} />
            {active && (
              <path
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={Math.min(2.5 + Math.log10(w) * 0.9, 6)}
                className="flow-line"
                style={{ ['--speed' as string]: speed(w) }}
              />
            )}
          </g>
        );
      })}

      <Node {...NODES.solar} color="var(--solar)" icon={<Sun size={26} />} label="Solar" value={v.production} labelBelow={false} />
      <Node
        {...NODES.grid}
        color={gridW >= 0 ? 'var(--import)' : 'var(--export)'}
        icon={<UtilityPole size={26} />}
        label="Grid"
        sub={Math.abs(gridW) < 15 ? 'idle' : gridW > 0 ? 'importing' : 'exporting'}
        value={Math.abs(gridW)}
      />
      <Node {...NODES.home} color="var(--home)" icon={<House size={26} />} label="Home" value={v.consumption} />
      {hasBattery && (
        <Node
          {...NODES.battery}
          color="var(--battery)"
          icon={<BatteryMedium size={26} />}
          label={v.soc != null ? `Battery ${Math.round(v.soc)}%` : 'Battery'}
          sub={Math.abs(batteryW) < 15 ? 'idle' : batteryW > 0 ? 'discharging' : 'charging'}
          value={Math.abs(batteryW)}
          ring={v.soc}
        />
      )}
    </svg>
  );
}
