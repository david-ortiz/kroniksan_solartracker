# Solar Tracker

A fast dashboard for a residential SolarEdge install, built on the **Monitoring API v2** (OAuth, Site Access).

- **Live power flow**: solar, home, grid and battery.
- **Today**: production, consumption, self-sufficiency, self-consumption, grid in and out, battery, savings, CO₂.
- **Day view**: 15-minute power curves, grid and battery flows, and battery state of charge.
- **History**: day, week, month, year and lifetime bars, with a Sankey energy-flow diagram and comparison to the previous period.
- **Solar calendar**: a heatmap of every day's production.
- **Typical day profile, records and lifetime stats.**
- **Inverter health**: temperature, AC and DC voltage, frequency, current and power factor.
- **Device inventory and alerts.**
- **API credit meter and sync log.**

## How it works

SolarEdge's free tier gives **2,000 credits a month**. Each call costs 1 credit, and you get at most 10 calls a minute. So the browser never calls SolarEdge directly:

```
SolarEdge API ──(budgeted scheduler)──▶ SQLite (data/solar.db) ──▶ /api/* ──▶ React dashboard
```

The scheduler in [server/sync.js](server/sync.js) spaces out its calls based on the credits left in the billing cycle:

- It polls more often in daylight.
- Lifetime counters and inverter data are polled every few hours.
- The device inventory is refreshed weekly.
- History is backfilled when spare credits are available: daily production since installation, a few days of 15-minute curves, and energy counters week by week.
- If the monthly limit is reached, it stops until the next cycle.

Opening or refreshing the dashboard costs **zero** credits.

## Run it

```bash
npm install
npm run build      # build the frontend into dist/
npm start          # http://localhost:8787
```

For development with hot reload, run `npm run dev` and open http://localhost:5173.

Without credentials it runs in **demo mode**, with three years of simulated data.

## Connect your SolarEdge site

1. Go to https://developer.solaredge.com and open your app. It must be set to **Monitoring API** with **Site Access**, and have the scopes `SITE_DATA` and `DEVICE_DATA`.
2. Set both the **Redirect URI** and the **Returned URL** to `http://localhost:8787/auth/callback`. If you changed it, use `APP_URL` + `/auth/callback`.
3. Run `cp .env.example .env`, then fill in `SOLAREDGE_CLIENT_ID` and `SOLAREDGE_CLIENT_SECRET`.
4. Restart with `npm start`, then click **Connect SolarEdge** and approve with your homeowner account.

Tokens and data are stored in `data/solar.db`. Delete that file to start fresh.
