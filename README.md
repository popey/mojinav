# Ⓜ️🍩🌶️📍♑️🔺✌️

> **MojiNav** — emoji-only walking navigation. Tap an emoji, see nearby places, follow the arrows.

Tap **ℹ️** inside the running app for the emoji legend, arrow vocabulary, error states, and attribution.

## 🚀 Quick start

```bash
git clone https://github.com/popey/mojinav
cd mojinav
cp .env.example .env
# Edit .env and add your OpenRouteService key from
# https://openrouteservice.org/dev/#/signup

# Frontend
cd frontend && npm ci && npm run dev    # serves on http://localhost:5173

# Backend (in another terminal)
cd worker && npm install && npx wrangler dev    # serves /api on http://localhost:8787
```

The Vite dev server proxies `/api/*` to `VITE_API_URL` (default `http://localhost:8000`); set `VITE_API_URL=http://localhost:8787` to point it at the Worker.

## 📱 Mobile testing

Geolocation needs HTTPS, so tunnel the dev server:

```bash
ngrok http 5173            # or `tailscale up` and use your Tailscale hostname
```

## 🏗️ Architecture

```
Browser ──▶ Cloudflare ──┬─▶ Frontend (Vite/Pages, /*)
                         └─▶ Worker (mojinav.popey.com/api/*)
                              ├─▶ Overpass (4 mirrors, rotated)
                              ├─▶ OpenRouteService
                              └─▶ Stadia Maps (tiles, fetched directly by browser)
```

Backend is a single Cloudflare Worker (`worker/src/index.ts`, ~250 lines of TypeScript). No origin server, no Docker, no Python.

## 🔧 Development

### Worker

```bash
cd worker
npm install
echo "ORS_API_KEY=your_key_here" > .dev.vars
npx wrangler dev          # http://localhost:8787
npx wrangler deploy       # ships to mojinav.popey.com/api/*
npx wrangler tail         # follow live logs
```

Configuration lives in `worker/wrangler.toml`: `[vars]` for non-secrets, `wrangler secret put ORS_API_KEY` for the API key, and two `[[unsafe.bindings]]` entries for the per-IP rate limiters (30/min search, 60/min route).

### Frontend

```bash
cd frontend
npm ci
npm run dev               # http://localhost:5173
npm run build             # static bundle in dist/
```

## 🔒 Privacy & logging

User coordinates are sent to OpenStreetMap (Overpass) and OpenRouteService — that's how the app finds places and routes. The Worker logs scrub coordinates and client IPs before emitting: log lines round coordinates to ~11 km (1 decimal), mask the trailing octet of IPv4 / the trailing groups of IPv6, and redact numeric components from cache-key log lines (full precision is preserved in the actual edge cache key).

Default log level is `INFO`. Set `MOJINAV_LOG_LEVEL=DEBUG` in `wrangler.toml` `[vars]` to enable the verbose Overpass query body (which embeds raw coordinates) for local debugging only.

## 📍 API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/search?lat=&lng=&amenity=` | Nearby amenities, progressive 500m → 2000m → 5000m radius until 5+ results |
| `GET /api/route?start_lat=&start_lng=&end_lat=&end_lng=` | Walking directions |

## 📄 License

MIT. Originally vibecoded for [Chainguard's Vibelympics](https://github.com/popey/vibelympics/tree/main/round_1), December 2025; that contest entry stays frozen there, this repo is the maintained version.
