import { configureLogger, fuzzCoord, fuzzIp, log } from "./log";
import { isValidAmenity, searchAmenities } from "./overpass";
import { getRoute } from "./ors";

const SEARCH_CACHE_TTL = 18_000; // 5 hours
const ROUTE_CACHE_TTL = 6_000; // ~100 minutes

interface RateLimiter {
  limit(opts: { key: string }): Promise<{ success: boolean }>;
}

interface Env {
  ORS_API_KEY: string;
  MOJINAV_CONTACT_URL?: string;
  MOJINAV_LOG_LEVEL?: string;
  SEARCH_RL: RateLimiter;
  ROUTE_RL: RateLimiter;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

function errorResponse(status: number, error: string, emoji: string): Response {
  return jsonResponse({ error, emoji }, { status });
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const cfIp = req.headers.get("cf-connecting-ip");
  if (cfIp) return cfIp;
  return "unknown";
}

function parseFloatParam(url: URL, name: string): number | null {
  const v = url.searchParams.get(name);
  if (v === null) return null;
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function handleHealth(): Promise<Response> {
  log.debug("Health check requested");
  return jsonResponse({ status: "ok", service: "mojinav-worker" });
}

async function handleSearch(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const lat = parseFloatParam(url, "lat");
  const lng = parseFloatParam(url, "lng");
  const amenity = url.searchParams.get("amenity");
  const ip = clientIp(req);

  if (lat === null || lng === null || !amenity) {
    return errorResponse(400, "missing_params", "❓");
  }

  log.info(
    `Search request: amenity=${amenity}, lat~${fuzzCoord(lat)}, lng~${fuzzCoord(lng)}, ip=${fuzzIp(ip)}`,
  );

  const rl = await env.SEARCH_RL.limit({ key: ip });
  if (!rl.success) {
    log.warn(`Rate limited: ${fuzzIp(ip)}`);
    return errorResponse(429, "rate_limited", "🐢");
  }

  if (!isValidAmenity(amenity)) {
    log.error(`Invalid amenity type: ${amenity}`);
    return errorResponse(400, "invalid_amenity", "❓");
  }

  // Normalize coords for cache key — 4 decimals (~11m) matches the Python app.
  const cacheUrl = new URL(url);
  cacheUrl.searchParams.set("lat", lat.toFixed(4));
  cacheUrl.searchParams.set("lng", lng.toFixed(4));
  const cacheKeyReq = new Request(cacheUrl.toString(), { method: "GET" });

  const cache = caches.default;
  const cached = await cache.match(cacheKeyReq);
  if (cached) {
    log.info(`Returning cached search results for ${amenity}`);
    return new Response(cached.body, {
      status: cached.status,
      headers: { ...Object.fromEntries(cached.headers), ...CORS_HEADERS },
    });
  }

  const outcome = await searchAmenities(amenity, lat, lng, env.MOJINAV_CONTACT_URL);
  if (outcome.kind === "upstream_error") {
    return errorResponse(502, "upstream_error", "🌐❌");
  }

  const body = {
    amenity,
    count: outcome.results.length,
    results: outcome.results,
  };
  log.info(`Returning ${body.count} results for ${amenity}`);

  const response = jsonResponse(body, {
    headers: { "Cache-Control": `public, max-age=${SEARCH_CACHE_TTL}` },
  });
  ctx.waitUntil(cache.put(cacheKeyReq, response.clone()));
  return response;
}

async function handleRoute(
  req: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const url = new URL(req.url);
  const startLat = parseFloatParam(url, "start_lat");
  const startLng = parseFloatParam(url, "start_lng");
  const endLat = parseFloatParam(url, "end_lat");
  const endLng = parseFloatParam(url, "end_lng");
  const ip = clientIp(req);

  if (startLat === null || startLng === null || endLat === null || endLng === null) {
    return errorResponse(400, "missing_params", "❓");
  }

  log.info(
    `Route request: (~${fuzzCoord(startLat)},~${fuzzCoord(startLng)}) -> (~${fuzzCoord(endLat)},~${fuzzCoord(endLng)}), ip=${fuzzIp(ip)}`,
  );

  const rl = await env.ROUTE_RL.limit({ key: ip });
  if (!rl.success) {
    log.warn(`Rate limited: ${fuzzIp(ip)}`);
    return errorResponse(429, "rate_limited", "🐢");
  }

  if (!env.ORS_API_KEY) {
    log.error("ORS_API_KEY not configured");
    return errorResponse(503, "routing_unavailable", "🔑❌");
  }

  // 5-decimal cache key (~1m) matches the Python app.
  const cacheUrl = new URL(url);
  cacheUrl.searchParams.set("start_lat", startLat.toFixed(5));
  cacheUrl.searchParams.set("start_lng", startLng.toFixed(5));
  cacheUrl.searchParams.set("end_lat", endLat.toFixed(5));
  cacheUrl.searchParams.set("end_lng", endLng.toFixed(5));
  const cacheKeyReq = new Request(cacheUrl.toString(), { method: "GET" });

  const cache = caches.default;
  const cached = await cache.match(cacheKeyReq);
  if (cached) {
    log.info("Returning cached route");
    return new Response(cached.body, {
      status: cached.status,
      headers: { ...Object.fromEntries(cached.headers), ...CORS_HEADERS },
    });
  }

  const outcome = await getRoute(
    startLat,
    startLng,
    endLat,
    endLng,
    env.ORS_API_KEY,
    env.MOJINAV_CONTACT_URL,
  );
  switch (outcome.kind) {
    case "key_invalid":
      return errorResponse(503, "routing_unavailable", "🔑❌");
    case "timeout":
      return errorResponse(504, "timeout", "⏱️");
    case "upstream_error":
      return errorResponse(502, "upstream_error", "🌐❌");
    case "parse_error":
      return errorResponse(502, "parse_error", "🌐❌");
    case "ok": {
      const response = jsonResponse(outcome.route, {
        headers: { "Cache-Control": `public, max-age=${ROUTE_CACHE_TTL}` },
      });
      ctx.waitUntil(cache.put(cacheKeyReq, response.clone()));
      return response;
    }
  }
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    configureLogger(env.MOJINAV_LOG_LEVEL);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const { pathname } = new URL(req.url);

    if (req.method === "GET" && pathname === "/api/health") {
      return handleHealth();
    }
    if (req.method === "GET" && pathname === "/api/search") {
      return handleSearch(req, env, ctx);
    }
    if (req.method === "GET" && pathname === "/api/route") {
      return handleRoute(req, env, ctx);
    }

    return errorResponse(404, "not_found", "❓");
  },
};
