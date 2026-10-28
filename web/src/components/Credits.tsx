import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { syncNow, type Status } from '../lib/api';
import { ago, int } from '../lib/format';
import { Card } from './ui';

/** Credit meter, schedule, per-endpoint spend and sync log. Used in the System card and the top-bar popover. */
export function CreditsBody({ status, onSynced }: { status: Status; onSynced: () => void }) {
  const b = status.budget;
  const s = status.sync;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!b || !s) return null;
  const used = b.used / b.budget;
  const projectedOver = b.projected > b.budget;
  const maxDay = Math.max(1, ...b.perDay.map((d) => d.n));

  async function refresh() {
    setBusy(true);
    setError(null);
    try {
      await syncNow();
      onSynced();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="eyebrow">API credits</div>
          <div className="mt-2 flex items-baseline gap-1.5">
            <span className="display text-[34px] text-ink">{int(b.remaining)}</span>
            <span className="text-[13px] text-muted">of {int(b.budget)} left</span>
          </div>
        </div>
        <button
          onClick={refresh}
          disabled={busy || !status.connected}
          className="chip hover:border-line-strong hover:text-ink disabled:opacity-40"
          title="Fetch now (uses about 3–6 credits)"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> Fetch now
        </button>
      </div>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-surface-3" role="meter" aria-valuenow={b.used} aria-valuemin={0} aria-valuemax={b.budget} aria-label="Credits used">
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.min(100, used * 100)}%`, background: used > 0.9 ? 'var(--critical)' : 'var(--home)' }} />
      </div>
      <div className="mt-1.5 flex justify-between text-[11.5px] text-muted num">
        <span>{int(b.used)} used</span>
        <span>resets {new Date(b.cycleEnd * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
      </div>

      {b.perDay.length > 1 && (
        <div className="mt-4 flex h-10 items-end gap-[3px]" aria-label="Credits used per day">
          {b.perDay.map((d) => (
            <span key={d.day} title={`${d.day}: ${d.n}`} className="flex-1 rounded-t-[3px] bg-home/70" style={{ height: `${Math.max(6, (d.n / maxDay) * 100)}%` }} />
          ))}
        </div>
      )}

      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
        {[
          ['Projected', <span className={projectedOver ? 'text-critical' : ''}>{int(b.projected)}</span>],
          ['Allowance / day', b.perDayAllowance.toFixed(0)],
          ['Last fetch', ago(s.lastLive)],
          ['Polling every', `${Math.round(s.liveInterval / 60)} min`],
        ].map(([k, v]) => (
          <div key={String(k)} className="tile px-3 py-2">
            <dt className="text-muted">{k}</dt>
            <dd className="mt-0.5 font-semibold text-ink num">{v}</dd>
          </div>
        ))}
      </dl>

      {b.exhausted && <p className="mt-3 rounded-xl bg-critical/12 px-3 py-2 text-[12.5px] text-critical">Monthly credit limit reached. Polling resumes next cycle.</p>}
      {error && <p className="mt-3 rounded-xl bg-critical/12 px-3 py-2 text-[12.5px] text-critical">{error}</p>}

      {b.byEndpoint.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-[12px]">
          {b.byEndpoint.slice(0, 6).map((e) => (
            <li key={e.path} className="flex items-center gap-3">
              <span className="w-32 truncate font-mono text-muted">{e.path || '/site'}</span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span className="block h-full rounded-full bg-home/60" style={{ width: `${(e.calls / b.used) * 100}%` }} />
              </span>
              <span className="w-8 text-right text-ink num">{e.calls}</span>
            </li>
          ))}
        </ul>
      )}

      {status.log.length > 0 && (
        <details className="mt-4 text-[12px]">
          <summary className="cursor-pointer text-muted hover:text-ink">Sync log</summary>
          <ul className="mt-2 max-h-48 space-y-1.5 overflow-auto pr-1">
            {status.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 font-mono text-muted">{new Date(l.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={l.level === 'error' ? 'text-critical' : l.level === 'warn' ? 'text-ink' : 'text-ink-2'}>{l.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function Credits({ status, onSynced }: { status: Status; onSynced: () => void }) {
  if (!status.budget) return null;
  return (
    <Card>
      <CreditsBody status={status} onSynced={onSynced} />
    </Card>
  );
}
