import { useMemo } from 'react';
import { Trophy, Zap, Flame, Sigma, PiggyBank, Trees, CalendarRange, TrendingUp, CloudSun } from 'lucide-react';
import type { ReactNode } from 'react';
import { useInsights, type Status } from '../lib/api';
import { dateLabel, delta, energy, int, mass, money, pct, power, timeIn } from '../lib/format';
import { usePalette } from '../lib/theme';
import { EChart, axisBase, row, tooltipBase } from './EChart';
import { Card, Delta, LegendItem, Skeleton } from './ui';

function Record({ icon, label, value, foot, color = 'var(--solar)', onClick }: { icon: ReactNode; label: string; value: ReactNode; foot?: ReactNode; color?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag onClick={onClick} className={`flex items-start gap-3 rounded-2xl border border-line bg-surface-2/60 p-3.5 text-left ${onClick ? 'transition hover:border-line-strong' : ''}`}>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl" style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[12px] text-muted">{label}</span>
        <span className="block text-[17px] font-semibold tracking-tight text-ink num">{value}</span>
        {foot && <span className="block text-[11.5px] text-muted num">{foot}</span>}
      </span>
    </Tag>
  );
}

export function Insights({ status, onPickDay }: { status: Status | undefined; onPickDay: (d: string) => void }) {
  const { data } = useInsights();
  const tz = status?.site?.timezone;
  const cur = status?.settings.currency ?? 'EUR';
  const l = data?.lifetime ?? {};
  const mc = data?.monthCompare;

  return (
    <Card title="Records & lifetime" subtitle={data ? `${int(data.daysTracked)} days of history` : undefined}>
      {!data ? (
        <Skeleton h={300} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Record icon={<Sigma size={16} />} label="Lifetime production" value={energy(l.production)} foot={l.consumption ? `${energy(l.consumption)} consumed` : undefined} />
          <Record icon={<PiggyBank size={16} />} label="Lifetime savings" value={money(data.lifetimeKpis.savings, cur)} color="var(--export)" foot={`${pct(data.lifetimeKpis.selfSufficiency)} self-sufficient`} />
          <Record
            icon={<Trophy size={16} />}
            label="Best day"
            value={energy(data.bestDay?.value)}
            foot={data.bestDay ? dateLabel(data.bestDay.day) : undefined}
            onClick={data.bestDay ? () => onPickDay(data.bestDay!.day) : undefined}
          />
          <Record
            icon={<Zap size={16} />}
            label="Peak solar power"
            value={power(data.peak?.value)}
            foot={data.peak ? `${new Date(data.peak.ts * 1000).toLocaleDateString()} ${timeIn(data.peak.ts, tz)}` : 'from stored 15-min data'}
          />
          <Record icon={<Flame size={16} />} label="Peak home load" value={power(data.peakLoad?.value)} color="var(--home)" foot={data.peakLoad ? `${new Date(data.peakLoad.ts * 1000).toLocaleDateString()} ${timeIn(data.peakLoad.ts, tz)}` : undefined} />
          <Record
            icon={<CloudSun size={16} />}
            label="30-day average"
            value={`${energy(data.avg30.production)}/day`}
            foot={data.specificYield ? `${data.specificYield.toFixed(2)} kWh/kWp per day` : undefined}
          />
          <Record icon={<Trees size={16} />} label="CO₂ avoided" value={mass(data.lifetimeKpis.co2AvoidedKg)} color="var(--export)" foot={`≈ ${int(data.treesEquivalent)} trees for a year`} />
          <Record
            icon={<TrendingUp size={16} />}
            label="This month vs last year"
            value={
              <span className="inline-flex items-center gap-2">
                {energy(mc?.current.production)} <Delta value={delta(mc?.current.production, mc?.lastYear?.production)} />
              </span>
            }
            foot={mc?.lastYear ? `${energy(mc.lastYear.production)} same days last year` : 'no data from last year yet'}
          />
          {data.worstDay && (
            <Record icon={<CalendarRange size={16} />} label="Lowest day" value={energy(data.worstDay.value)} color="var(--muted)" foot={dateLabel(data.worstDay.day)} onClick={() => onPickDay(data.worstDay!.day)} />
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
      animationDuration: 500,
      grid: { left: 50, right: 12, top: 12, bottom: 26 },
      tooltip: {
        trigger: 'axis',
        ...tooltipBase(p),
        axisPointer: { type: 'line', lineStyle: { color: p.border } },
        formatter: (ps: { dataIndex: number; seriesName: string; color: string; value: number | null }[]) =>
          `<div style="font-weight:600">${t[ps[0]?.dataIndex]?.label ?? ''}</div>` + ps.filter((x) => x.value != null).map((x) => row(x.color, x.seriesName, power(x.value))).join(''),
      },
      xAxis: { type: 'category', data: t.map((x) => x.label), ...axisBase(p), splitLine: { show: false }, axisLabel: { ...axisBase(p).axisLabel, interval: 11 } },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => power(v) } },
      series: [
        { name: 'Solar', type: 'line', smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: p.solar }, itemStyle: { color: p.solar }, areaStyle: { color: p.solar, opacity: 0.18 }, data: t.map((x) => x.production) },
        { name: 'Home', type: 'line', smooth: 0.3, showSymbol: false, lineStyle: { width: 2, color: p.home }, itemStyle: { color: p.home }, data: t.map((x) => x.consumption) },
      ],
    }),
    [p, t],
  );
  return (
    <Card
      title="Typical day"
      subtitle="Average power by time of day, last 14 days"
      table={{ columns: ['Time', 'Solar (W)', 'Home (W)'], rows: t.map((x) => [x.label, Math.round(x.production ?? 0), Math.round(x.consumption ?? 0)]) }}
    >
      <div className="mb-3 flex gap-5">
        <LegendItem color="var(--solar)" label="Solar" />
        <LegendItem color="var(--home)" label="Home" />
      </div>
      {data ? <EChart option={option} height={230} ariaLabel="Average daily power profile" /> : <Skeleton h={230} />}
    </Card>
  );
}
