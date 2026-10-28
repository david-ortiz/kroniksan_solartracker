import { useEffect, useRef, useState } from 'react';
import { useLive, useStatus, type Period } from './lib/api';
import { Header } from './components/Header';
import { Connect } from './components/Connect';
import { PowerFlow } from './components/PowerFlow';
import { TodayStats } from './components/TodayStats';
import { DayChart } from './components/DayChart';
import { EnergyHistory } from './components/EnergyHistory';
import { YearHeatmap } from './components/YearHeatmap';
import { Insights, TypicalDay } from './components/Insights';
import { DeviceTelemetry, Inventory } from './components/Devices';
import { Credits } from './components/Credits';
import { Card } from './components/ui';
import { ago } from './lib/format';

function localToday(tz?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export default function App() {
  const { data: status, mutate: refreshStatus } = useStatus();
  const { data: live, mutate: refreshLive } = useLive();
  const tz = status?.site?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localToday(tz);

  const [day, setDay] = useState(today);
  const [period, setPeriod] = useState<Period>('month');
  const [periodDate, setPeriodDate] = useState(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));
  const dayRef = useRef<HTMLDivElement>(null);

  // Keep "today" selections rolling over at midnight / after the site timezone loads.
  const lastToday = useRef(today);
  useEffect(() => {
    if (lastToday.current === today) return;
    if (day === lastToday.current) setDay(today);
    if (periodDate === lastToday.current) setPeriodDate(today);
    lastToday.current = today;
  }, [today, day, periodDate]);

  const pickDay = (d: string) => {
    setDay(d);
    dayRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const hasBattery = Boolean(status?.hasBattery);

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 px-4 py-5 sm:px-6 lg:py-7">
      <Header status={status} live={live} />
      {status && <Connect status={status} />}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card title="Live power" subtitle={live?.ts ? `SolarEdge reports in 15-minute steps · updated ${ago(live.ts)}` : 'No data yet'}>
          <PowerFlow live={live} hasBattery={hasBattery} />
        </Card>
        <Card title="Today" subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}>
          <TodayStats live={live} status={status} />
        </Card>
      </div>

      <div ref={dayRef} className="scroll-mt-4">
        <DayChart date={day} setDate={setDay} today={today} tz={tz} hasBattery={hasBattery} minDay={status?.range.first} />
      </div>

      <EnergyHistory
        period={period}
        setPeriod={setPeriod}
        date={periodDate}
        setDate={setPeriodDate}
        today={today}
        hasBattery={hasBattery}
        currency={status?.settings.currency ?? 'EUR'}
        onPickDay={pickDay}
      />

      <YearHeatmap year={year} setYear={setYear} onPickDay={pickDay} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <TypicalDay />
        <Insights status={status} onPickDay={pickDay} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <DeviceTelemetry date={day} tz={tz} />
        <div className="space-y-4">
          {status?.mode === 'live' && (
            <Credits
              status={status}
              onSynced={() => {
                refreshStatus();
                refreshLive();
              }}
            />
          )}
          <Inventory devices={status?.devices ?? []} alerts={status?.alerts ?? []} />
        </div>
      </div>

      <footer className="pb-4 pt-2 text-center text-[12px] text-muted">
        Data from the SolarEdge Monitoring API v2 · stored locally, the dashboard itself uses no API credits
        {status?.site?.timezone && ` · times in ${status.site.timezone}`}
      </footer>
    </div>
  );
}
