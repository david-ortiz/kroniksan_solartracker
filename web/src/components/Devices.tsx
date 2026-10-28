import { useMemo } from 'react';
import { Cpu, Gauge, BatteryFull, PanelsTopLeft, Plug, Router, AlertTriangle, CheckCircle2, CircleAlert } from 'lucide-react';
import { useDevices, type Alert, type Device } from '../lib/api';
import { dateLabel, metricName, metricUnit, timeIn, titleCase } from '../lib/format';
import { usePalette } from '../lib/theme';
import { EChart, axisBase, tooltipBase } from './EChart';
import { Card, Empty } from './ui';

const ICONS: Record<string, React.ReactNode> = {
  INVERTER: <Cpu size={15} />,
  METER: <Gauge size={15} />,
  BATTERY: <BatteryFull size={15} />,
  OPTIMIZER: <PanelsTopLeft size={15} />,
  EV_CHARGER: <Plug size={15} />,
  GATEWAY: <Router size={15} />,
};

const PREFERRED = ['temperature', 'acVoltage', 'acFrequency', 'dcVoltage', 'acCurrent', 'powerFactor', 'acPower'];

function Spark({ name, points, tz, from, to }: { name: string; points: [number, number][]; tz: string; from: number; to: number }) {
  const p = usePalette();
  const unit = metricUnit(name);
  const values = points.map((x) => x[1]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  const digits = Math.abs(max) < 10 ? 2 : Math.abs(max) < 100 ? 1 : 0;
  const option = useMemo(
    () => ({
      animation: false,
      grid: { left: 2, right: 2, top: 6, bottom: 2 },
      xAxis: { type: 'time', show: false, min: from * 1000, max: to * 1000 },
      yAxis: { type: 'value', show: false, scale: true },
      tooltip: {
        trigger: 'axis',
        ...tooltipBase(p),
        axisPointer: { type: 'line', lineStyle: { color: p.border } },
        formatter: (ps: { value: [number, number] }[]) => `${timeIn(ps[0].value[0] / 1000, tz)} · <b>${ps[0].value[1].toFixed(digits)} ${unit}</b>`,
      },
      series: [
        {
          type: 'line',
          showSymbol: false,
          smooth: 0.3,
          lineStyle: { width: 2, color: p.home },
          areaStyle: { color: p.home, opacity: 0.1 },
          data: points.map(([ts, v]) => [ts * 1000, v]),
        },
      ],
    }),
    [p, points, from, to, tz, unit, digits],
  );
  return (
    <div className="rounded-2xl border border-line bg-surface-2/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-[12px] text-muted">{metricName(name)}</span>
        <span className="text-[15px] font-semibold text-ink num">
          {values.at(-1)?.toFixed(digits)}
          <span className="ml-0.5 text-[11px] font-normal text-muted">{unit}</span>
        </span>
      </div>
      <EChart option={option} height={46} ariaLabel={`${metricName(name)} during the day`} />
      <div className="mt-1 flex justify-between text-[10.5px] text-muted num">
        <span>min {min.toFixed(digits)}</span>
        <span>avg {avg.toFixed(digits)}</span>
        <span>max {max.toFixed(digits)}</span>
      </div>
    </div>
  );
}

export function DeviceTelemetry({ date, tz }: { date: string; tz: string }) {
  const { data } = useDevices(date);
  const inverters = (data?.telemetry ?? []).filter((t) => t.kind === 'inverter');
  return (
    <Card title="Inverter health" subtitle={`${dateLabel(date)} · AC/DC telemetry`}>
      {!inverters.length ? (
        <Empty h={140}>No inverter telemetry for this day yet. It's fetched every few hours during daylight to save API credits.</Empty>
      ) : (
        inverters.map((inv) => {
          const names = Object.keys(inv.metrics).sort((a, b) => {
            const ia = PREFERRED.indexOf(a);
            const ib = PREFERRED.indexOf(b);
            return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
          });
          return (
            <div key={inv.serial} className="mb-4 last:mb-0">
              <div className="mb-2 text-[12px] font-medium text-ink-2">
                Inverter <span className="font-mono text-muted">{inv.serial}</span>
              </div>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {names.map((n) => (
                  <Spark key={n} name={n} points={inv.metrics[n]} tz={tz} from={data!.from} to={data!.to} />
                ))}
              </div>
            </div>
          );
        })
      )}
    </Card>
  );
}

export function Inventory({ devices, alerts }: { devices: Device[]; alerts: Alert[] }) {
  const groups = useMemo(() => {
    const g = new Map<string, Device[]>();
    for (const d of devices) g.set(d.type, [...(g.get(d.type) ?? []), d]);
    return [...g].sort(([a], [b]) => ['INVERTER', 'BATTERY', 'METER', 'OPTIMIZER'].indexOf(a) - ['INVERTER', 'BATTERY', 'METER', 'OPTIMIZER'].indexOf(b));
  }, [devices]);
  const open = alerts.filter((a) => a.status !== 'CLOSED');

  return (
    <Card title="System" subtitle={`${devices.length} devices`}>
      <div className="space-y-4">
        {groups.map(([type, list]) => (
          <div key={type}>
            <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted">
              {ICONS[type] ?? <Cpu size={15} />} {titleCase(type).replace(/y$/, 'ie')}s · {list.length}
            </div>
            {type === 'OPTIMIZER' ? (
              <div className="flex flex-wrap gap-1">
                {list.map((d) => (
                  <span key={d.serialNumber} title={`${d.name ?? ''} ${d.serialNumber}`} className={`h-3.5 w-3.5 rounded-[4px] ${d.active === false ? 'bg-critical/60' : 'bg-export/70'}`} />
                ))}
              </div>
            ) : (
              <ul className="divide-y divide-line rounded-xl border border-line">
                {list.map((d) => (
                  <li key={d.serialNumber} className="flex items-center justify-between gap-3 px-3 py-2 text-[12.5px]">
                    <span className="min-w-0">
                      <span className="block truncate text-ink">{d.name || d.model || d.serialNumber}</span>
                      <span className="block truncate text-muted">
                        {[d.manufacturer, d.model].filter(Boolean).join(' ')} · <span className="font-mono">{d.serialNumber}</span>
                      </span>
                    </span>
                    {(d.firmwareVersion || d.firmware) && <span className="shrink-0 font-mono text-[11px] text-muted">fw {d.firmwareVersion || d.firmware}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}

        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[12px] font-medium text-muted">
            <AlertTriangle size={15} /> Alerts
          </div>
          {!alerts.length ? (
            <p className="flex items-center gap-2 text-[12.5px] text-ink-2">
              <CheckCircle2 size={15} className="text-good" /> No alerts reported
            </p>
          ) : (
            <ul className="space-y-1.5">
              {open.length === 0 && (
                <li className="flex items-center gap-2 text-[12.5px] text-ink-2">
                  <CheckCircle2 size={15} className="text-good" /> All clear, {alerts.length} resolved
                </li>
              )}
              {alerts.slice(0, 6).map((a) => (
                <li key={a.alertId} className="flex items-start gap-2 rounded-xl border border-line px-3 py-2 text-[12.5px]">
                  {a.status === 'CLOSED' ? <CheckCircle2 size={15} className="mt-0.5 shrink-0 text-good" /> : <CircleAlert size={15} className="mt-0.5 shrink-0 text-critical" />}
                  <span className="min-w-0">
                    <span className="block text-ink">{titleCase(a.type ?? 'Alert')}</span>
                    <span className="block text-muted">
                      {a.status === 'CLOSED' ? 'Resolved' : 'Open'}
                      {a.component?.name ? ` · ${a.component.name}` : ''}
                      {a.openedAt ? ` · ${new Date(a.openedAt).toLocaleDateString()}` : ''}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Card>
  );
}
