import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { useDay, type Point, type Status } from '../lib/api';
import { addDays, axisPower, dateLabel, energy, power, timeIn } from '../lib/format';
import { sunTimes } from '../lib/sun';
import { alpha, fade, usePalette } from '../lib/theme';
import { EChart, axisBase, row, tipTitle, tooltipBase } from './EChart';
import { Card, Empty, LegendItem, SectionHeading, Skeleton, Stepper } from './ui';

const GROUP = 'day';

export function DayChart({ date, setDate, today, status }: { date: string; setDate: (d: string) => void; today: string; status: Status | undefined }) {
  const p = usePalette();
  const { data, isLoading } = useDay(date);
  const tz = status?.site?.timezone;
  const hasBattery = Boolean(status?.hasBattery);
  const pts = data?.points ?? [];
  const val = (o: Point, m: string) => (o as unknown as Record<string, number | undefined>)[m];
  const has = (m: string) => pts.some((o) => val(o, m) != null);

  const sun = useMemo(() => {
    const lat = status?.site?.latitude;
    const lon = status?.site?.longitude;
    return data && lat != null && lon != null ? sunTimes(data.from, data.to, lat, lon) : null;
  }, [data, status?.site?.latitude, status?.site?.longitude]);

  const common = useMemo(() => {
    const night =
      data && sun?.sunrise && sun?.sunset
        ? {
            silent: true,
            itemStyle: { color: alpha(p.dark ? '#7f8cff' : '#3b4a9a', p.dark ? 0.045 : 0.04) },
            data: [
              [{ xAxis: data.from * 1000 }, { xAxis: sun.sunrise * 1000 }],
              [{ xAxis: sun.sunset * 1000 }, { xAxis: data.to * 1000 }],
            ],
          }
        : undefined;
    const nowMs = Date.now();
    const nowLine =
      data && nowMs > data.from * 1000 && nowMs < data.to * 1000
        ? {
            silent: true,
            symbol: 'none',
            lineStyle: { color: p.muted, type: [4, 4], width: 1 },
            label: { formatter: 'now', color: p.muted, fontSize: 10.5, position: 'end', distance: 4 },
            data: [{ xAxis: nowMs }],
          }
        : undefined;
    return {
      night,
      nowLine,
      base: {
        animationDuration: 700,
        animationEasing: 'cubicOut' as const,
        grid: { left: 54, right: 16, top: 16, bottom: 28 },
        xAxis: {
          type: 'time',
          min: data ? data.from * 1000 : undefined,
          max: data ? data.to * 1000 : undefined,
          ...axisBase(p),
          splitLine: { show: false },
          axisLabel: { ...axisBase(p).axisLabel, formatter: (v: number) => timeIn(v / 1000, tz), hideOverlap: true },
        },
        tooltip: {
          trigger: 'axis',
          ...tooltipBase(p),
          axisPointer: { type: 'line', lineStyle: { color: p.border, width: 1 } },
        },
      },
    };
  }, [p, data, tz, sun]);

  const series = (m: string, sign = 1) =>
    pts.map((o) => {
      const v = val(o, m);
      return [o.ts * 1000, v != null ? sign * v : null] as [number, number | null];
    });

  const line = (name: string, color: string, values: [number, number | null][], opts: { area?: number; dashed?: boolean; glow?: boolean } = {}) => ({
    name,
    type: 'line',
    showSymbol: false,
    symbolSize: 8,
    smooth: 0.3,
    lineStyle: {
      width: 2,
      color,
      type: opts.dashed ? [5, 4] : 'solid',
      shadowBlur: opts.glow ? 14 : 0,
      shadowColor: alpha(color, 0.55),
      shadowOffsetY: opts.glow ? 4 : 0,
    },
    itemStyle: { color, borderColor: p.surface, borderWidth: 2 },
    areaStyle: opts.area ? { color: fade(color, opts.area) } : undefined,
    emphasis: { focus: 'series' },
    data: values,
  });

  const tip = (fmt: (v: number) => string) => (params: { seriesName: string; value: [number, number | null]; color: string }[]) => {
    if (!params.length) return '';
    return tipTitle(timeIn(params[0].value[0] / 1000, tz)) + params.filter((x) => x.value[1] != null).map((x) => row(x.color, x.seriesName, fmt(x.value[1] as number))).join('');
  };

  const powerOption = useMemo(
    () => ({
      ...common.base,
      tooltip: { ...common.base.tooltip, formatter: tip(power) },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: axisPower } },
      series: [
        { ...line('Solar', p.solar, series('production'), { area: 0.42, glow: true }), markArea: common.night, markLine: common.nowLine },
        line('Home', p.home, series('consumption'), { area: 0.08 }),
        ...(data?.peak && data.peak.value > 50
          ? [
              {
                type: 'line',
                data: [],
                markPoint: {
                  symbol: 'circle',
                  symbolSize: 10,
                  itemStyle: { color: p.solar, borderColor: p.surface, borderWidth: 3, shadowBlur: 12, shadowColor: alpha(p.solar, 0.8) },
                  label: {
                    show: true,
                    position: 'top',
                    distance: 10,
                    color: p.text,
                    fontSize: 11,
                    fontWeight: 600,
                    backgroundColor: p.surface,
                    borderColor: p.border,
                    borderWidth: 1,
                    borderRadius: 8,
                    padding: [4, 8],
                    formatter: `Peak ${power(data.peak.value)}`,
                  },
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
      ...common.base,
      grid: { ...common.base.grid, top: 10 },
      tooltip: { ...common.base.tooltip, formatter: tip((v) => power(Math.abs(v))) },
      yAxis: { type: 'value', ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: axisPower } },
      series: [
        { ...line('Grid import', p.import, series('import'), { area: 0.3 }), markArea: common.night, markLine: common.nowLine && { ...common.nowLine, label: { show: false } } },
        line('Grid export', p.export, series('export', -1), { area: 0.3 }),
        ...(hasBattery ? [line('Battery discharge', p.battery, series('discharge'), { area: 0.22 }), line('Battery charge', p.battery, series('charge', -1), { dashed: true })] : []),
      ],
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [common, pts, p, hasBattery],
  );

  const socOption = useMemo(
    () => ({
      ...common.base,
      grid: { ...common.base.grid, top: 8 },
      tooltip: { ...common.base.tooltip, formatter: tip((v) => `${v.toFixed(0)}%`) },
      yAxis: { type: 'value', min: 0, max: 100, interval: 50, ...axisBase(p), axisLabel: { ...axisBase(p).axisLabel, formatter: '{value}%' } },
      series: [{ ...line('State of charge', p.battery, series('soc'), { area: 0.25, glow: true }), markArea: common.night, markLine: common.nowLine && { ...common.nowLine, label: { show: false } } }],
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

  const label = (text: string) => <div className="eyebrow px-1 pt-4 pb-1">{text}</div>;

  return (
    <>
      <SectionHeading title={date === today ? 'Today, hour by hour' : dateLabel(date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}>
        {date !== today && (
          <button onClick={() => setDate(today)} className="chip hover:border-line-strong hover:text-ink">
            Jump to today
          </button>
        )}
        <label className="relative grid h-9 w-9 cursor-pointer place-items-center rounded-full border border-line bg-surface/60 text-ink-2 backdrop-blur hover:border-line-strong hover:text-ink" title="Pick a date">
          <CalendarDays size={15} />
          <input
            type="date"
            value={date}
            max={today}
            min={status?.range.first ?? undefined}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Pick a date"
          />
        </label>
        <Stepper label={date === today ? 'Today' : dateLabel(date, { day: 'numeric', month: 'short' })} onPrev={() => setDate(addDays(date, -1))} onNext={() => setDate(addDays(date, 1))} nextDisabled={date >= today} />
      </SectionHeading>

      <Card table={table} title="Power" subtitle={`15-minute resolution${sun?.sunrise && sun.sunset ? ` · shaded hours are night (sunrise ${timeIn(sun.sunrise, tz)}, sunset ${timeIn(sun.sunset, tz)})` : ''}`}>
        <div className="mb-2 flex flex-wrap gap-x-5 gap-y-2">
          <LegendItem color="var(--solar)" label="Solar" value={energy(t.production)} />
          <LegendItem color="var(--home)" label="Home" value={energy(t.consumption)} />
          <LegendItem color="var(--import)" label="Grid import" value={energy(t.import)} />
          <LegendItem color="var(--export)" label="Grid export" value={energy(t.export)} />
          {hasBattery && <LegendItem color="var(--battery)" label="Battery out / in" value={`${energy(t.discharge)} / ${energy(t.charge)}`} />}
        </div>

        {isLoading && !data ? (
          <Skeleton h={460} />
        ) : !pts.length ? (
          <Empty h={320}>No 15-minute data stored for this day. Detailed curves are kept from the day you connected; daily totals still appear in the history below.</Empty>
        ) : (
          <div>
            <EChart option={powerOption} height={280} group={GROUP} ariaLabel="Solar production and home consumption power" />
            {label(`Grid${hasBattery ? ' & battery' : ''} · above the line flows into the home, below flows out`)}
            <EChart option={flowOption} height={170} group={GROUP} ariaLabel="Grid and battery power" />
            {hasBattery && has('soc') && (
              <>
                {label('Battery state of charge')}
                <EChart option={socOption} height={110} group={GROUP} ariaLabel="Battery state of charge" />
              </>
            )}
          </div>
        )}
      </Card>
    </>
  );
}
