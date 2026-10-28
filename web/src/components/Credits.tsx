import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { syncNow, type Status } from '../lib/api';
import { ago, int } from '../lib/format';
import { Card } from './ui';

export function Credits({ status, onSynced }: { status: Status; onSynced: () => void }) {
  const b = status.budget;
  const s = status.sync;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!b || !s) return null;
  const used = b.used / b.budget;
  const projectedOver = b.projected > b.budget;

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
    <Card
      title="SolarEdge API credits"
      subtitle={`Cycle resets ${new Date(b.cycleEnd * 1000).toLocaleDateString()}`}
      actions={
        <button
          onClick={refresh}
          disabled={busy || !status.connected}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12.5px] text-ink-2 hover:bg-surface-2 hover:text-ink disabled:opacity-40"
          title="Fetch now (uses about 3–6 credits)"
        >
          <RefreshCw size={14} className={busy ? 'animate-spin' : ''} /> Fetch now
        </button>
      }
    >
      <div className="flex items-baseline justify-between">
        <span className="text-[22px] font-semibold text-ink num">
          {int(b.remaining)}
          <span className="ml-1 text-[12.5px] font-normal text-muted">of {int(b.budget)} left</span>
        </span>
        <span className="text-[12px] text-muted num">{int(b.used)} used</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2" role="meter" aria-valuenow={b.used} aria-valuemin={0} aria-valuemax={b.budget} aria-label="Credits used">
        <div className="h-full rounded-full" style={{ width: `${Math.min(100, used * 100)}%`, background: used > 0.9 ? 'var(--critical)' : 'var(--home)' }} />
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-[12.5px]">
        <div>
          <dt className="text-muted">Projected this cycle</dt>
          <dd className={`font-semibold num ${projectedOver ? 'text-critical' : 'text-ink'}`}>{int(b.projected)}</dd>
        </div>
        <div>
          <dt className="text-muted">Per-day allowance</dt>
          <dd className="font-semibold text-ink num">{b.perDayAllowance.toFixed(0)}</dd>
        </div>
        <div>
          <dt className="text-muted">Last fetch</dt>
          <dd className="font-semibold text-ink">{ago(s.lastLive)}</dd>
        </div>
        <div>
          <dt className="text-muted">Polling every</dt>
          <dd className="font-semibold text-ink num">{Math.round(s.liveInterval / 60)} min</dd>
        </div>
      </dl>
      {b.exhausted && <p className="mt-3 rounded-lg bg-critical/12 px-3 py-2 text-[12.5px] text-critical">Monthly credit limit reached. Polling resumes next cycle.</p>}
      {error && <p className="mt-3 rounded-lg bg-critical/12 px-3 py-2 text-[12.5px] text-critical">{error}</p>}
      {b.byEndpoint.length > 0 && (
        <ul className="mt-4 space-y-1 text-[12px]">
          {b.byEndpoint.slice(0, 6).map((e) => (
            <li key={e.path} className="flex justify-between gap-3">
              <span className="truncate font-mono text-muted">{e.path || '/site'}</span>
              <span className="text-ink num">{e.calls}</span>
            </li>
          ))}
        </ul>
      )}
      {status.log.length > 0 && (
        <details className="mt-4 text-[12px]">
          <summary className="cursor-pointer text-muted hover:text-ink">Sync log</summary>
          <ul className="mt-2 max-h-48 space-y-1 overflow-auto">
            {status.log.map((l, i) => (
              <li key={i} className="flex gap-2">
                <span className="shrink-0 text-muted num">{new Date(l.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className={l.level === 'error' ? 'text-critical' : l.level === 'warn' ? 'text-ink' : 'text-ink-2'}>{l.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
