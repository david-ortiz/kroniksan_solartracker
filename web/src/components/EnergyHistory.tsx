import { useMemo } from 'react';
import { useEnergy, type EnergyData, type Period } from '../lib/api';
import { flowsOf } from '../lib/energy';
import { dateLabel, delta, energy, kwh, mass, money, pct, shiftPeriod, splitEnergy } from '../lib/format';
import { alpha, usePalette, type Palette } from '../lib/theme';
import { EChart, axisBase, row, tipTitle, tooltipBase } from './EChart';
import { AnimatedNumber, Card, Delta, LegendItem, SectionHeading, Segmented, Skeleton, Stepper } from './ui';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'lifetime', label: 'All time' },
];

/** 45° hatch: the texture channel separates "home" stacks from "solar" stacks without relying on color. */
function hatchPattern(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.globalAlpha = 0.5;
  g.fillRect(0, 0, 8, 8);
  g.globalAlpha = 1;
  g.strokeStyle = color;
  g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(-2, 10);
  g.lineTo(10, -2);
  g.moveTo(6, 10);
  g.lineTo(10, 6);
  g.moveTo(-2, 2);
  g.lineTo(2, -2);
  g.stroke();
  return c;
}

function barOption(p: Palette, data: EnergyData, hasBattery: boolean) {
  const b = data.buckets.map((x) => ({ label: x.label, ...flowsOf(x) }));
  const kwhs = (v: number) => +(v / 1000).toFixed(2);
  const seg = (name: string, stack: string, color: string, values: number[], top = false, hatch = false) => ({
    name,
    type: 'bar',
    stack,
    barMaxWidth: 20,
    barGap: '20%',
    emphasis: { focus: 'series' },
    itemStyle: {
      color: hatch ? { image: hatchPattern(color), repeat: 'repeat' } : color,
      borderColor: p.surface,
      borderWidth: 1,
      borderRadius: top ? [6, 6, 0, 0] : 0,
    },
    data: values.map(kwhs),
  });

  return {
    animationDuration: 700,
    animationEasing: 'cubicOut' as const,
    grid: { left: 52, right: 10, top: 16, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: alpha(p.dark ? '#ffffff' : '#000000', 0.04) } },
      ...tooltipBase(p),
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const x = b[i];
        const key = data.buckets[i]?.key ?? '';
        const title = data.period === 'week' || data.period === 'month' ? dateLabel(key) : x.label;
        return (
          tipTitle(title) +
          `<div style="opacity:.6;margin-top:8px">Solar · ${energy(x.production)}</div>` +
          row(p.solar, 'to home', energy(x.solarToHome)) +
          (hasBattery ? row(p.battery, 'to battery', energy(x.solarToBattery)) : '') +
          row(p.export, 'to grid', energy(x.solarToGrid)) +
          `<div style="opacity:.6;margin-top:10px">Home · ${energy(x.consumption)}</div>` +
          row(p.solar, 'from solar', energy(x.solarToHome)) +
          (hasBattery ? row(p.battery, 'from battery', energy(x.batteryToHome)) : '') +
          row(p.import, 'from grid', energy(x.gridToHome)) +
          (hasBattery && x.gridToBattery > 1 ? `<div style="opacity:.6;margin-top:10px">Grid → battery · ${energy(x.gridToBattery)}</div>` : '')
        );
      },
    },
    xAxis: { type: 'category', data: b.map((x) => x.label), ...axisBase(p), splitLine: { show: false } },
    yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => (v >= 1000 ? `${v / 1000} MWh` : `${v} kWh`) } },
    series: [
      seg('Solar → home', 'Solar', p.solar, b.map((x) => x.solarToHome)),
      ...(hasBattery ? [seg('Solar → battery', 'Solar', p.battery, b.map((x) => x.solarToBattery))] : []),
      seg('Solar → grid', 'Solar', p.export, b.map((x) => x.solarToGrid), true),
      seg('Home ← solar', 'Home', p.solar, b.map((x) => x.solarToHome), false, true),
      ...(hasBattery ? [seg('Home ← battery', 'Home', p.battery, b.map((x) => x.batteryToHome), false, true)] : []),
      seg('Home ← grid', 'Home', p.import, b.map((x) => x.gridToHome), true, true),
    ],
  };
}

function sankeyOption(p: Palette, data: EnergyData, hasBattery: boolean) {
  const f = data.kpis.flows;
  const links = [
    { source: 'Solar', target: 'Home', value: f.solarToHome },
    { source: 'Solar', target: 'Battery', value: f.solarToBattery },
    { source: 'Solar', target: 'Export', value: f.solarToGrid },
    { source: 'Grid', target: 'Home', value: f.gridToHome },
    { source: 'Grid', target: 'Battery', value: f.gridToBattery },
    { source: 'Battery ', target: 'Home', value: f.batteryToHome },
  ].filter((l) => l.value > 1 && (hasBattery || (!l.source.startsWith('Battery') && l.target !== 'Battery')));
  const colors: Record<string, string> = { Solar: p.solar, Home: p.home, Battery: p.battery, 'Battery ': p.battery, Export: p.export, Grid: p.import };
  const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
  return {
    animationDuration: 800,
    tooltip: {
      ...tooltipBase(p),
      formatter: (x: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string }; value: number }) =>
        x.dataType === 'edge' ? `${x.data.source?.trim()} → ${x.data.target}<br/><b>${energy(x.data.value)}</b>` : `${x.data.name?.trim()}<br/><b>${energy(x.value)}</b>`,
    },
    series: [
      {
        type: 'sankey',
        left: 4,
        right: 92,
        top: 8,
        bottom: 8,
        nodeWidth: 10,
        nodeGap: 18,
        nodeAlign: 'justify',
        draggable: false,
        emphasis: { focus: 'adjacency' },
        data: names.map((n) => ({ name: n, itemStyle: { color: colors[n], borderRadius: 4 } })),
        links: links.map((l) => ({ ...l, lineStyle: { color: 'gradient', opacity: p.dark ? 0.32 : 0.4, curveness: 0.55 } })),
        label: {
          color: p.text,
          fontSize: 12,
          formatter: (x: { name: string; value: number }) => `{n|${x.name.trim()}}\n{v|${kwh(x.value, x.value >= 1e5 ? 0 : 1)}}`,
          rich: { n: { color: p.muted, fontSize: 11 }, v: { color: p.text, fontSize: 13, fontWeight: 600, padding: [3, 0, 0, 0] } },
        },
      },
    ],
  };
}

function TotalCard({ label, color, wh, prev, invert, showDelta }: { label: string; color: string; wh: number | undefined; prev?: number; invert?: boolean; showDelta: boolean }) {
  const unit = splitEnergy(wh ?? 0)[1];
  const div = unit === 'MWh' ? 1e6 : unit === 'kWh' ? 1e3 : unit === 'GWh' ? 1e9 : 1;
  return (
    <div className="card reveal p-4">
      <div className="flex items-center gap-2 text-[12.5px] text-muted">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
        {label}
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
        <span className="display text-[30px] text-ink">
          <AnimatedNumber value={wh == null ? null : wh / div} format={(v) => v.toFixed(unit === 'Wh' ? 0 : v >= 100 ? 0 : 1)} />
        </span>
        <span className="text-[13px] text-muted">{unit}</span>
        {showDelta && <Delta value={delta(wh, prev)} invert={invert} />}
      </div>
    </div>
  );
}

export function EnergyHistory({
  period,
  setPeriod,
  date,
  setDate,
  today,
  hasBattery,
  currency,
  onPickDay,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  date: string;
  setDate: (d: string) => void;
  today: string;
  hasBattery: boolean;
  currency: string;
  onPickDay: (day: string) => void;
}) {
  const p = usePalette();
  const { data, isLoading } = useEnergy(period, date);
  const bars = useMemo(() => (data ? barOption(p, data, hasBattery) : null), [p, data, hasBattery]);
  const sankey = useMemo(() => (data ? sankeyOption(p, data, hasBattery) : null), [p, data, hasBattery]);
  const t = data?.totals ?? {};
  const prev = data?.previous ?? undefined;
  const k = data?.kpis;
  const nextDisabled = period === 'lifetime' || shiftPeriod(date, period, 1) > today;
  const showDelta = period !== 'lifetime' && period !== 'day';

  const onBar = (x: { dataIndex?: number }) => {
    const key = data?.buckets[x.dataIndex ?? -1]?.key;
    if (!key) return;
    if (period === 'week' || period === 'month') onPickDay(key);
    if (period === 'year') {
      setPeriod('month');
      setDate(`${key}-01`);
    }
    if (period === 'lifetime') {
      setPeriod('year');
      setDate(`${key}-01-01`);
    }
  };

  const table = data && {
    columns: ['Period', 'Solar (kWh)', 'Home (kWh)', 'Import (kWh)', 'Export (kWh)', ...(hasBattery ? ['Charge (kWh)', 'Discharge (kWh)'] : [])],
    rows: data.buckets.map((b) => [
      b.key,
      ((b.production ?? 0) / 1000).toFixed(2),
      ((b.consumption ?? 0) / 1000).toFixed(2),
      ((b.import ?? 0) / 1000).toFixed(2),
      ((b.export ?? 0) / 1000).toFixed(2),
      ...(hasBattery ? [((b.charge ?? 0) / 1000).toFixed(2), ((b.discharge ?? 0) / 1000).toFixed(2)] : []),
    ]),
  };

  const label = data?.label && period !== 'day' ? data.label : dateLabel(date, { day: 'numeric', month: 'short', year: 'numeric' });

  return (
    <>
      <SectionHeading title={period === 'lifetime' ? 'Everything since day one' : label}>
        <Segmented value={period} options={PERIODS} onChange={setPeriod} />
        {period !== 'lifetime' && <Stepper label={label} onPrev={() => setDate(shiftPeriod(date, period, -1))} onNext={() => setDate(shiftPeriod(date, period, 1))} nextDisabled={nextDisabled} />}
      </SectionHeading>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <TotalCard label="Produced" color="var(--solar)" wh={t.production} prev={prev?.production} showDelta={showDelta} />
        <TotalCard label="Consumed" color="var(--home)" wh={t.consumption} prev={prev?.consumption} invert showDelta={showDelta} />
        <TotalCard label="Imported" color="var(--import)" wh={t.import} prev={prev?.import} invert showDelta={showDelta} />
        <TotalCard label="Exported" color="var(--export)" wh={t.export} prev={prev?.export} showDelta={showDelta} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card
          title="Where the energy went"
          subtitle={period === 'day' ? 'Hourly energy' : period === 'year' || period === 'lifetime' ? 'Click a bar to zoom in' : 'Click a bar to open that day'}
          table={table || undefined}
        >
          <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
            <LegendItem color="var(--solar)" label="Solar used at home" />
            {hasBattery && <LegendItem color="var(--battery)" label="Battery" />}
            <LegendItem color="var(--export)" label="Exported" />
            <LegendItem color="var(--import)" label="Imported" />
            <LegendItem color="var(--muted)" label="Home side (right bar)" hatch />
          </div>
          {isLoading && !data ? <Skeleton h={320} /> : bars && <EChart option={bars} height={320} onClick={onBar} ariaLabel="Energy history bar chart" />}
        </Card>

        <Card title="Energy flow" subtitle={data ? `${data.label}${k?.flows.gridToBattery ? ' · includes grid charging of the battery' : ''}` : undefined}>
          {sankey && (t.production || t.consumption) ? <EChart option={sankey} height={270} ariaLabel="Sankey diagram of energy flows" /> : <Skeleton h={270} />}
          <dl className="mt-5 grid grid-cols-2 gap-2.5 text-[12.5px]">
            <Fact label="Self-powered" value={pct(k?.selfSufficiency)} />
            <Fact label="Solar used on site" value={pct(k?.selfConsumption)} />
            <Fact label="Solar value" value={money(k?.savings, currency)} />
            <Fact label="Grid cost" value={money(k?.gridCost, currency)} />
            <Fact label="Export earnings" value={money(k?.exportRevenue, currency)} />
            <Fact label="CO₂ avoided" value={mass(k?.co2AvoidedKg)} />
            {(period === 'month' || period === 'week' || period === 'year') && <Fact label="Solar / day" value={energy((t.production ?? 0) / Math.max(1, data?.daysWithData ?? 1))} />}
            {hasBattery && <Fact label="Battery cycled" value={energy(t.discharge)} />}
          </dl>
        </Card>
      </div>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="tile px-3 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 text-[16px] font-semibold tracking-[-0.02em] text-ink num">{value}</dd>
    </div>
  );
}
