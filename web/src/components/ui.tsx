import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Table2, ChartSpline } from 'lucide-react';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  table,
  pad = true,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** Accessible data view of the chart in this card. */
  table?: { columns: string[]; rows: (string | number)[][] };
  pad?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className={`card reveal min-w-0 ${pad ? 'p-5 sm:p-6' : ''} ${className}`}>
      {(title || actions || table) && (
        <header className={`mb-5 flex flex-wrap items-start justify-between gap-3 ${pad ? '' : 'px-5 pt-5 sm:px-6 sm:pt-6'}`}>
          <div className="min-w-0">
            {title && <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h3>}
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {actions}
            {table && (
              <IconButton label={showTable ? 'Show chart' : 'Show data table'} onClick={() => setShowTable((v) => !v)}>
                {showTable ? <ChartSpline size={15} /> : <Table2 size={15} />}
              </IconButton>
            )}
          </div>
        </header>
      )}
      {showTable && table ? <DataTable {...table} /> : children}
    </section>
  );
}

/** Section opener: big title, controls on the right. */
export function SectionHeading({ id, title, children }: { id?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div id={id} className="flex scroll-mt-24 flex-wrap items-end justify-between gap-4 pt-10 pb-1 sm:pt-12">
      <h2 className="text-[26px] font-semibold tracking-[-0.035em] text-ink sm:text-[32px]">{title}</h2>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function DataTable({ columns, rows }: { columns: string[]; rows: (string | number)[][] }) {
  return (
    <div className="max-h-[360px] overflow-auto rounded-2xl border border-line">
      <table className="w-full text-left text-[12.5px] num">
        <thead className="sticky top-0 bg-surface-2 text-muted">
          <tr>
            {columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium whitespace-nowrap">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-line hover:bg-surface-2">
              {r.map((c, j) => (
                <td key={j} className={`px-3 py-1.5 whitespace-nowrap ${j ? 'text-ink' : 'text-ink-2'}`}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IconButton({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="grid h-9 w-9 place-items-center rounded-full border border-line bg-surface/60 text-ink-2 backdrop-blur transition hover:border-line-strong hover:text-ink active:scale-95 disabled:pointer-events-none disabled:opacity-30"
    >
      {children}
    </button>
  );
}

/** Tabs with a thumb that glides to the active option. */
export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; size?: 'sm' | 'md' }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const el = wrap.current?.querySelector<HTMLElement>('[aria-selected="true"]');
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [value, options.length]);
  return (
    <div ref={wrap} role="tablist" className="relative inline-flex rounded-full border border-line bg-surface-2/80 p-1 backdrop-blur">
      {thumb && (
        <span
          aria-hidden
          className="absolute top-1 bottom-1 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.2),inset_0_1px_0_var(--highlight)] ring-1 ring-line transition-[left,width] duration-300 ease-[cubic-bezier(.2,.7,.2,1)]"
          style={{ left: thumb.left, width: thumb.width }}
        />
      )}
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={`relative z-10 rounded-full font-medium transition-colors ${size === 'sm' ? 'px-3 py-1 text-[12px]' : 'px-3.5 py-1.5 text-[13px]'} ${
            o.value === value ? 'text-ink' : 'text-muted hover:text-ink'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({ label, onPrev, onNext, nextDisabled, prevDisabled }: { label: ReactNode; onPrev: () => void; onNext: () => void; nextDisabled?: boolean; prevDisabled?: boolean }) {
  return (
    <div className="flex items-center gap-1 rounded-full border border-line bg-surface-2/80 p-1 backdrop-blur">
      <button onClick={onPrev} disabled={prevDisabled} aria-label="Previous" className="grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-30">
        <ChevronLeft size={15} />
      </button>
      <span className="min-w-[7.5rem] text-center text-[13px] font-medium text-ink num">{label}</span>
      <button onClick={onNext} disabled={nextDisabled} aria-label="Next" className="grid h-7 w-7 place-items-center rounded-full text-ink-2 hover:bg-surface hover:text-ink disabled:opacity-30">
        <ChevronRight size={15} />
      </button>
    </div>
  );
}

/** Legend chip: swatch carries identity, the label stays in text ink. */
export function LegendItem({ color, label, value, dashed, hatch }: { color: string; label: string; value?: ReactNode; dashed?: boolean; hatch?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 text-[12.5px] text-ink-2">
      {dashed ? (
        <span className="h-0 w-3.5 border-t-2 border-dashed" style={{ borderColor: color }} />
      ) : (
        <span
          className="h-2.5 w-2.5 rounded-[3px]"
          style={{ background: hatch ? `repeating-linear-gradient(45deg, ${color} 0 2px, color-mix(in oklab, ${color} 45%, transparent) 2px 4px)` : color }}
        />
      )}
      {label}
      {value != null && <b className="font-semibold text-ink num">{value}</b>}
    </span>
  );
}

export function Delta({ value, invert = false }: { value: number | null; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null;
  const up = value >= 0;
  const good = invert ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-semibold num ${good ? 'bg-good/12 text-good' : 'bg-critical/12 text-critical'}`}>
      {up ? '↑' : '↓'} {Math.abs(value * 100).toFixed(Math.abs(value) < 0.1 ? 1 : 0)}%
    </span>
  );
}

export function Skeleton({ h = 240, className = '' }: { h?: number; className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} style={{ height: h }} />;
}

export function Empty({ children, h = 240 }: { children: ReactNode; h?: number }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line-strong text-center text-[13px] text-muted" style={{ height: h }}>
      <div className="max-w-sm px-4 text-balance">{children}</div>
    </div>
  );
}

/** Eases from the previous value to the new one. */
export function useAnimatedNumber(value: number | null | undefined, duration = 900) {
  const [shown, setShown] = useState(value ?? 0);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setShown(value);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / duration);
      const e = 1 - Math.pow(1 - k, 4);
      setShown(a + (value - a) * e);
      if (k < 1) raf = requestAnimationFrame(tick);
      else from.current = value;
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      from.current = value;
    };
  }, [value, duration]);
  return shown;
}

export function AnimatedNumber({ value, format }: { value: number | null | undefined; format: (v: number) => string }) {
  const v = useAnimatedNumber(value);
  return <>{value == null ? '—' : format(v)}</>;
}

/** Tiny area chart for tiles (no axes; the tile's number is the reading). `domain` pins x to a time range. */
export function Sparkline({ values, color, height = 40, max, domain }: { values: [number, number | null][]; color: string; height?: number; max?: number; domain?: [number, number] }) {
  const id = useRef(`sp${Math.random().toString(36).slice(2)}`).current;
  const pts = values.filter((p): p is [number, number] => p[1] != null);
  if (pts.length < 2) return <div style={{ height }} />;
  const hi = max ?? Math.max(1, ...pts.map((p) => p[1]));
  const [x0, x1] = domain ?? [pts[0][0], pts.at(-1)![0]];
  const w = 200;
  const x = (t: number) => ((t - x0) / Math.max(1, x1 - x0)) * w;
  const y = (v: number) => height - 2 - (v / hi) * (height - 6);
  const line = pts.map(([t, v], k) => `${k ? 'L' : 'M'}${x(t).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
  const end = x(pts.at(-1)![0]);
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${end.toFixed(1)} ${height} L${x(pts[0][0]).toFixed(1)} ${height} Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.75" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {domain && <line x1={end} x2={w} y1={height - 1} y2={height - 1} stroke="var(--border-strong)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

export function Ring({ value, color, size = 64, stroke = 7, children }: { value: number | null; color: string; size?: number; stroke?: number; children?: ReactNode }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = useAnimatedNumber(Math.min(Math.max(value ?? 0, 0), 1));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-strong)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * v} ${c}`} />
      </svg>
      {children}
    </div>
  );
}
