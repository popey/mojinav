# Ⓜ️🍩🌶️📍♑️🔺✌️

> **MojiNav** — emoji-only walking navigation. Tap an emoji, see nearby places, follow the arrows.

Tap **ℹ️** inside the running app for the emoji legend, arrow vocabulary, error states, and attribution.

Live at **[mojinav.popey.com](https://mojinav.popey.com)**.

## 🚀 Quick start

```bash
git clone https://github.com/popey/mojinav
cd mojinav
cp .env.example .env
# Get your OpenRouteService key from
# https://openrouteservice.org/dev/#/signup
echo "ORS_API_KEY=your_key_here" > worker/.dev.vars

# Backend (terminal 1)
cd worker && npm install && npx wrangler dev   # http://localhost:8787

# Frontend (terminal 2)
cd frontend && npm ci && npm run dev            # http://localhost:5173
```

The Vite dev server proxies `/api/*` to the Worker on port 8787.

## 📱 Mobile testing

Geolocation needs HTTPS, so tunnel the dev server:

```bash
ngrok http 5173            # or `tailscale up` and use your Tailscale hostname
```

## 🏗️ Architecture

```
Browser ──▶ Cloudflare ──┬─▶ Pages    (mojinav.popey.com/*, static SPA)
                         └─▶ Worker   (mojinav.popey.com/api/*)
                              ├─▶ Overpass (4 mirrors, rotated)
                              ├─▶ OpenRouteService
                              └─▶ Stadia Maps (tiles, fetched directly by browser)
```

Frontend is a Vite-built React SPA on Cloudflare Pages. Backend is a single TypeScript Worker (`worker/src/index.ts`, ~250 lines). No origin server, no Docker, no Python.

## 🚢 Deploy

```bash
# Worker (API)
cd worker && npx wrangler deploy

# Frontend (SPA)
cd frontend && npm run build && npx wrangler pages deploy dist --project-name=mojinav
```

Worker secrets: `npx wrangler secret put ORS_API_KEY`. The Workers Route `mojinav.popey.com/api/*` and the Pages custom domain are both wired up; new pushes ship as preview URLs and (on `main`) production.

## 🔒 Privacy & logging

User coordinates are sent to OpenStreetMap (Overpass) and OpenRouteService — that's how the app finds places and routes. The Worker logs scrub coordinates and client IPs before emitting: log lines round coordinates to ~11 km (1 decimal), mask the trailing octet of IPv4 / the trailing groups of IPv6, and redact numeric components from cache-key log lines (full precision is preserved in the actual edge cache key).

Default log level is `INFO`. Set `MOJINAV_LOG_LEVEL=DEBUG` in `worker/wrangler.toml` `[vars]` to enable the verbose Overpass query body (which embeds raw coordinates) for local debugging only.

## 📍 API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/search?lat=&lng=&amenity=` | Nearby amenities, progressive 500m → 2000m → 5000m radius until 5+ results |
| `GET /api/route?start_lat=&start_lng=&end_lat=&end_lng=` | Walking directions |

## 📄 License

MIT. Originally vibecoded for [Chainguard's Vibelympics](https://github.com/popey/vibelympics/tree/main/round_1), December 2025; that contest entry stays frozen there, this repo is the maintained version.
