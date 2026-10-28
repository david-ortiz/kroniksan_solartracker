import { useMemo } from 'react';
import { useCalendar } from '../lib/api';
import { dateLabel, energy } from '../lib/format';
import { mix, usePalette } from '../lib/theme';
import { EChart, tooltipBase } from './EChart';
import { Card, Skeleton, Stepper } from './ui';

export function YearHeatmap({ year, setYear, onPickDay }: { year: number; setYear: (y: number) => void; onPickDay: (d: string) => void }) {
  const p = usePalette();
  const { data } = useCalendar(year);
  const max = useMemo(() => Math.max(1, ...(data?.days ?? []).map((d) => d.production ?? 0)), [data]);

  const option = useMemo(
    () => ({
      tooltip: {
        ...tooltipBase(p),
        formatter: (x: { value: [string, number] }) => `<b>${dateLabel(x.value[0])}</b><br/>Solar ${energy(x.value[1] * 1000)}`,
      },
      visualMap: {
        show: true,
        min: 0,
        max: +(max / 1000).toFixed(1),
        orient: 'horizontal',
        left: 'right',
        bottom: 0,
        itemHeight: 120,
        itemWidth: 10,
        calculable: false,
        text: [`${(max / 1000).toFixed(0)} kWh`, '0'],
        textStyle: { color: p.muted, fontSize: 11 },
        // Sequential: one hue, from near-surface to full solar.
        inRange: { color: [p.surface2, mix(p.solar, p.surface2, 0.45), p.solar] },
      },
      calendar: {
        top: 24,
        left: 30,
        right: 8,
        bottom: 40,
        cellSize: ['auto', 14],
        range: String(year),
        itemStyle: { color: 'transparent', borderColor: p.surface, borderWidth: 3 },
        splitLine: { show: false },
        yearLabel: { show: false },
        dayLabel: { firstDay: 1, nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'], color: p.muted, fontSize: 10 },
        monthLabel: { color: p.muted, fontSize: 11 },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          itemStyle: { borderRadius: 3, borderColor: p.surface, borderWidth: 2 },
          data: (data?.days ?? []).filter((d) => d.production != null).map((d) => [d.day, +((d.production ?? 0) / 1000).toFixed(2)]),
        },
      ],
    }),
    [p, data, year, max],
  );

  const years = data?.years;
  return (
    <Card
      title="Solar calendar"
      subtitle="Daily production · click a day to open it"
      actions={<Stepper label={year} onPrev={() => setYear(year - 1)} onNext={() => setYear(year + 1)} prevDisabled={!!years && year <= years.first} nextDisabled={!!years && year >= years.last} />}
      table={data ? { columns: ['Day', 'Solar (kWh)'], rows: data.days.map((d) => [d.day, ((d.production ?? 0) / 1000).toFixed(2)]) } : undefined}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[680px]">
          {data ? (
            <EChart option={option} height={190} onClick={(x) => Array.isArray(x.data) && onPickDay(String(x.data[0]))} ariaLabel={`Daily solar production calendar for ${year}`} />
          ) : (
            <Skeleton h={190} />
          )}
        </div>
      </div>
    </Card>
  );
}
