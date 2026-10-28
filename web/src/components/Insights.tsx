import { useMemo } from 'react';
import { Trophy, Zap, Flame, PiggyBank, Trees, CalendarRange, TrendingUp, CloudSun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useInsights, type Status } from '../lib/api';
import { axisPower, dateLabel, delta, energy, int, mass, money, pct, power, splitEnergy, timeIn } from '../lib/format';
import { alpha, fade, usePalette } from '../lib/theme';
import { EChart, axisBase, row, tipTitle, tooltipBase } from './EChart';
import { AnimatedNumber, Card, Delta, LegendItem, Skeleton } from './ui';

function Stat({ icon, label, value, foot, color = 'var(--solar)', onClick }: { icon: ReactNode; label: string; value: ReactNode; foot?: ReactNode; color?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`tile flex min-w-0 flex-col p-4 text-left ${onClick ? 'transition hover:-translate-y-0.5 hover:border-line-strong' : ''}`}>
      <span className="flex items-center gap-2 text-[12px] text-muted">
        <span className="grid h-7 w-7 place-items-center rounded-full" style={{ background: `color-mix(in oklab, ${color} 18%, transparent)`, color }}>
          {icon}
        </span>
        {label}
      </span>
      <span className="mt-3 block text-[22px] font-semibold tracking-[-0.03em] text-ink num">{value}</span>
      {foot && <span className="mt-0.5 block truncate text-[11.5px] text-muted num">{foot}</span>}
    </Tag>
  );
}

export function Insights({ status, onPickDay }: { status: Status | undefined; onPickDay: (d: string) => void }) {
  const { data } = useInsights();
  const tz = status?.site?.timezone;
  const cur = status?.settings.currency ?? 'EUR';
  const l = data?.lifetime ?? {};
  const mc = data?.monthCompare;
  const [lifeNum, lifeUnit] = splitEnergy(l.production);
  const lifeDiv = lifeUnit === 'MWh' ? 1e6 : lifeUnit === 'kWh' ? 1e3 : 1;
  const when = (ts: number) => `${new Date(ts * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} · ${timeIn(ts, tz)}`;

  return (
    <Card title="Records & lifetime" subtitle={data ? `${int(data.daysTracked)} days of history` : undefined}>
      {!data ? (
        <Skeleton h={340} />
      ) : (
        <div className="grid grid-cols-2 gap-3 @2xl:grid-cols-3">
          {/* Lifetime production: the headline tile */}
          <div className="relative col-span-2 overflow-hidden rounded-[20px] border border-line p-5 @2xl:col-span-3" style={{ background: 'linear-gradient(120deg, color-mix(in oklab, var(--solar) 22%, var(--surface-2)), var(--surface-2) 60%)' }}>
            <div className="pointer-events-none absolute -top-16 -right-10 h-48 w-48 rounded-full opacity-40 blur-3xl" style={{ background: 'var(--solar)' }} />
            <div className="eyebrow">Lifetime production</div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-2">
              <span className="display text-[48px] text-ink">
                <AnimatedNumber value={l.production == null ? null : l.production / lifeDiv} format={(v) => v.toFixed(lifeNum.includes('.') ? 2 : 0)} />
              </span>
              <span className="text-[16px] text-muted">{lifeUnit}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-ink-2 num">
              <span>{energy(l.consumption)} consumed</span>
              <span>{pct(data.lifetimeKpis.selfSufficiency)} self-powered</span>
              <span>{mass(data.lifetimeKpis.co2AvoidedKg)} CO₂ avoided</span>
            </div>
          </div>

          <Stat icon={<PiggyBank size={14} />} label="Solar value" value={money(data.lifetimeKpis.savings, cur)} color="var(--export)" foot="used at home + sold" />
          <Stat
            icon={<Trophy size={14} />}
            label="Best day"
            value={energy(data.bestDay?.value)}
            foot={data.bestDay ? dateLabel(data.bestDay.day, { day: 'numeric', month: 'short', year: 'numeric' }) : undefined}
            onClick={data.bestDay ? () => onPickDay(data.bestDay!.day) : undefined}
          />
          <Stat icon={<Zap size={14} />} label="Peak solar" value={power(data.peak?.value)} foot={data.peak ? when(data.peak.ts) : 'from stored 15-min data'} />
          <Stat icon={<Flame size={14} />} label="Peak home load" value={power(data.peakLoad?.value)} color="var(--home)" foot={data.peakLoad ? when(data.peakLoad.ts) : undefined} />
          <Stat
            icon={<CloudSun size={14} />}
            label="30-day average"
            value={`${energy(data.avg30.production)}`}
            foot={data.specificYield ? `per day · ${data.specificYield.toFixed(2)} kWh/kWp` : 'per day'}
          />
          <Stat icon={<Trees size={14} />} label="Trees equivalent" value={int(data.treesEquivalent)} color="var(--export)" foot="growing for a year" />
          <Stat
            icon={<TrendingUp size={14} />}
            label="Month vs last year"
            value={
              <span className="inline-flex flex-wrap items-center gap-2">
                {energy(mc?.current.production)} <Delta value={delta(mc?.current.production, mc?.lastYear?.production)} />
              </span>
            }
            foot={mc?.lastYear ? `${energy(mc.lastYear.production)} same days last year` : 'no data from last year yet'}
          />
          {data.worstDay && (
            <Stat icon={<CalendarRange size={14} />} label="Lowest day" value={energy(data.worstDay.value)} color="var(--muted)" foot={dateLabel(data.worstDay.day, { day: 'numeric', month: 'short', year: 'numeric' })} onClick={() => onPickDay(data.worstDay!.day)} />
          )}
        </div>
      )}
    </Card>
  );
}

export function TypicalDay() {
  const p = usePalette();
  const { data } = useInsights();
  const t = data?.typical ?? [];
  const option = useMemo(
    () => ({
      animationDuration: 700,
      grid: { left: 52, right: 12, top: 14, bottom: 28 },
      tooltip: {
        trigger: 'axis',
        ...tooltipBase(p),
        axisPointer: { type: 'line', lineStyle: { color: p.border } },
        formatter: (ps: { dataIndex: number; seriesName: string; color: string; value: number | null }[]) =>
          tipTitle(t[ps[0]?.dataIndex]?.label ?? '') + ps.filter((x) => x.value != null).map((x) => row(x.color, x.seriesName, power(x.value))).join(''),
      },
      xAxis: { type: 'category', data: t.map((x) => x.label), ...axisBase(p), splitLine: { show: false }, axisLabel: { ...axisBase(p).axisLabel, interval: 11 } },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: axisPower } },
      series: [
        {
          name: 'Solar',
          type: 'line',
          smooth: 0.35,
          showSymbol: false,
          lineStyle: { width: 2, color: p.solar, shadowBlur: 14, shadowColor: alpha(p.solar, 0.5), shadowOffsetY: 4 },
          itemStyle: { color: p.solar },
          areaStyle: { color: fade(p.solar, 0.4) },
          data: t.map((x) => x.production),
        },
        { name: 'Home', type: 'line', smooth: 0.35, showSymbol: false, lineStyle: { width: 2, color: p.home }, itemStyle: { color: p.home }, areaStyle: { color: fade(p.home, 0.1) }, data: t.map((x) => x.consumption) },
      ],
    }),
    [p, t],
  );
  return (
    <Card
      title="A typical day"
      subtitle="Average power by time of day over the last 14 days"
      table={{ columns: ['Time', 'Solar (W)', 'Home (W)'], rows: t.map((x) => [x.label, Math.round(x.production ?? 0), Math.round(x.consumption ?? 0)]) }}
    >
      <div className="mb-3 flex gap-5">
        <LegendItem color="var(--solar)" label="Solar" />
        <LegendItem color="var(--home)" label="Home" />
      </div>
      {data ? <EChart option={option} height={300} ariaLabel="Average daily power profile" /> : <Skeleton h={300} />}
    </Card>
  );
}
