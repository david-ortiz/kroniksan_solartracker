import { useMemo } from 'react';
import { useEnergy, type Energy, type EnergyData, type Period } from '../lib/api';
import { dateLabel, delta, energy, kwh, mass, money, pct, shiftPeriod, splitEnergy } from '../lib/format';
import { usePalette, type Palette } from '../lib/theme';
import { EChart, axisBase, row, tooltipBase } from './EChart';
import { Card, Delta, LegendItem, Segmented, Skeleton, Stepper } from './ui';

const PERIODS: { value: Period; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'lifetime', label: 'Lifetime' },
];

/** Split each bucket into where solar went and where home energy came from. */
function split(b: Energy) {
  const production = b.production ?? 0;
  const exp = b.export ?? 0;
  const charge = b.charge ?? 0;
  const imp = b.import ?? 0;
  const discharge = b.discharge ?? 0;
  const solarDirect = Math.max(0, production - exp - charge);
  return { solarDirect, charge, exp, imp, discharge, production, consumption: b.consumption ?? 0 };
}

function barOption(p: Palette, data: EnergyData, hasBattery: boolean) {
  const b = data.buckets.map((x) => ({ label: x.label, ...split(x) }));
  const kwhs = (v: number) => +(v / 1000).toFixed(2);
  const seg = (name: string, stack: string, color: string, values: number[], top = false, hatch = false) => ({
    name,
    type: 'bar',
    stack,
    barMaxWidth: 22,
    barGap: '18%',
    emphasis: { focus: 'series' },
    itemStyle: {
      color: hatch ? { image: hatchPattern(color), repeat: 'repeat' } : color,
      borderColor: p.surface,
      borderWidth: 1,
      borderRadius: top ? [4, 4, 0, 0] : 0,
    },
    data: values.map(kwhs),
  });

  const series = [
    seg('Solar → home', 'Solar', p.solar, b.map((x) => x.solarDirect)),
    ...(hasBattery ? [seg('Solar → battery', 'Solar', p.battery, b.map((x) => x.charge))] : []),
    seg('Solar → grid', 'Solar', p.export, b.map((x) => x.exp), true),
    seg('Home ← solar', 'Home', p.solar, b.map((x) => x.solarDirect), false, true),
    ...(hasBattery ? [seg('Home ← battery', 'Home', p.battery, b.map((x) => x.discharge), false, true)] : []),
    seg('Home ← grid', 'Home', p.import, b.map((x) => x.imp), true, true),
  ];

  return {
    animationDuration: 500,
    grid: { left: 48, right: 10, top: 14, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: p.grid } },
      ...tooltipBase(p),
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const x = b[i];
        const key = data.buckets[i]?.key ?? '';
        const title = data.period === 'week' || data.period === 'month' ? dateLabel(key) : data.period === 'day' ? x.label : x.label;
        return (
          `<div style="font-weight:600;margin-bottom:4px">${title}</div>` +
          `<div style="opacity:.6;margin-top:6px">Solar ${energy(x.production)}</div>` +
          row(p.solar, 'to home', energy(x.solarDirect)) +
          (hasBattery ? row(p.battery, 'to battery', energy(x.charge)) : '') +
          row(p.export, 'to grid', energy(x.exp)) +
          `<div style="opacity:.6;margin-top:8px">Home ${energy(x.consumption)}</div>` +
          row(p.solar, 'from solar', energy(x.solarDirect)) +
          (hasBattery ? row(p.battery, 'from battery', energy(x.discharge)) : '') +
          row(p.import, 'from grid', energy(x.imp))
        );
      },
    },
    xAxis: { type: 'category', data: b.map((x) => x.label), ...axisBase(p), splitLine: { show: false } },
    yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => (v >= 1000 ? `${v / 1000} MWh` : `${v} kWh`) } },
    series,
  };
}

/** 45° hatch: the texture channel distinguishes "home" stacks from "solar" stacks without color. */
function hatchPattern(color: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 8;
  const g = c.getContext('2d')!;
  g.fillStyle = color;
  g.globalAlpha = 0.55;
  g.fillRect(0, 0, 8, 8);
  g.globalAlpha = 1;
  g.strokeStyle = color;
  g.lineWidth = 2.2;
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

function sankeyOption(p: Palette, t: Energy, hasBattery: boolean) {
  const s = split(t);
  const links = [
    { source: 'Solar', target: 'Home', value: s.solarDirect },
    { source: 'Solar', target: 'Battery in', value: s.charge },
    { source: 'Solar', target: 'Grid export', value: s.exp },
    { source: 'Grid import', target: 'Home', value: s.imp },
    { source: 'Battery out', target: 'Home', value: s.discharge },
  ].filter((l) => l.value > 1 && (hasBattery || !l.source.includes('Battery') && !l.target.includes('Battery')));
  const colors: Record<string, string> = {
    Solar: p.solar,
    Home: p.home,
    'Battery in': p.battery,
    'Battery out': p.battery,
    'Grid export': p.export,
    'Grid import': p.import,
  };
  const names = [...new Set(links.flatMap((l) => [l.source, l.target]))];
  return {
    animationDuration: 600,
    tooltip: {
      ...tooltipBase(p),
      formatter: (x: { dataType: string; data: { source?: string; target?: string; value?: number; name?: string }; value: number }) =>
        x.dataType === 'edge' ? `${x.data.source} → ${x.data.target}<br/><b>${energy(x.data.value)}</b>` : `${x.data.name}<br/><b>${energy(x.value)}</b>`,
    },
    series: [
      {
        type: 'sankey',
        left: 8,
        right: 96,
        top: 10,
        bottom: 10,
        nodeWidth: 12,
        nodeGap: 14,
        draggable: false,
        emphasis: { focus: 'adjacency' },
        data: names.map((n) => ({ name: n, itemStyle: { color: colors[n], borderColor: p.surface, borderWidth: 0 } })),
        links: links.map((l) => ({ ...l, lineStyle: { color: 'gradient', opacity: 0.38, curveness: 0.5 } })),
        label: {
          color: p.text,
          fontSize: 12,
          formatter: (x: { name: string; value: number }) => `{n|${x.name}}\n{v|${kwh(x.value, x.value >= 1e5 ? 0 : 1)}}`,
          rich: { n: { color: p.text2, fontSize: 11.5 }, v: { color: p.text, fontSize: 12.5, fontWeight: 600, padding: [2, 0, 0, 0] } },
        },
      },
    ],
  };
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
  const sankey = useMemo(() => (data ? sankeyOption(p, data.totals, hasBattery) : null), [p, data, hasBattery]);
  const t = data?.totals ?? {};
  const prev = data?.previous ?? undefined;
  const k = data?.kpis;
  const nextDisabled = period === 'lifetime' || shiftPeriod(date, period, 1) > today;

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

  const tiles: { label: string; value: number | undefined; prev?: number; color: string; invert?: boolean }[] = [
    { label: 'Produced', value: t.production, prev: prev?.production, color: 'var(--solar)' },
    { label: 'Consumed', value: t.consumption, prev: prev?.consumption, color: 'var(--home)', invert: true },
    { label: 'Imported', value: t.import, prev: prev?.import, color: 'var(--import)', invert: true },
    { label: 'Exported', value: t.export, prev: prev?.export, color: 'var(--export)' },
  ];

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

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <Card
        title="Energy history"
        subtitle={period === 'day' ? 'Hourly energy' : period === 'year' || period === 'lifetime' ? 'Click a bar to zoom in' : 'Click a bar to open that day'}
        table={table || undefined}
        actions={
          <>
            <Segmented value={period} options={PERIODS} onChange={setPeriod} />
            {period !== 'lifetime' && (
              <Stepper
                label={data?.label && period !== 'day' ? data.label : dateLabel(date, { day: 'numeric', month: 'short', year: 'numeric' })}
                onPrev={() => setDate(shiftPeriod(date, period, -1))}
                onNext={() => setDate(shiftPeriod(date, period, 1))}
                nextDisabled={nextDisabled}
              />
            )}
          </>
        }
      >
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {tiles.map((x) => {
            const [n, u] = splitEnergy(x.value);
            return (
              <div key={x.label} className="rounded-2xl border border-line bg-surface-2/60 px-3.5 py-3">
                <div className="flex items-center gap-2 text-[12px] text-muted">
                  <span className="h-2 w-2 rounded-[3px]" style={{ background: x.color }} />
                  {x.label}
                </div>
                <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
                  <span className="text-[20px] font-semibold tracking-tight text-ink num">{n}</span>
                  <span className="text-[12px] text-muted">{u}</span>
                  {period !== 'lifetime' && period !== 'day' && <Delta value={delta(x.value, x.prev)} invert={x.invert} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
          <LegendItem color="var(--solar)" label="Solar used at home" />
          {hasBattery && <LegendItem color="var(--battery)" label="Battery" />}
          <LegendItem color="var(--export)" label="Exported" />
          <LegendItem color="var(--import)" label="Imported" />
          <span className="text-[12px] text-muted">Left bar: where solar went · Right bar (hatched): where home energy came from</span>
        </div>
        {isLoading && !data ? <Skeleton h={300} /> : bars && <EChart option={bars} height={300} onClick={onBar} ariaLabel="Energy history bar chart" />}
      </Card>

      <Card title="Energy flow" subtitle={data ? `${data.label}` : undefined}>
        {sankey && (t.production || t.consumption) ? (
          <EChart option={sankey} height={260} ariaLabel="Sankey diagram of energy flows" />
        ) : (
          <Skeleton h={260} />
        )}
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-[12.5px]">
          <Fact label="Self-sufficiency" value={pct(k?.selfSufficiency)} />
          <Fact label="Self-consumption" value={pct(k?.selfConsumption)} />
          <Fact label="Saved" value={money(k?.savings, currency)} />
          <Fact label="Grid cost" value={money(k?.gridCost, currency)} />
          <Fact label="Export earnings" value={money(k?.exportRevenue, currency)} />
          <Fact label="CO₂ avoided" value={mass(k?.co2AvoidedKg)} />
          {period === 'month' || period === 'week' || period === 'year' ? (
            <Fact label="Avg / day" value={energy((t.production ?? 0) / Math.max(1, data?.daysWithData ?? 1))} />
          ) : null}
          {hasBattery && <Fact label="Battery cycled" value={energy(t.discharge)} />}
        </dl>
      </Card>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-line pt-2">
      <dt className="text-muted">{label}</dt>
      <dd className="mt-0.5 text-[15px] font-semibold text-ink num">{value}</dd>
    </div>
  );
}
