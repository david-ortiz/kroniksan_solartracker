import { useEffect, useState } from 'react';
import { Sun, Moon, MonitorSmartphone, Coins } from 'lucide-react';
import type { Live, Status } from '../lib/api';
import { ago, int, timeIn } from '../lib/format';
import { switchTheme, useThemeChoice, type ThemeChoice } from '../lib/theme';
import { Segmented } from './ui';
import { CreditsBody } from './Credits';

const NEXT: Record<ThemeChoice, ThemeChoice> = { system: 'dark', dark: 'light', light: 'system' };

export const SECTIONS = [
  { value: 'overview', label: 'Now' },
  { value: 'day', label: 'Day' },
  { value: 'history', label: 'History' },
  { value: 'insights', label: 'Insights' },
  { value: 'system', label: 'System' },
] as const;

type SectionId = (typeof SECTIONS)[number]['value'];

/** Which section is in the middle of the viewport. */
function useScrollSpy() {
  const [active, setActive] = useState<SectionId>('overview');
  useEffect(() => {
    const els = SECTIONS.map((s) => document.getElementById(s.value)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) setActive(e.target.id as SectionId);
      },
      { rootMargin: '-35% 0px -60% 0px' },
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return active;
}

export function Logo() {
  return (
    <div className="relative grid h-10 w-10 shrink-0 place-items-center rounded-[14px] text-[#2a1a02] shadow-[0_8px_24px_-8px_rgb(242_168_29/0.7),inset_0_1px_0_rgb(255_255_255/0.6)]" style={{ background: 'radial-gradient(120% 120% at 30% 20%, #ffe29a, #f6b52e 45%, #e07a12)' }}>
      <Sun size={20} strokeWidth={2.4} />
    </div>
  );
}

export function TopBar({ status, live, onSynced }: { status: Status | undefined; live: Live | undefined; onSynced: () => void }) {
  const choice = useThemeChoice();
  const active = useScrollSpy();
  const site = status?.site;
  const stale = live?.ts ? Date.now() / 1000 - live.ts > 3 * 3600 : true;
  const ThemeIcon = choice === 'dark' ? Moon : choice === 'light' ? Sun : MonitorSmartphone;
  const b = status?.budget;

  return (
    <div className="topbar">
      <div className="mx-auto flex h-[68px] max-w-[1520px] items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Logo />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">{site?.name ?? 'Solar Tracker'}</div>
            <div className="truncate text-[12px] text-muted">
              {[site?.location?.split(',')[0], site?.peakPowerKw ? `${site.peakPowerKw} kWp` : null].filter(Boolean).join(' · ')}
            </div>
          </div>
        </div>

        <nav className="hidden lg:block" aria-label="Sections">
          <Segmented
            value={active}
            options={SECTIONS as unknown as { value: SectionId; label: string }[]}
            onChange={(v) => document.getElementById(v)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          />
        </nav>

        <div className="flex items-center gap-2">
          {status?.mode === 'demo' && <span className="chip border-solar/40 text-ink">Demo data</span>}
          <span className="chip hidden sm:inline-flex" title={live?.ts ? new Date(live.ts * 1000).toLocaleString() : undefined}>
            <span className={`h-2 w-2 rounded-full ${stale ? 'bg-warning' : 'live-dot bg-good'}`} />
            {live?.ts ? (
              <>
                <span className="text-ink num">{timeIn(live.ts, site?.timezone)}</span>
                <span className="hidden text-muted md:inline">{ago(live.ts)}</span>
              </>
            ) : (
              'Waiting for data'
            )}
          </span>
          {b && status && (
            <>
              <button popoverTarget="credits-pop" className="chip hover:border-line-strong hover:text-ink" style={{ anchorName: '--credits' } as React.CSSProperties} title="SolarEdge API credits">
                <Coins size={14} />
                <span className="num text-ink">{int(b.remaining)}</span>
                <span className="hidden text-muted md:inline">credits</span>
              </button>
              <div id="credits-pop" popover="auto" className="pop">
                <CreditsBody status={status} onSynced={onSynced} />
              </div>
            </>
          )}
          <button
            onClick={(e) => switchTheme(NEXT[choice], e.clientX, e.clientY)}
            className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/60 text-ink-2 backdrop-blur transition hover:border-line-strong hover:text-ink active:scale-95"
            title={`Theme: ${choice}`}
            aria-label={`Theme: ${choice}. Click to change.`}
          >
            <ThemeIcon size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
