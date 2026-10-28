import { Sun, House, ArrowDownToLine, ArrowUpFromLine, BatteryCharging, Leaf } from 'lucide-react';
import type { ReactNode } from 'react';
import type { DayData, Live, Status } from '../lib/api';
import { mass, money, pct, power, splitEnergy } from '../lib/format';
import { AnimatedNumber, Ring, Sparkline } from './ui';

function Tile({ icon, label, color, value, unit, foot, children }: { icon: ReactNode; label: string; color: string; value: ReactNode; unit?: string; foot?: ReactNode; children?: ReactNode }) {
  return (
    <div className="card reveal flex min-w-0 flex-col overflow-hidden p-4 pb-0">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-3 flex items-baseline gap-1">
        <span className="display text-[30px] text-ink">{value}</span>
        {unit && <span className="text-[13px] text-muted">{unit}</span>}
      </div>
      <div className="mt-1 min-h-[18px] truncate text-[12px] text-muted num">{foot}</div>
      <div className="-mx-4 mt-auto pt-2">{children ?? <div className="h-10" />}</div>
    </div>
  );
}

function EnergyValue({ wh }: { wh: number | undefined }) {
  const unit = splitEnergy(wh ?? 0)[1];
  const div = unit === 'MWh' ? 1e6 : unit === 'kWh' ? 1e3 : 1;
  return <AnimatedNumber value={wh == null ? null : wh / div} format={(v) => v.toFixed(unit === 'Wh' ? 0 : v >= 100 ? 0 : v >= 10 ? 1 : 2)} />;
}

const unitOf = (wh: number | undefined) => splitEnergy(wh ?? 0)[1];

export function KpiStrip({ live, day, status }: { live: Live | undefined; day: DayData | undefined; status: Status | undefined }) {
  const t = live?.today.totals ?? {};
  const k = live?.today.kpis;
  const cur = status?.settings.currency ?? 'EUR';
  const pts = day?.points ?? [];
  const s = (m: 'production' | 'consumption' | 'import' | 'export' | 'soc') => pts.map((p) => [p.ts, p[m] ?? null] as [number, number | null]);
  const domain = day ? ([day.from, day.to] as [number, number]) : undefined;
  const hasBattery = Boolean(status?.hasBattery);
  const avgHome = pts.length ? pts.reduce((a, p) => a + (p.consumption ?? 0), 0) / pts.length : null;

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6">
      <Tile icon={<Sun size={14} />} label="Solar today" color="var(--solar)" value={<EnergyValue wh={t.production} />} unit={unitOf(t.production)} foot={day?.peak ? `peak ${power(day.peak.value)}` : 'no sun yet'}>
        <Sparkline domain={domain} values={s('production')} color="var(--solar)" />
      </Tile>
      <Tile icon={<House size={14} />} label="Home today" color="var(--home)" value={<EnergyValue wh={t.consumption} />} unit={unitOf(t.consumption)} foot={avgHome != null ? `avg ${power(avgHome)}` : null}>
        <Sparkline domain={domain} values={s('consumption')} color="var(--home)" />
      </Tile>
      <Tile icon={<Leaf size={14} />} label="Self-powered" color="var(--export)" value={<AnimatedNumber value={k?.selfSufficiency == null ? null : k.selfSufficiency * 100} format={(v) => v.toFixed(0)} />} unit="%" foot={k ? `${mass(k.co2AvoidedKg)} CO₂ avoided` : null}>
        <div className="flex h-10 items-center px-4">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full transition-[width] duration-1000" style={{ width: pct(k?.selfSufficiency ?? 0), background: 'var(--export)' }} />
          </div>
        </div>
      </Tile>
      <Tile icon={<ArrowDownToLine size={14} />} label="From grid" color="var(--import)" value={<EnergyValue wh={t.import} />} unit={unitOf(t.import)} foot={k ? `${money(k.gridCost, cur)} · ${k.flows.gridToBattery > 50 ? `${splitEnergy(k.flows.gridToBattery).join(' ')} into battery` : 'all to home'}` : null}>
        <Sparkline domain={domain} values={s('import')} color="var(--import)" />
      </Tile>
      <Tile icon={<ArrowUpFromLine size={14} />} label="To grid" color="var(--export)" value={<EnergyValue wh={t.export} />} unit={unitOf(t.export)} foot={k ? `${money(k.exportRevenue, cur)} earned` : null}>
        <Sparkline domain={domain} values={s('export')} color="var(--export)" />
      </Tile>
      {hasBattery ? (
        <Tile
          icon={<BatteryCharging size={14} />}
          label="Battery"
          color="var(--battery)"
          value={<AnimatedNumber value={live?.values.soc ?? null} format={(v) => v.toFixed(0)} />}
          unit="%"
          foot={`in ${splitEnergy(t.charge ?? 0).join(' ')} · out ${splitEnergy(t.discharge ?? 0).join(' ')}`}
        >
          <Sparkline domain={domain} values={s('soc')} color="var(--battery)" max={100} />
        </Tile>
      ) : (
        <Tile icon={<Leaf size={14} />} label="Self-consumption" color="var(--solar)" value={pct(k?.selfConsumption)} foot="of solar used at home">
          <div className="flex h-10 items-center px-4">
            <Ring value={k?.selfConsumption ?? 0} color="var(--solar)" size={32} stroke={5} />
          </div>
        </Tile>
      )}
    </div>
  );
}
