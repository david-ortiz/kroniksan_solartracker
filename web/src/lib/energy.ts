import type { Energy, Flows } from './api';

/** Mirror of the server's split: where a bucket's energy came from and went to (Wh). */
export function flowsOf(t: Energy): Flows & { production: number; consumption: number } {
  const production = t.production ?? 0;
  const consumption = t.consumption ?? 0;
  const imp = t.import ?? 0;
  const exp = t.export ?? 0;
  const charge = t.charge ?? 0;
  const discharge = t.discharge ?? 0;
  const gridToBattery = Math.min(charge, t.grid_charge ?? Math.max(0, charge - Math.max(0, production - exp)));
  const solarToBattery = charge - gridToBattery;
  const solarToHome = Math.max(0, production - exp - solarToBattery);
  return {
    production,
    consumption,
    solarToHome,
    solarToBattery,
    solarToGrid: exp,
    gridToHome: Math.max(0, imp - gridToBattery),
    gridToBattery,
    batteryToHome: discharge,
  };
}
