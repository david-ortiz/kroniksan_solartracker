import useSWR, { type SWRConfiguration } from 'swr';

export type Metric = 'production' | 'consumption' | 'import' | 'export' | 'charge' | 'discharge';
export type Energy = Partial<Record<Metric | 'grid_charge', number>>;

export interface Flows {
  solarToHome: number;
  solarToBattery: number;
  solarToGrid: number;
  gridToHome: number;
  gridToBattery: number;
  batteryToHome: number;
  batteryToGrid?: number;
}

export interface Kpis {
  selfConsumption: number | null;
  selfSufficiency: number | null;
  flows: Flows;
  savings: number;
  gridCost: number;
  exportRevenue: number;
  co2AvoidedKg: number;
  netGrid: number;
}

export interface Device {
  type: string;
  serialNumber: string;
  name?: string;
  manufacturer?: string;
  model?: string;
  firmwareVersion?: string;
  firmware?: string;
  active?: boolean;
}

export interface Alert {
  alertId: number;
  type?: string;
  category?: string;
  impact?: number;
  status?: string;
  openedAt?: string;
  closedAt?: string;
  component?: { serialNumber?: string; name?: string };
}

export interface Status {
  mode: 'demo' | 'live';
  configured: boolean;
  connected: boolean;
  redirectUri: string;
  site: {
    id: number;
    name: string;
    peakPowerKw: number | null;
    installationDate: string | null;
    timezone: string;
    location: string;
    latitude: number | null;
    longitude: number | null;
    activationStatus: string | null;
  } | null;
  devices: Device[];
  deviceCounts: Record<string, number>;
  hasBattery: boolean;
  alerts: Alert[];
  budget: {
    budget: number;
    used: number;
    remaining: number;
    cycleStart: number;
    cycleEnd: number;
    perDayAllowance: number;
    projected: number;
    byEndpoint: { path: string; calls: number }[];
    perDay: { day: string; n: number }[];
    exhausted: boolean;
  } | null;
  sync: {
    running: boolean;
    lastLive: number | null;
    nextLive: number | null;
    liveInterval: number;
    lastCounters: number | null;
    lastInventory: number | null;
  } | null;
  log: { ts: number; level: string; message: string }[];
  settings: { currency: string; importPrice: number; exportPrice: number; co2KgPerKwh: number };
  range: { first: string | null; last: string | null };
  now: number;
}

export interface Live {
  ts: number | null;
  values: Partial<Record<Metric | 'soc' | 'battery_energy', number>>;
  flows: Flows;
  today: { day: string; totals: Energy; kpis: Kpis };
}

export interface Point extends Energy {
  ts: number;
  soc?: number;
  battery_energy?: number;
}

export interface DayData {
  date: string;
  from: number;
  to: number;
  points: Point[];
  totals: Energy;
  kpis: Kpis;
  peak: { ts: number; value: number } | null;
}

export type Period = 'day' | 'week' | 'month' | 'year' | 'lifetime';

export interface EnergyData {
  period: Period;
  date: string;
  label: string;
  start?: string;
  end?: string;
  buckets: ({ key: string; label: string } & Energy)[];
  totals: Energy;
  kpis: Kpis;
  previous?: Energy | null;
  daysWithData?: number;
}

export interface CalendarData {
  year: number;
  days: { day: string; production: number | null; consumption: number | null }[];
  years: { first: number; last: number } | null;
}

export interface Insights {
  lifetime: Energy;
  lifetimeKpis: Kpis;
  bestDay: { day: string; value: number } | null;
  worstDay: { day: string; value: number } | null;
  avg30: Energy;
  peak: { ts: number; value: number } | null;
  peakLoad: { ts: number; value: number } | null;
  typical: { slot: number; label: string; production: number | null; consumption: number | null }[];
  daysTracked: number;
  specificYield: number | null;
  treesEquivalent: number;
  monthCompare: { current: Energy; lastYear: Energy | null };
}

export interface DevicesData {
  date: string;
  from: number;
  to: number;
  devices: Device[];
  telemetry: { kind: string; serial: string; metrics: Record<string, [number, number][]> }[];
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const opts: SWRConfiguration = { keepPreviousData: true, revalidateOnFocus: true };
const LIVE_REFRESH = 60_000;

export const useStatus = () => useSWR<Status>('/api/status', fetcher, { ...opts, refreshInterval: LIVE_REFRESH });
export const useLive = () => useSWR<Live>('/api/live', fetcher, { ...opts, refreshInterval: LIVE_REFRESH });
export const useDay = (date: string) =>
  useSWR<DayData>(`/api/day?date=${date}`, fetcher, { ...opts, refreshInterval: LIVE_REFRESH });
export const useEnergy = (period: Period, date: string) =>
  useSWR<EnergyData>(`/api/energy?period=${period}&date=${date}`, fetcher, { ...opts, refreshInterval: 5 * LIVE_REFRESH });
export const useCalendar = (year: number) => useSWR<CalendarData>(`/api/calendar?year=${year}`, fetcher, opts);
export const useInsights = () => useSWR<Insights>('/api/insights', fetcher, { ...opts, refreshInterval: 5 * LIVE_REFRESH });
export const useDevices = (date: string) => useSWR<DevicesData>(`/api/devices?date=${date}`, fetcher, opts);

export async function syncNow() {
  const res = await fetch('/api/sync', { method: 'POST' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
}
