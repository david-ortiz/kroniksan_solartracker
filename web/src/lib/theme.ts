import { useEffect, useState, useSyncExternalStore } from 'react';

export type ThemeChoice = 'system' | 'light' | 'dark';

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

function readChoice(): ThemeChoice {
  try {
    const t = localStorage.getItem('theme');
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(choice: ThemeChoice) {
  try {
    if (choice === 'system') localStorage.removeItem('theme');
    else localStorage.setItem('theme', choice);
  } catch {
    /* storage may be unavailable */
  }
  if (choice === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = choice;
  notify();
}

export function useThemeChoice() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    readChoice,
  );
}

export interface Palette {
  dark: boolean;
  surface: string;
  surface2: string;
  text: string;
  text2: string;
  muted: string;
  grid: string;
  border: string;
  solar: string;
  home: string;
  import: string;
  export: string;
  battery: string;
}

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    dark: s.colorScheme === 'dark' || v('color-scheme') === 'dark',
    surface: v('--surface'),
    surface2: v('--surface-2'),
    text: v('--text'),
    text2: v('--text-2'),
    muted: v('--muted'),
    grid: v('--grid-line'),
    border: v('--border-strong'),
    solar: v('--solar'),
    home: v('--home'),
    import: v('--import'),
    export: v('--export'),
    battery: v('--battery'),
  };
}

/** Resolved chart colors; updates on theme toggle and OS scheme change. */
export function usePalette() {
  const choice = useThemeChoice();
  const [palette, setPalette] = useState(readPalette);
  useEffect(() => {
    setPalette(readPalette());
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPalette(readPalette());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [choice]);
  return palette;
}

/** Mix two hex colors (t = share of a). Canvas can't parse color-mix(). */
export function mix(a: string, b: string, t: number) {
  const parse = (h: string) => {
    const s = h.replace('#', '');
    const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  const [ca, cb] = [parse(a), parse(b)];
  return `#${ca.map((v, i) => Math.round(v * t + cb[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
}

/** Hex → rgba() with alpha, for chart gradients and glows. */
export function alpha(hex: string, a: number) {
  const s = hex.replace('#', '');
  const full = s.length === 3 ? s.replace(/./g, (c) => c + c) : s;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r},${g},${b},${a})`;
}

/** Vertical fade for area fills. */
export function fade(hex: string, top = 0.32, bottom = 0) {
  return {
    type: 'linear',
    x: 0,
    y: 0,
    x2: 0,
    y2: 1,
    colorStops: [
      { offset: 0, color: alpha(hex, top) },
      { offset: 1, color: alpha(hex, bottom) },
    ],
  };
}

/** Switch theme with a circular reveal from the click point (View Transitions API). */
export function switchTheme(next: ThemeChoice, x: number, y: number) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
  if (!doc.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) return setTheme(next);
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  doc.startViewTransition(() => setTheme(next)).ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 650, easing: 'cubic-bezier(.2,.7,.2,1)', pseudoElement: '::view-transition-new(root)' },
    );
  });
}
