import { Copy, KeyRound, PlugZap } from 'lucide-react';
import { useState } from 'react';
import type { Status } from '../lib/api';

function CopyField({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={() => navigator.clipboard?.writeText(value).then(() => (setDone(true), setTimeout(() => setDone(false), 1500)))}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1 font-mono text-[12px] text-ink hover:border-line-strong"
      title="Copy"
    >
      <span className="truncate">{value}</span>
      <Copy size={13} className="shrink-0 text-muted" />
      {done && <span className="text-good">copied</span>}
    </button>
  );
}

/** Shown in demo mode (how to go live) or when live mode isn't connected yet. */
export function Connect({ status }: { status: Status }) {
  if (status.mode === 'live' && status.connected) return null;
  const demo = status.mode === 'demo';
  return (
    <section className="card relative overflow-hidden p-6">
      <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: 'var(--solar)' }} />
      <div className="relative flex flex-wrap items-start justify-between gap-5">
        <div className="max-w-2xl">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
            {demo ? <KeyRound size={16} /> : <PlugZap size={16} />}
            {demo ? 'You are looking at simulated data' : 'Connect your SolarEdge site'}
          </h2>
          {demo ? (
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-2">
              <li>
                Copy <code className="font-mono text-ink">.env.example</code> to <code className="font-mono text-ink">.env</code> and paste your Client ID and Client Secret.
              </li>
              <li>
                In your SolarEdge developer app, set <b>Redirect URI</b> and <b>Returned URL</b> to: <CopyField value={status.redirectUri} />
              </li>
              <li>Restart the server and click “Connect SolarEdge”.</li>
            </ol>
          ) : (
            <div className="mt-2 space-y-2 text-[13px] text-ink-2">
              <p>Sign in with your homeowner mySolarEdge account and approve access. The grant lasts 24 months.</p>
              <p>
                Your app's Redirect URI and Returned URL must be: <CopyField value={status.redirectUri} />
              </p>
            </div>
          )}
        </div>
        {!demo && (
          <a href="/auth/login" className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13.5px] font-semibold text-[#1a1203] shadow-lg" style={{ background: 'linear-gradient(140deg, #ffd166, #f2a81d)' }}>
            <PlugZap size={16} /> Connect SolarEdge
          </a>
        )}
      </div>
    </section>
  );
}
