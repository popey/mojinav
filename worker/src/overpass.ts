import { log, userAgent } from "./log";

// 16-amenity OSM tag map. Pizza is a special case (AND of two tags) and is
// handled directly in buildQuery rather than via the generic tag list.
export const AMENITY_OSM_TAGS: Record<string, [string, string][]> = {
  pub: [["amenity", "pub"]],
  cafe: [["amenity", "cafe"]],
  train: [["railway", "station"], ["public_transport", "station"]],
  pool: [["leisure", "swimming_pool"], ["amenity", "swimming_pool"]],
  gym: [["leisure", "fitness_centre"], ["amenity", "gym"]],
  park: [["leisure", "park"]],
  pizza: [["cuisine", "pizza"], ["amenity", "restaurant"]], // special-cased below
  fastfood: [["amenity", "fast_food"]],
  fuel: [["amenity", "fuel"]],
  charger: [["amenity", "charging_station"]],
  pharmacy: [["amenity", "pharmacy"]],
  atm: [["amenity", "atm"]],
  supermarket: [["shop", "supermarket"]],
  toilet: [["amenity", "toilets"]],
  parking: [["amenity", "parking"]],
  library: [["amenity", "library"]],
  cinema: [["amenity", "cinema"]],
};

export function isValidAmenity(amenity: string): boolean {
  return Object.prototype.hasOwnProperty.call(AMENITY_OSM_TAGS, amenity);
}

const OVERPASS_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.osm.ch/api/interpreter",
  "https://lambert.openstreetmap.de/api/interpreter",
];

export const SEARCH_RADII = [500, 2000, 5000];
export const MIN_RESULTS_BEFORE_EXPAND = 5;

export interface SearchResult {
  id: number;
  lat: number;
  lng: number;
  tags: Record<string, string>;
}

interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

function buildQuery(amenity: string, lat: number, lng: number, radius: number): string {
  const parts: string[] = [];
  if (amenity === "pizza") {
    parts.push(`node["amenity"="restaurant"]["cuisine"="pizza"](around:${radius},${lat},${lng});`);
    parts.push(`way["amenity"="restaurant"]["cuisine"="pizza"](around:${radius},${lat},${lng});`);
  } else {
    for (const [k, v] of AMENITY_OSM_TAGS[amenity]) {
      parts.push(`node["${k}"="${v}"](around:${radius},${lat},${lng});`);
      parts.push(`way["${k}"="${v}"](around:${radius},${lat},${lng});`);
    }
  }
  return `[out:json][timeout:25];\n(\n  ${parts.join("\n  ")}\n);\nout center;`;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function queryOverpass(
  amenity: string,
  lat: number,
  lng: number,
  radius: number,
  ua: string,
): Promise<OverpassElement[] | null> {
  const query = buildQuery(amenity, lat, lng, radius);
  log.debug(`Overpass query (radius=${radius}m):\n${query}`);

  // Rotate the mirror list so requests within the same second hit the
  // same mirror (cache-friendly upstream) but adjacent seconds spread load.
  const startIndex = Math.floor(Date.now() / 1000) % OVERPASS_MIRRORS.length;
  const mirrors = [
    ...OVERPASS_MIRRORS.slice(startIndex),
    ...OVERPASS_MIRRORS.slice(0, startIndex),
  ];

  for (const mirrorUrl of mirrors) {
    try {
      const body = new URLSearchParams({ data: query });
      const response = await fetchWithTimeout(
        mirrorUrl,
        {
          method: "POST",
          headers: {
            "User-Agent": ua,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body,
        },
        30_000,
      );
      if (!response.ok) {
        log.warn(`Overpass mirror ${mirrorUrl} returned ${response.status} at radius ${radius}m`);
        continue;
      }
      const data = (await response.json()) as { elements?: OverpassElement[] };
      return data.elements ?? [];
    } catch (e) {
      log.warn(`Overpass mirror ${mirrorUrl} failed at radius ${radius}m: ${(e as Error).message}`);
      continue;
    }
  }

  log.error(`All Overpass mirrors failed at radius ${radius}m`);
  return null;
}

interface RankedResult extends SearchResult {
  distanceSort: number;
}

function parseElements(
  elements: OverpassElement[],
  lat: number,
  lng: number,
  seenIds: Set<number>,
): RankedResult[] {
  const results: RankedResult[] = [];
  for (const el of elements) {
    if (seenIds.has(el.id)) continue;
    seenIds.add(el.id);

    const elLat = el.type === "way" ? el.center?.lat : el.lat;
    const elLng = el.type === "way" ? el.center?.lon : el.lon;
    if (elLat === undefined || elLng === undefined) continue;

    const dLat = elLat - lat;
    const dLng = elLng - lng;
    results.push({
      id: el.id,
      lat: elLat,
      lng: elLng,
      tags: el.tags ?? {},
      distanceSort: Math.sqrt(dLat * dLat + dLng * dLng),
    });
  }
  return results;
}

export type SearchOutcome =
  | { kind: "ok"; results: SearchResult[] }
  | { kind: "upstream_error" };

export async function searchAmenities(
  amenity: string,
  lat: number,
  lng: number,
  contactUrl: string | undefined,
): Promise<SearchOutcome> {
  const ua = userAgent(contactUrl);
  const all: RankedResult[] = [];
  const seenIds = new Set<number>();
  let lastError = false;

  for (const radius of SEARCH_RADII) {
    log.info(`Searching ${amenity} at radius ${radius}m...`);
    const elements = await queryOverpass(amenity, lat, lng, radius, ua);
    if (elements === null) {
      lastError = true;
      continue;
    }
    const newResults = parseElements(elements, lat, lng, seenIds);
    all.push(...newResults);
    log.info(`Found ${newResults.length} new results at ${radius}m (total: ${all.length})`);

    if (all.length >= MIN_RESULTS_BEFORE_EXPAND) {
      log.info(`Found ${all.length} results, stopping expansion`);
      break;
    }
  }

  if (all.length === 0 && lastError) {
    return { kind: "upstream_error" };
  }

  all.sort((a, b) => a.distanceSort - b.distanceSort);
  const top = all.slice(0, 10).map(({ distanceSort: _d, ...rest }) => rest);
  return { kind: "ok", results: top };
}
