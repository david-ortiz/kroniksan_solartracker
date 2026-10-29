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

## E-ink display (Inky Impression 13.3")

`GET /api/eink.png` returns a 1600 × 1200 PNG drawn only in the panel's six Spectra 6 inks (black, white, yellow, red, blue, green). It has no anti-aliasing, so it displays without dithering. It shows:

- solar power now
- home, grid and battery
- today's totals and money
- today's power curve
- the last 7 days

| URL | What it is |
|---|---|
| `/api/eink.png` | The image for the panel, landscape (1600 × 1200). |
| `/api/eink-portrait.png` | The portrait layout (1200 × 1600). Same as `/api/eink.png?orientation=portrait`. |
| `/api/eink.png?preview=1` | The same layout in colours close to the real panel, for checking it in a browser. |
| `/api/eink.svg` | The vector source. |
| `/api/eink-art.png` | **Gallery wall frame** (portrait 1200 × 1600). A public-domain masterpiece from The Met, picked to match the sky outside (clear, cloudy, dawn, dusk or night), with a museum-style label showing solar now (battery % at night) and solar today. Full colour, so the display dithers it. Options: `?preview=1` (simulated panel look), `?dither=1` (pre-dithered to the 6 inks), `?mood=night`, `?art=<Met object ID>`. Credits are in `server/art/CREDITS.md`. |
| `/api/eink-japan.png` | **Modern Japanese prints** (portrait 1200 × 1600). A random shin-hanga print (early-modern Japanese, 1900s–1930s) on every request, never one of the last 6. Artists: Hiroshi Yoshida, Ohara Koson, Takahashi Shōtei and Hashiguchi Goyō, all public domain in the UK and Japan (from Wikimedia Commons). Full-bleed art with a compact band showing solar now (battery % at night) and solar today. Same `?preview=1` and `?dither=1` options. To add your own images, drop them into `server/art-shinhanga/` and add them to its `manifest.json`. |
| `/api/eink-poster.png` | The earlier flat-colour poster design, with a sun, hills and a solar house. `?scene=day` or `?scene=night` previews either look. |

On the Raspberry Pi:

```bash
pip install inky[rpi] pillow requests
python3 eink/show_solar.py --url http://<this-pc-ip>:8787/api/eink.png
```

Then add it to cron to run every 15 minutes:

```
*/15 * * * * /usr/bin/python3 /home/pi/show_solar.py --url http://<this-pc-ip>:8787/api/eink.png
```

Add `--rotate 180` if the panel is mounted upside down. On Windows, allow Node.js through the firewall on port 8787 so the Pi can reach it.

## Run on Unraid (Docker tab)

Every push to `main` makes GitHub Actions ([.github/workflows/docker.yml](.github/workflows/docker.yml)) build the image and publish it as `ghcr.io/david-ortiz/kroniksan_solartracker:latest`.

1. **Let Unraid pull the image.** The repo is private, so its image is private too. Do one of these:
   - On GitHub, open the package and set **Package settings → Change visibility → Public**. The image contains no secrets; your keys are entered on Unraid.
   - Or, in the Unraid terminal, run `docker login ghcr.io` once, with a GitHub token that has the `read:packages` scope.
2. **Add the template.** Copy [unraid/solar-tracker.xml](unraid/solar-tracker.xml) to `/boot/config/plugins/dockerMan/templates-user/my-solar-tracker.xml`, using the `flash` share.
3. **Create the container.** Go to **Docker → Add Container**, pick **solar-tracker** from the Template list, fill in App URL, Client ID and Client Secret, then click **Apply**.
4. **Keep your history and sign-in.** Stop the copy on your PC first. Two copies would fight over SolarEdge's rotating refresh token and double the API credits. Then copy `data/solar.db` (plus any `-wal` and `-shm` files) into `/mnt/user/appdata/solar-tracker/` and restart the container.

**To update,** push to GitHub, wait for the build, then click **Check for Updates → apply update** in the Docker tab.

[docker-compose.yml](docker-compose.yml) is there if you'd rather use the Compose Manager plugin.
