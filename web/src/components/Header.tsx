import { Sun, Moon, MonitorSmartphone, MapPin, Zap } from 'lucide-react';
import type { Live, Status } from '../lib/api';
import { ago, timeIn } from '../lib/format';
import { setTheme, useThemeChoice, type ThemeChoice } from '../lib/theme';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'dark', dark: 'light', light: 'system' };

export function Header({ status, live }: { status: Status | undefined; live: Live | undefined }) {
  const choice = useThemeChoice();
  const site = status?.site;
  const stale = live?.ts ? Date.now() / 1000 - live.ts > 3 * 3600 : true;
  const ThemeIcon = choice === 'dark' ? Moon : choice === 'light' ? Sun : MonitorSmartphone;

  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="grid h-11 w-11 place-items-center rounded-2xl text-[#1a1203] shadow-lg" style={{ background: 'linear-gradient(140deg, #ffd166, #f2a81d 55%, #e07a12)' }}>
          <Sun size={22} strokeWidth={2.4} />
        </div>
        <div>
          <h1 className="text-[19px] font-semibold tracking-tight text-ink">{site?.name ?? 'Solar Tracker'}</h1>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-muted">
            {site?.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin size={12} /> {site.location}
              </span>
            )}
            {site?.peakPowerKw && (
              <span className="inline-flex items-center gap-1">
                <Zap size={12} /> {site.peakPowerKw} kWp
              </span>
            )}
            {site?.installationDate && <span>since {new Date(site.installationDate).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</span>}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {status?.mode === 'demo' && <span className="rounded-full border border-solar/40 bg-solar/12 px-2.5 py-1 text-[12px] font-medium text-ink">Demo data</span>}
        <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2">
          <span className={`h-2 w-2 rounded-full ${stale ? 'bg-warning' : 'bg-good pulse-soft'}`} />
          {live?.ts ? (
            <>
              Data {timeIn(live.ts, site?.timezone)} <span className="text-muted">· {ago(live.ts)}</span>
            </>
          ) : (
            'Waiting for data'
          )}
        </span>
        <button
          onClick={() => setTheme(NEXT[choice])}
          className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:text-ink"
          title={`Theme: ${choice}`}
          aria-label={`Theme: ${choice}. Click to change.`}
        >
          <ThemeIcon size={16} />
        </button>
      </div>
    </header>
  );
}
