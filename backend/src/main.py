"""
MojiNav Backend - Emoji-only navigation API

This FastAPI application provides:
- Health check endpoint
- Search for nearby amenities via OpenStreetMap Overpass API
- Walking directions via OpenRouteService API
- In-memory caching with expiration
- Rate limiting per endpoint
"""

import logging
import os
import re
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Optional
from dataclasses import dataclass, field

import httpx
from fastapi import FastAPI, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# Default to INFO so the verbose Overpass query body (which embeds raw
# coordinates) doesn't end up in production docker logs. Set
# MOJINAV_LOG_LEVEL=DEBUG locally when you need it.
_LOG_LEVEL = os.environ.get("MOJINAV_LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=_LOG_LEVEL,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# =============================================================================
# Privacy helpers
# =============================================================================
#
# Cache keys, upstream API calls, and outbound JSON keep full precision.
# These helpers exist purely to scrub PII from log output (docker logs,
# log aggregators, anything that scrapes stdout/stderr).

def fuzz_coord(value: float) -> str:
    """Round a coordinate to 1 decimal (~11km) for log output."""
    return f"{value:.1f}"

def fuzz_ip(ip: str) -> str:
    """Mask the trailing component of an IP for log output. IPv4 keeps the
    /24, IPv6 keeps the leading two groups; both still allow rough
    geographic / abuse-mitigation reasoning without identifying a user."""
    if "." in ip:
        head, _, tail = ip.rpartition(".")
        if head and tail:
            return f"{head}.x"
    if ":" in ip:
        parts = ip.split(":")
        if len(parts) > 2:
            return ":".join(parts[:2]) + "::x"
    return "x"

def fuzz_cache_key(key: str) -> str:
    """Strip numeric (coordinate) components from a cache key for logging."""
    redacted = []
    for part in key.split(":"):
        try:
            float(part)
            redacted.append("x")
        except ValueError:
            redacted.append(part)
    return ":".join(redacted)


class _AccessLogRedactor(logging.Filter):
    """Scrub coordinate query params from uvicorn access log records.

    Uvicorn formats access lines with the full request line as a %s arg —
    including the query string. We rewrite that arg before formatting so
    GET /search?lat=51.5074&lng=-0.1278&amenity=pub turns into
    GET /search?lat=x&lng=x&amenity=pub in the emitted log line. Cache
    behaviour and upstream calls are unaffected; only the log message
    is redacted."""

    _COORD_PARAM = re.compile(
        r'((?:start_|end_)?l(?:at|ng)=)-?\d+(?:\.\d+)?'
    )

    def filter(self, record: logging.LogRecord) -> bool:
        if record.args:
            record.args = tuple(
                self._COORD_PARAM.sub(r'\1x', arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True

# =============================================================================
# Configuration
# =============================================================================

ORS_API_KEY = os.environ.get("ORS_API_KEY", "")
ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking"

# Overpass mirrors. We rotate the starting mirror per query (see
# query_overpass) so load is spread sub-second across these mirrors,
# but stays deterministic per-second — a single deployment hammering
# the main instance was the failure mode behind the production 502.
OVERPASS_MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.ch/api/interpreter",
    "https://lambert.openstreetmap.de/api/interpreter",
]

# Identifying User-Agent — Overpass returns 406 Not Acceptable to generic
# UAs (httpx default, requests default, etc.) as part of abuse mitigation.
# Self-hosters: set MOJINAV_CONTACT_URL so OSM operators can reach *you*,
# not the upstream project, if your deployment misbehaves.
DEFAULT_CONTACT_URL = "https://github.com/popey/mojinav"
CONTACT_URL = os.environ.get("MOJINAV_CONTACT_URL") or DEFAULT_CONTACT_URL
USER_AGENT = f"MojiNav/0.1.0 (+{CONTACT_URL})"

# Rate limiting configuration (per minute)
SEARCH_RATE_LIMIT = 30  # 30 searches per minute per IP
ROUTE_RATE_LIMIT = 60   # 60 route requests per minute per IP
RATE_WINDOW = 60        # 1 minute window

# Cache configuration — amenities and the road graph rarely change, so
# we cache aggressively to keep upstream load (and 502s) down.
SEARCH_CACHE_TTL = 18000  # 5 hours for search results
ROUTE_CACHE_TTL = 6000    # ~100 minutes for routes

# Amenity to OSM tag mapping
AMENITY_OSM_TAGS = {
    'pub': [('amenity', 'pub')],
    'cafe': [('amenity', 'cafe')],
    'train': [('railway', 'station'), ('public_transport', 'station')],
    'pool': [('leisure', 'swimming_pool'), ('amenity', 'swimming_pool')],
    'gym': [('leisure', 'fitness_centre'), ('amenity', 'gym')],
    'park': [('leisure', 'park')],
    'pizza': [('cuisine', 'pizza'), ('amenity', 'restaurant')],  # Combined query
    'fastfood': [('amenity', 'fast_food')],
    'fuel': [('amenity', 'fuel')],
    'charger': [('amenity', 'charging_station')],
    'pharmacy': [('amenity', 'pharmacy')],
    'atm': [('amenity', 'atm')],
    'supermarket': [('shop', 'supermarket')],
    'toilet': [('amenity', 'toilets')],
    'parking': [('amenity', 'parking')],
    'library': [('amenity', 'library')],
    'cinema': [('amenity', 'cinema')],
}

# Progressive search radii (in meters) - start small, expand if needed
SEARCH_RADII = [500, 2000, 5000]
MIN_RESULTS_BEFORE_EXPAND = 5

# =============================================================================
# Caching
# =============================================================================

@dataclass
class CacheEntry:
    """Cache entry with expiration."""
    data: dict
    expires_at: float

class SimpleCache:
    """Simple in-memory cache with TTL."""

    def __init__(self):
        self._cache: dict[str, CacheEntry] = {}

    def get(self, key: str) -> Optional[dict]:
        """Get cached value if not expired."""
        entry = self._cache.get(key)
        if entry is None:
            logger.debug(f"Cache MISS: {fuzz_cache_key(key)}")
            return None
        if time.time() > entry.expires_at:
            logger.debug(f"Cache EXPIRED: {fuzz_cache_key(key)}")
            del self._cache[key]
            return None
        logger.debug(f"Cache HIT: {fuzz_cache_key(key)}")
        return entry.data

    def set(self, key: str, data: dict, ttl: float):
        """Set cache value with TTL in seconds."""
        self._cache[key] = CacheEntry(data=data, expires_at=time.time() + ttl)
        logger.debug(f"Cache SET: {fuzz_cache_key(key)} (TTL: {ttl}s)")

    def clear_expired(self):
        """Remove expired entries."""
        now = time.time()
        expired = [k for k, v in self._cache.items() if now > v.expires_at]
        for key in expired:
            del self._cache[key]
        if expired:
            logger.debug(f"Cache cleanup: removed {len(expired)} expired entries")

# Global cache instances
search_cache = SimpleCache()
route_cache = SimpleCache()

# =============================================================================
# Rate Limiting
# =============================================================================

@dataclass
class RateLimiter:
    """Per-endpoint rate limiter."""
    limit: int
    window: int = 60
    requests: dict = field(default_factory=lambda: defaultdict(list))

    def check(self, client_ip: str) -> bool:
        """Check if request is allowed. Returns True if allowed."""
        now = time.time()

        # Clean old requests
        self.requests[client_ip] = [
            req_time for req_time in self.requests[client_ip]
            if now - req_time < self.window
        ]

        # Check limit
        if len(self.requests[client_ip]) >= self.limit:
            logger.warning(f"🐢 Rate limit exceeded for {fuzz_ip(client_ip)}")
            return False

        # Record request
        self.requests[client_ip].append(now)
        return True

# Global rate limiters
search_limiter = RateLimiter(limit=SEARCH_RATE_LIMIT)
route_limiter = RateLimiter(limit=ROUTE_RATE_LIMIT)

# =============================================================================
# Polyline Decoder
# =============================================================================

def decode_polyline(polyline: str, is_3d: bool = False) -> list[list[float]]:
    """
    Decode a Google-encoded polyline string into coordinates.

    Args:
        polyline: Encoded polyline string
        is_3d: Whether the polyline includes elevation (3D)

    Returns:
        List of [lng, lat] or [lng, lat, elevation] coordinates
    """
    points = []
    index = 0
    lat = 0
    lng = 0
    elevation = 0

    while index < len(polyline):
        # Decode latitude
        result = 0
        shift = 0
        while True:
            b = ord(polyline[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        lat += (~(result >> 1)) if (result & 1) else (result >> 1)

        # Decode longitude
        result = 0
        shift = 0
        while True:
            b = ord(polyline[index]) - 63
            index += 1
            result |= (b & 0x1f) << shift
            shift += 5
            if b < 0x20:
                break
        lng += (~(result >> 1)) if (result & 1) else (result >> 1)

        # Decode elevation if 3D
        if is_3d:
            result = 0
            shift = 0
            while True:
                b = ord(polyline[index]) - 63
                index += 1
                result |= (b & 0x1f) << shift
                shift += 5
                if b < 0x20:
                    break
            elevation += (~(result >> 1)) if (result & 1) else (result >> 1)
            points.append([lng / 1e5, lat / 1e5, elevation / 100])
        else:
            points.append([lng / 1e5, lat / 1e5])

    return points

# =============================================================================
# FastAPI Application
# =============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown hooks. Replaces deprecated @app.on_event."""
    # Install access-log redactor before any request lands. Uvicorn sets up
    # its own loggers before the lifespan runs, so by this point the access
    # logger exists and we can attach the filter.
    logging.getLogger("uvicorn.access").addFilter(_AccessLogRedactor())
    logger.info("🚀 MojiNav backend starting up...")
    if ORS_API_KEY:
        logger.info("✅ ORS_API_KEY is configured")
    else:
        logger.warning("⚠️ ORS_API_KEY is not set - routing will not work")
    yield

app = FastAPI(
    title="MojiNav API",
    description="Emoji-only navigation backend",
    version="0.1.0",
    lifespan=lifespan,
)

# Configure CORS for frontend communication.
# Note: allow_credentials must stay False while allow_origins=["*"] — browsers
# reject the wildcard + credentials combination. MojiNav doesn't use cookies
# or auth headers from the browser, so credentials aren't needed.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_client_ip(request: Request) -> str:
    """Extract client IP from request, handling proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    logger.debug("Health check requested")
    return {"status": "ok", "service": "mojinav-backend"}

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "MojiNav API - See /docs for API documentation"}

# =============================================================================
# Search Endpoint
# =============================================================================

async def query_overpass(client: httpx.AsyncClient, amenity: str, lat: float, lng: float, radius: int) -> list[dict] | None:
    """Execute a single Overpass query and return parsed elements, or None on error."""
    tags = AMENITY_OSM_TAGS[amenity]

    # Build query parts for each tag
    query_parts = []
    for tag_key, tag_value in tags:
        if amenity == 'pizza':
            # Special case: pizza needs AND condition
            query_parts.append(f'node["amenity"="restaurant"]["cuisine"="pizza"](around:{radius},{lat},{lng});')
            query_parts.append(f'way["amenity"="restaurant"]["cuisine"="pizza"](around:{radius},{lat},{lng});')
            break
        else:
            query_parts.append(f'node["{tag_key}"="{tag_value}"](around:{radius},{lat},{lng});')
            query_parts.append(f'way["{tag_key}"="{tag_value}"](around:{radius},{lat},{lng});')

    overpass_query = f"""
    [out:json][timeout:25];
    (
        {chr(10).join(query_parts)}
    );
    out center;
    """

    logger.debug(f"Overpass query (radius={radius}m):\n{overpass_query}")

    # Rotate the mirror list so requests within the same second hit the
    # same mirror (cache-friendly upstream) but adjacent seconds spread
    # load. Falls through to the next mirror on timeout / HTTP error.
    start_index = int(time.time()) % len(OVERPASS_MIRRORS)
    mirrors = OVERPASS_MIRRORS[start_index:] + OVERPASS_MIRRORS[:start_index]

    for mirror_url in mirrors:
        try:
            response = await client.post(
                mirror_url,
                data={"data": overpass_query},
                timeout=30.0
            )
            response.raise_for_status()
            data = response.json()
            return data.get("elements", [])
        except (httpx.TimeoutException, httpx.HTTPError) as e:
            logger.warning(f"⚠️ Overpass mirror {mirror_url} failed at radius {radius}m: {e}")
            continue

    logger.error(f"❌ All Overpass mirrors failed at radius {radius}m")
    return None


def parse_elements(elements: list[dict], lat: float, lng: float, seen_ids: set[int]) -> list[dict]:
    """Parse Overpass elements into results, deduping by ID."""
    results = []
    for element in elements:
        element_id = element["id"]
        if element_id in seen_ids:
            continue
        seen_ids.add(element_id)

        # Get coordinates (center for ways, direct for nodes)
        if element["type"] == "way":
            el_lat = element.get("center", {}).get("lat")
            el_lng = element.get("center", {}).get("lon")
        else:
            el_lat = element.get("lat")
            el_lng = element.get("lon")

        if el_lat is None or el_lng is None:
            continue

        # Calculate distance for sorting (Euclidean approximation)
        dist = ((el_lat - lat) ** 2 + (el_lng - lng) ** 2) ** 0.5

        results.append({
            "id": element_id,
            "lat": el_lat,
            "lng": el_lng,
            "tags": element.get("tags", {}),
            "distance_sort": dist,
        })
    return results


@app.get("/search")
async def search_amenities(
    request: Request,
    lat: float = Query(..., description="Latitude"),
    lng: float = Query(..., description="Longitude"),
    amenity: str = Query(..., description="Amenity type"),
):
    """
    Search for nearby amenities using OpenStreetMap Overpass API.

    Uses progressive radius expansion: starts with a small radius for fast
    results in dense areas, expands if fewer than 5 results are found.
    Returns up to 10 nearest amenities of the specified type.
    """
    client_ip = get_client_ip(request)
    logger.info(
        f"🔍 Search request: amenity={amenity}, "
        f"lat~{fuzz_coord(lat)}, lng~{fuzz_coord(lng)}, ip={fuzz_ip(client_ip)}"
    )

    # Rate limiting check
    if not search_limiter.check(client_ip):
        logger.warning(f"🐢 Rate limited: {fuzz_ip(client_ip)}")
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limited", "emoji": "🐢"}
        )

    # Validate amenity type
    if amenity not in AMENITY_OSM_TAGS:
        logger.error(f"❌ Invalid amenity type: {amenity}")
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_amenity", "emoji": "❓"}
        )

    # Check cache
    cache_key = f"search:{amenity}:{lat:.4f}:{lng:.4f}"
    cached = search_cache.get(cache_key)
    if cached:
        logger.info(f"📦 Returning cached search results for {amenity}")
        return cached

    # Progressive search with expanding radius
    all_results = []
    seen_ids: set[int] = set()
    last_error = None

    async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
        for radius in SEARCH_RADII:
            logger.info(f"🔍 Searching {amenity} at radius {radius}m...")
            elements = await query_overpass(client, amenity, lat, lng, radius)

            if elements is None:
                last_error = "upstream_error"
                continue

            new_results = parse_elements(elements, lat, lng, seen_ids)
            all_results.extend(new_results)
            logger.info(f"📍 Found {len(new_results)} new results at {radius}m (total: {len(all_results)})")

            # Stop expanding if we have enough results
            if len(all_results) >= MIN_RESULTS_BEFORE_EXPAND:
                logger.info(f"✅ Found {len(all_results)} results, stopping expansion")
                break

    # Handle case where all queries failed
    if not all_results and last_error:
        return JSONResponse(
            status_code=502,
            content={"error": last_error, "emoji": "🌐❌"}
        )

    # Sort by distance and take top 10
    all_results.sort(key=lambda x: x["distance_sort"])
    top_results = all_results[:10]

    # Remove sort key from final results
    for r in top_results:
        del r["distance_sort"]

    result = {
        "amenity": amenity,
        "count": len(top_results),
        "results": top_results,
    }

    # Cache the final results
    search_cache.set(cache_key, result, SEARCH_CACHE_TTL)
    logger.info(f"✅ Returning {len(top_results)} results for {amenity}")

    return result

# =============================================================================
# Route Endpoint
# =============================================================================

@app.get("/route")
async def get_route(
    request: Request,
    start_lat: float = Query(..., description="Start latitude"),
    start_lng: float = Query(..., description="Start longitude"),
    end_lat: float = Query(..., description="End latitude"),
    end_lng: float = Query(..., description="End longitude"),
):
    """
    Get walking directions using OpenRouteService API.

    Returns route geometry and turn-by-turn instructions.
    """
    client_ip = get_client_ip(request)
    logger.info(
        f"🧭 Route request: "
        f"(~{fuzz_coord(start_lat)},~{fuzz_coord(start_lng)}) -> "
        f"(~{fuzz_coord(end_lat)},~{fuzz_coord(end_lng)}), "
        f"ip={fuzz_ip(client_ip)}"
    )

    # Rate limiting check
    if not route_limiter.check(client_ip):
        logger.warning(f"🐢 Rate limited: {fuzz_ip(client_ip)}")
        return JSONResponse(
            status_code=429,
            content={"error": "rate_limited", "emoji": "🐢"}
        )

    # Check if ORS API key is configured
    if not ORS_API_KEY:
        logger.error("❌ ORS_API_KEY not configured")
        return JSONResponse(
            status_code=503,
            content={"error": "routing_unavailable", "emoji": "🔑❌"}
        )

    # Check cache
    cache_key = f"route:{start_lat:.5f}:{start_lng:.5f}:{end_lat:.5f}:{end_lng:.5f}"
    cached = route_cache.get(cache_key)
    if cached:
        logger.info("📦 Returning cached route")
        return cached

    # Request route from ORS
    headers = {
        "Authorization": ORS_API_KEY,
        "Content-Type": "application/json",
    }

    payload = {
        "coordinates": [[start_lng, start_lat], [end_lng, end_lat]],
        "instructions": True,
        "language": "en",
    }

    try:
        async with httpx.AsyncClient(headers={"User-Agent": USER_AGENT}) as client:
            response = await client.post(
                ORS_DIRECTIONS_URL,
                headers=headers,
                json=payload,
                timeout=30.0
            )

            if response.status_code == 403:
                logger.error("❌ ORS API key invalid or expired")
                return JSONResponse(
                    status_code=503,
                    content={"error": "routing_unavailable", "emoji": "🔑❌"}
                )

            response.raise_for_status()
            data = response.json()
    except httpx.TimeoutException:
        logger.error("⏱️ ORS API timeout")
        return JSONResponse(
            status_code=504,
            content={"error": "timeout", "emoji": "⏱️"}
        )
    except httpx.HTTPError as e:
        logger.error(f"❌ ORS API error: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": "upstream_error", "emoji": "🌐❌"}
        )

    # Parse response
    try:
        route = data["routes"][0]
        geometry_encoded = route["geometry"]
        summary = route["summary"]
        segments = route.get("segments", [])

        # Decode polyline geometry
        coordinates = decode_polyline(geometry_encoded)

        # Extract steps with turn instructions
        steps = []
        for segment in segments:
            for step in segment.get("steps", []):
                steps.append({
                    "instruction": step.get("instruction", ""),
                    "type": step.get("type"),  # Maneuver type (0-13)
                    "distance": step.get("distance", 0),  # meters
                    "duration": step.get("duration", 0),  # seconds
                    "way_points": step.get("way_points", []),  # Indices into coordinates
                })

        result = {
            "distance": summary.get("distance", 0),  # Total distance in meters
            "duration": summary.get("duration", 0),  # Total duration in seconds
            "coordinates": coordinates,  # Decoded polyline [[lng, lat], ...]
            "steps": steps,
        }

        # Cache route
        route_cache.set(cache_key, result, ROUTE_CACHE_TTL)
        logger.info(f"✅ Route calculated: {result['distance']:.0f}m, {len(steps)} steps")

        return result

    except (KeyError, IndexError) as e:
        logger.error(f"❌ Failed to parse ORS response: {e}")
        return JSONResponse(
            status_code=502,
            content={"error": "parse_error", "emoji": "🌐❌"}
        )
