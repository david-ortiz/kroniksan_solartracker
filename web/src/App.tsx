import { useEffect, useRef, useState } from 'react';
import { useDay, useLive, useStatus, type Period } from './lib/api';
import { TopBar } from './components/TopBar';
import { Connect } from './components/Connect';
import { Hero } from './components/Hero';
import { PowerFlow } from './components/PowerFlow';
import { KpiStrip } from './components/KpiStrip';
import { DayChart } from './components/DayChart';
import { EnergyHistory } from './components/EnergyHistory';
import { YearHeatmap } from './components/YearHeatmap';
import { Insights, TypicalDay } from './components/Insights';
import { DeviceTelemetry, Inventory } from './components/Devices';
import { Credits } from './components/Credits';
import { Card, SectionHeading } from './components/ui';
import { ago } from './lib/format';

function localToday(tz?: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function greeting(tz?: string) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
  return h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

/** Cards light up under the cursor: track the pointer as CSS variables on the hovered card. */
function useSpotlight() {
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const card = (e.target as Element | null)?.closest?.('.card') as HTMLElement | null;
      if (!card) return;
      const r = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${e.clientX - r.left}px`);
      card.style.setProperty('--my', `${e.clientY - r.top}px`);
    };
    document.addEventListener('pointermove', onMove, { passive: true });
    return () => document.removeEventListener('pointermove', onMove);
  }, []);
}

export default function App() {
  const { data: status, mutate: refreshStatus } = useStatus();
  const { data: live, mutate: refreshLive } = useLive();
  const tz = status?.site?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = localToday(tz);
  const { data: todayData } = useDay(today);
  useSpotlight();

  const [day, setDay] = useState(today);
  const [period, setPeriod] = useState<Period>('month');
  const [periodDate, setPeriodDate] = useState(today);
  const [year, setYear] = useState(Number(today.slice(0, 4)));

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
    document.getElementById('day')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const synced = () => {
    refreshStatus();
    refreshLive();
  };
  const hasBattery = Boolean(status?.hasBattery);

  return (
    <>
      <div className="aurora" aria-hidden />
      <TopBar status={status} live={live} onSynced={synced} />

      <main className="mx-auto max-w-[1520px] px-4 pb-16 sm:px-6">
        {status && (
          <div className="pt-4">
            <Connect status={status} />
          </div>
        )}

        <section id="overview" className="space-y-4">
          <SectionHeading
            title={
              <>
                {greeting(tz)}. <span className="text-muted">Here's your energy, live.</span>
              </>
            }
          />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Hero live={live} day={todayData} status={status} />
            <Card title="Power flow" subtitle={live?.ts ? `Latest 15-minute reading · ${ago(live.ts)}` : 'No data yet'}>
              <PowerFlow live={live} hasBattery={hasBattery} />
            </Card>
          </div>
          <KpiStrip live={live} day={todayData} status={status} />
        </section>

        <section id="day" className="space-y-4">
          <DayChart date={day} setDate={setDay} today={today} status={status} />
        </section>

        <section id="history" className="space-y-4">
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
        </section>

        <section id="insights" className="space-y-4">
          <SectionHeading title="Patterns & records" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TypicalDay />
            <Insights status={status} onPickDay={pickDay} />
          </div>
        </section>

        <section id="system" className="space-y-4">
          <SectionHeading title="Hardware & data" />
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
            <DeviceTelemetry date={day} tz={tz} />
            <div className="space-y-4">
              {status?.mode === 'live' && <Credits status={status} onSynced={synced} />}
              <Inventory devices={status?.devices ?? []} alerts={status?.alerts ?? []} />
            </div>
          </div>
        </section>

        <footer className="mt-16 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-6 text-[12px] text-muted">
          <span>SolarEdge Monitoring API v2 · stored locally, so browsing the dashboard costs no API credits.</span>
          {status?.site?.timezone && <span className="font-mono">{status.site.timezone}</span>}
        </footer>
      </main>
    </>
  );
}
