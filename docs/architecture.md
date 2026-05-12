# MojiNav architecture

Living document. Closes out backlog item 2a (architecture sketch).

## Target topology

```
Browser ──▶ Cloudflare ──┬─▶ Pages (frontend bundle)            [post-2b]
                         └─▶ Worker on route /api/*             [post-2c]
                              ├─▶ Overpass (4 mirrors, rotated)
                              └─▶ OpenRouteService
```

No origin server. No Python. No Docker.

## Current topology (2026-05-06, post-2b)

```
Browser ──▶ Cloudflare ──┬─▶ Pages    (mojinav.popey.com/*, static SPA)
                         └─▶ Worker   (mojinav.popey.com/api/*)
                              ├─▶ Overpass
                              └─▶ ORS
```

Deploy: `cd worker && npx wrangler deploy` for the API; `cd frontend && npm run build && npx wrangler pages deploy dist --project-name=mojinav` for the SPA. Hetzner box retired.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Backend runtime | **TypeScript Worker** | alan ruled out Python (2026-05-05). Worker is the simplest Cloudflare-native runtime for this size of app. |
| Cache | **`caches.default`** (edge HTTP cache) | Workers are stateless across invocations; the in-process Python `SimpleCache` doesn't translate. Edge cache is per-PoP but that's fine for amenities/routes. |
| Rate limiting | **Workers Rate Limiting binding** | Replaces the in-process Python dict (broken under any scale-out). Native, free on dev tier. `[[unsafe.bindings]]` in `wrangler.toml`, `env.RL.limit({key})` in code. Two namespaces: `SEARCH_RL` (30/min) and `ROUTE_RL` (60/min), keyed on client IP. |
| Secrets | `wrangler secret put ORS_API_KEY` | Standard. |
| Env vars | `MOJINAV_CONTACT_URL`, `MOJINAV_LOG_LEVEL` in `wrangler.toml` `[vars]` | Same names as Python so behaviour is grep-equivalent. |
| Logging | `console.log` with privacy-aware fuzzing helpers ported from Python | `wrangler tail` + Logpush. Drop the uvicorn-access-log filter (not applicable). |

## Behaviour preserved port-for-port

- 3 endpoints: `GET /api/health`, `GET /api/search`, `GET /api/route`. *(`GET /api/` root endpoint dropped — frontend never calls it.)*
  *(Note: FastAPI mounts these at `/health` etc. and Vite strips `/api`. Worker mounts at `mojinav.popey.com/api/*` so it sees the prefixed paths directly — handlers match on the full `/api/...` path.)*
- 16-amenity OSM tag map (incl. pizza special-case AND of `amenity=restaurant` + `cuisine=pizza`).
- Progressive search radii: 500 → 2000 → 5000 m, stop at ≥5 results.
- Overpass mirror rotation: `floor(unix_seconds) % 4` start index, fall through on timeout / non-2xx.
- Identifying `User-Agent: MojiNav/0.1.0 (+CONTACT_URL)` on every upstream call.
- Cache TTLs: 18000 s search, 6000 s route.
- Rate limits: 30/min search, 60/min route, per IP.
- Polyline decoder (Google encoded format, 2D only — ORS foot-walking returns 2D, dropped the 3D branch).
- Response shapes (search): `{amenity, count, results: [{id, lat, lng, tags}]}`.
- Response shapes (route): `{distance, duration, coordinates: [[lng,lat]...], steps: [{instruction, type, distance, duration, way_points}]}`.
- Error envelope: `{"error": "...", "emoji": "..."}` with the same status codes.
- CORS: `*` no-credentials.
- Privacy: coordinates fuzzed to 1 decimal in logs; IPs masked; cache keys redacted in log lines (full precision in actual cache key).

## File layout (target)

```
worker/
├── src/
│   ├── index.ts        Router + endpoint handlers
│   ├── overpass.ts     Mirror rotation, query builder, parsing
│   ├── ors.ts          ORS request, response parsing
│   ├── polyline.ts     Polyline decoder
│   └── log.ts          fuzz_coord, fuzz_ip, fuzz_cache_key
├── wrangler.toml
├── package.json
└── tsconfig.json
```

`backend/` is removed in the cutover commit (see below).

## Cutover sequence (2c)

0. `wrangler login` if not already authed on this machine. The Worker doesn't exist yet — first `deploy` creates it.
1. Build + `wrangler deploy` to `mojinav.popey.workers.dev` (no production traffic).
2. Manual `curl` smoke tests against the workers.dev URL: search (valid amenity, invalid amenity, rate-limit), route (valid, invalid coords, missing key path), health.
3. Add Workers Route `mojinav.popey.com/api/*` → this Worker. Cloudflare intercepts before traffic reaches alan's box.
4. Watch logs (`wrangler tail` + the existing Vite dev frontend) for some bake period.
5. `docker compose stop backend` on alan's box. Frontend container keeps serving until 2b lands.
6. Follow-up commit: delete `backend/`, remove the backend service from `docker-compose.yml`.

## Open questions (closed 2026-05-05)

1. **Rate limiting:** Workers Rate Limiting binding. ✅
2. **Drop list:** drop the `/` root endpoint; drop the 3D branch of the polyline decoder. ✅
3. **Deploy ownership:** alan runs wrangler. Wrangler login may be needed (first time on this account/box) and the Worker doesn't exist on Cloudflare yet — `wrangler deploy` auto-creates it. Workers Route mojinav.popey.com/api/* still goes through the dashboard. ✅

## Cross-references

- Backlog: `backlog.md` (gitignored, alan's local copy only).
- Public repo: `popey/mojinav`.
