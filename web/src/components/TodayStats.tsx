import { Sun, House, ArrowDownToLine, ArrowUpFromLine, BatteryCharging, PiggyBank, Leaf, Gauge } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Live, Status } from '../lib/api';
import { mass, money, pct, splitEnergy } from '../lib/format';

function Stat({ icon, label, value, unit, color, foot }: { icon: ReactNode; label: string; value: string; unit?: string; color: string; foot?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-3.5">
      <div className="flex items-center gap-2 text-[12px] font-medium text-muted">
        <span className="grid h-6 w-6 place-items-center rounded-lg" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold tracking-tight text-ink num">{value}</span>
        {unit && <span className="text-[12.5px] text-muted">{unit}</span>}
      </div>
      {foot && <div className="mt-1 text-[11.5px] text-muted num">{foot}</div>}
    </div>
  );
}

function Ring({ value, color, label }: { value: number | null; color: string; label: string }) {
  const r = 30;
  const c = 2 * Math.PI * r;
  const v = Math.min(Math.max(value ?? 0, 0), 1);
  return (
    <div className="flex items-center gap-3">
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden>
        <circle cx="38" cy="38" r={r} fill="none" stroke="var(--border-strong)" strokeWidth="7" />
        <circle
          cx="38"
          cy="38"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform="rotate(-90 38 38)"
          style={{ transition: 'stroke-dasharray .8s ease' }}
        />
      </svg>
      <div>
        <div className="text-[22px] font-semibold tracking-tight text-ink num">{pct(value)}</div>
        <div className="text-[12px] text-muted">{label}</div>
      </div>
    </div>
  );
}

export function TodayStats({ live, status }: { live: Live | undefined; status: Status | undefined }) {
  const t = live?.today.totals ?? {};
  const k = live?.today.kpis;
  const cur = status?.settings.currency ?? 'EUR';
  const e = (wh?: number) => splitEnergy(wh ?? null);
  const peak = status?.site?.peakPowerKw;

  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-around gap-4 rounded-2xl border border-line bg-surface-2/60 p-4">
        <Ring value={k?.selfSufficiency ?? null} color="var(--home)" label="Self-sufficiency" />
        <Ring value={k?.selfConsumption ?? null} color="var(--solar)" label="Self-consumption" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Stat
          icon={<Sun size={14} />}
          label="Produced"
          value={e(t.production)[0]}
          unit={e(t.production)[1]}
          color="var(--solar)"
          foot={peak && t.production != null ? `${(t.production / 1000 / peak).toFixed(2)} kWh/kWp` : undefined}
        />
        <Stat icon={<House size={14} />} label="Consumed" value={e(t.consumption)[0]} unit={e(t.consumption)[1]} color="var(--home)" />
        <Stat
          icon={<ArrowDownToLine size={14} />}
          label="From grid"
          value={e(t.import)[0]}
          unit={e(t.import)[1]}
          color="var(--import)"
          foot={k ? `${money(k.gridCost, cur)} cost` : undefined}
        />
        <Stat
          icon={<ArrowUpFromLine size={14} />}
          label="To grid"
          value={e(t.export)[0]}
          unit={e(t.export)[1]}
          color="var(--export)"
          foot={k ? `${money(k.exportRevenue, cur)} earned` : undefined}
        />
        {status?.hasBattery && (
          <Stat
            icon={<BatteryCharging size={14} />}
            label="Battery in / out"
            value={`${e(t.charge)[0]} / ${e(t.discharge)[0]}`}
            unit={e(t.discharge)[1]}
            color="var(--battery)"
          />
        )}
        <Stat icon={<PiggyBank size={14} />} label="Saved today" value={money(k?.savings, cur)} color="var(--export)" foot="vs. buying all from grid" />
        <Stat icon={<Leaf size={14} />} label="CO₂ avoided" value={mass(k?.co2AvoidedKg)} color="var(--export)" />
        <Stat
          icon={<Gauge size={14} />}
          label="Net grid"
          value={e(Math.abs(k?.netGrid ?? 0))[0]}
          unit={e(Math.abs(k?.netGrid ?? 0))[1]}
          color={(k?.netGrid ?? 0) > 0 ? 'var(--import)' : 'var(--export)'}
          foot={(k?.netGrid ?? 0) > 0 ? 'net importer today' : 'net exporter today'}
        />
      </div>
    </div>
  );
}
