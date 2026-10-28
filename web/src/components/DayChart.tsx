import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useDay, type Point } from '../lib/api';
import { addDays, dateLabel, energy, power, timeIn } from '../lib/format';
import { usePalette } from '../lib/theme';
import { EChart, axisBase, row, tooltipBase } from './EChart';
import { Card, Empty, LegendItem, Skeleton, Stepper } from './ui';

const GROUP = 'day';

export function DayChart({ date, setDate, today, tz, hasBattery, minDay }: { date: string; setDate: (d: string) => void; today: string; tz: string; hasBattery: boolean; minDay?: string | null }) {
  const p = usePalette();
  const { data, isLoading } = useDay(date);
  const pts = data?.points ?? [];
  const val = (o: Point, m: string) => (o as unknown as Record<string, number | undefined>)[m];
  const has = (m: string) => pts.some((o) => val(o, m) != null);

  const common = useMemo(() => {
    const fmtTime = (v: number) => timeIn(v / 1000, tz);
    return {
      animationDuration: 500,
      grid: { left: 52, right: 14, top: 12, bottom: 26 },
      xAxis: {
        type: 'time',
        min: data ? data.from * 1000 : undefined,
        max: data ? data.to * 1000 : undefined,
        ...axisBase(p),
        splitLine: { show: false },
        axisLabel: { ...axisBase(p).axisLabel, formatter: fmtTime, hideOverlap: true },
        axisPointer: { lineStyle: { color: p.border } },
      },
      tooltip: {
        trigger: 'axis',
        ...tooltipBase(p),
        axisPointer: { type: 'line', lineStyle: { color: p.border, width: 1 } },
      },
    };
  }, [p, data, tz]);

  const line = (name: string, color: string, values: [number, number | null][], area = 0.0, dashed = false) => ({
    name,
    type: 'line',
    showSymbol: false,
    symbolSize: 8,
    smooth: 0.25,
    lineStyle: { width: 2, color, type: dashed ? 'dashed' : 'solid' },
    itemStyle: { color },
    areaStyle: area ? { color, opacity: area } : undefined,
    emphasis: { focus: 'series' },
    data: values,
  });

  const series = (m: string, sign = 1) =>
    pts.map((o) => {
      const v = val(o, m);
      return [o.ts * 1000, v != null ? sign * v : null] as [number, number | null];
    });

  const tip = (unit: (v: number) => string) => (params: { seriesName: string; value: [number, number | null]; color: string }[]) => {
    if (!params.length) return '';
    const head = `<div style="font-weight:600;margin-bottom:2px">${timeIn(params[0].value[0] / 1000, tz)}</div>`;
    return head + params.filter((x) => x.value[1] != null).map((x) => row(x.color, x.seriesName, unit(x.value[1] as number))).join('');
  };

  const powerOption = useMemo(
    () => ({
      ...common,
      tooltip: { ...common.tooltip, formatter: tip((v) => power(v)) },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => power(v) } },
      series: [
        line('Solar', p.solar, series('production'), 0.22),
        line('Home', p.home, series('consumption')),
        ...(data?.peak && data.peak.value > 50
          ? [
              {
                type: 'line',
                data: [],
                markPoint: {
                  symbol: 'circle',
                  symbolSize: 9,
                  itemStyle: { color: p.solar, borderColor: p.surface, borderWidth: 2 },
                  label: { show: true, position: 'top', color: p.text2, fontSize: 11, formatter: `Peak ${power(data.peak.value)}` },
                  data: [{ coord: [data.peak.ts * 1000, data.peak.value] }],
                },
              },
            ]
          : []),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [common, pts, p, data?.peak],
  );

  const flowOption = useMemo(
    () => ({
      ...common,
      tooltip: { ...common.tooltip, formatter: tip((v) => power(Math.abs(v))) },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => power(v) } },
      series: [
        line('Grid import', p.import, series('import'), 0.18),
        line('Grid export', p.export, series('export', -1), 0.18),
        ...(hasBattery
          ? [line('Battery discharge', p.battery, series('discharge'), 0.14), line('Battery charge', p.battery, series('charge', -1), 0.0, true)]
          : []),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [common, pts, p, hasBattery],
  );

  const socOption = useMemo(
    () => ({
      ...common,
      grid: { ...common.grid, top: 8 },
      tooltip: { ...common.tooltip, formatter: tip((v) => `${v.toFixed(0)}%`) },
      yAxis: { type: 'value', min: 0, max: 100, interval: 50, ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: '{value}%' } },
      series: [line('State of charge', p.battery, series('soc'), 0.12)],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [common, pts, p],
  );

  const t = data?.totals ?? {};
  const table = {
    columns: ['Time', 'Solar (W)', 'Home (W)', 'Import (W)', 'Export (W)', ...(hasBattery ? ['Charge (W)', 'Discharge (W)', 'SoC (%)'] : [])],
    rows: pts.map((o) => [
      timeIn(o.ts, tz),
      Math.round(o.production ?? 0),
      Math.round(o.consumption ?? 0),
      Math.round(o.import ?? 0),
      Math.round(o.export ?? 0),
      ...(hasBattery ? [Math.round(o.charge ?? 0), Math.round(o.discharge ?? 0), Math.round(o.soc ?? 0)] : []),
    ]),
  };

  return (
    <Card
      title="Power through the day"
      subtitle={`${dateLabel(date)} · 15-minute resolution`}
      table={table}
      actions={
        <>
          {date !== today && (
            <button onClick={() => setDate(today)} className="rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink">
              Today
            </button>
          )}
          <label className="relative grid h-8 w-8 cursor-pointer place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2" title="Pick a date">
            <CalendarDays size={15} />
            <input
              type="date"
              value={date}
              max={today}
              min={minDay ?? undefined}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="absolute inset-0 cursor-pointer opacity-0"
              aria-label="Pick a date"
            />
          </label>
          <Stepper label={date === today ? 'Today' : dateLabel(date, { day: 'numeric', month: 'short' })} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} nextDisabled={date >= today} />
        </>
      }
    >
      <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
        <LegendItem color="var(--solar)" label="Solar" value={energy(t.production)} />
        <LegendItem color="var(--home)" label="Home" value={energy(t.consumption)} />
        <LegendItem color="var(--import)" label="Grid import" value={energy(t.import)} />
        <LegendItem color="var(--export)" label="Grid export" value={energy(t.export)} />
        {hasBattery && <LegendItem color="var(--battery)" label="Battery out / in" value={`${energy(t.discharge)} / ${energy(t.charge)}`} />}
      </div>

      {isLoading && !data ? (
        <Skeleton h={420} />
      ) : !pts.length ? (
        <Empty h={300}>No 15-minute data stored for this day. Detailed curves are kept from the day you connected; daily totals still appear in the history below.</Empty>
      ) : (
        <div className="space-y-1">
          <EChart option={powerOption} height={250} group={GROUP} ariaLabel="Solar production and home consumption power" />
          <div className="px-1 pt-2 text-[11.5px] font-medium uppercase tracking-wider text-muted">Grid {hasBattery && '& battery'} · above = into home, below = out</div>
          <EChart option={flowOption} height={150} group={GROUP} ariaLabel="Grid and battery power" />
          {hasBattery && has('soc') && (
            <>
              <div className="px-1 pt-2 text-[11.5px] font-medium uppercase tracking-wider text-muted">Battery state of charge</div>
              <EChart option={socOption} height={100} group={GROUP} ariaLabel="Battery state of charge" />
            </>
          )}
        </div>
      )}
    </Card>
  );
}
