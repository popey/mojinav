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
docker compose up
# Open http://localhost:5173
```

## 📱 Mobile testing

Geolocation needs HTTPS, so tunnel the dev server:

```bash
ngrok http 5173            # or `tailscale up` and use your Tailscale hostname
```

## 🏗️ Architecture

```
Frontend (React/Vite, :5173)  ──▶  Backend (FastAPI, :8000)
                                        │
                                        ├─▶ Overpass         (place search)
                                        ├─▶ OpenRouteService (walking routes)
                                        └─▶ Stadia Maps      (map tiles)
```

Two containers on [Chainguard](https://www.chainguard.dev/) base images.

## 🔧 Development

### With Docker

```bash
docker compose up                                            # full stack
docker compose logs -f                                       # tail logs
docker compose build backend && docker compose up -d backend # after backend change
```

Frontend hot-reloads via Vite. Backend changes need a rebuild (volume mounts are intentionally commented out in `docker-compose.yml`).

### Without Docker

If you have `uv` and `npm` you can run the two halves directly.

```bash
# Backend (terminal 1) — needs Python 3.11+
cd backend
uv sync                                          # creates .venv from uv.lock
ORS_API_KEY=your_key_here \
MOJINAV_CONTACT_URL=https://your-domain.example/ \
  .venv/bin/python -m uvicorn src.main:app --reload --port 8000

# Frontend (terminal 2)
cd frontend
npm ci
npm run dev
```

The Vite dev server proxies `/api/*` to `VITE_API_URL` (defaults to `http://localhost:8000`).

## 🔒 Privacy & logging

User coordinates are sent to OpenStreetMap (Overpass) and OpenRouteService — that's how the app finds places and routes. MojiNav's own backend logs scrub coordinates and client IPs before emitting anything: app log lines round coordinates to ~11 km, mask the last octet of each IP, and a custom uvicorn-access filter rewrites `?lat=…&lng=…` query params to `?lat=x&lng=x` before the request line is written.

Default log level is `INFO`. Set `MOJINAV_LOG_LEVEL=DEBUG` to enable the verbose Overpass query body (which embeds raw coordinates) for local debugging only.

## 📍 API

| Endpoint | Description |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/search?lat=&lng=&amenity=` | Nearby amenities, progressive 500m → 2000m → 5000m radius until 5+ results |
| `GET /api/route?start_lat=&start_lng=&end_lat=&end_lng=` | Walking directions |

## 📄 License

MIT. Originally vibecoded for [Chainguard's Vibelympics](https://github.com/popey/vibelympics/tree/main/round_1), December 2025; that contest entry stays frozen there, this repo is the maintained version.
