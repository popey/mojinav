import { decodePolyline } from "./polyline";
import { log, userAgent } from "./log";

const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/foot-walking";
const ORS_TIMEOUT_MS = 30_000;

export interface RouteStep {
  instruction: string;
  type: number | undefined;
  distance: number;
  duration: number;
  way_points: number[];
}

export interface RouteResult {
  distance: number;
  duration: number;
  coordinates: number[][];
  steps: RouteStep[];
}

export type RouteOutcome =
  | { kind: "ok"; route: RouteResult }
  | { kind: "key_invalid" }
  | { kind: "timeout" }
  | { kind: "upstream_error" }
  | { kind: "parse_error" };

interface ORSResponse {
  routes?: Array<{
    geometry: string;
    summary: { distance?: number; duration?: number };
    segments?: Array<{
      steps?: Array<{
        instruction?: string;
        type?: number;
        distance?: number;
        duration?: number;
        way_points?: number[];
      }>;
    }>;
  }>;
}

export async function getRoute(
  startLat: number,
  startLng: number,
  endLat: number,
  endLng: number,
  apiKey: string,
  contactUrl: string | undefined,
): Promise<RouteOutcome> {
  const payload = {
    coordinates: [
      [startLng, startLat],
      [endLng, endLat],
    ],
    instructions: true,
    language: "en",
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORS_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ORS_DIRECTIONS_URL, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
        "User-Agent": userAgent(contactUrl),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if ((e as Error).name === "AbortError") {
      log.error("ORS API timeout");
      return { kind: "timeout" };
    }
    log.error(`ORS API error: ${(e as Error).message}`);
    return { kind: "upstream_error" };
  }
  clearTimeout(timer);

  if (response.status === 403) {
    log.error("ORS API key invalid or expired");
    return { kind: "key_invalid" };
  }
  if (!response.ok) {
    log.error(`ORS API error: HTTP ${response.status}`);
    return { kind: "upstream_error" };
  }

  let data: ORSResponse;
  try {
    data = (await response.json()) as ORSResponse;
  } catch (e) {
    log.error(`Failed to parse ORS response: ${(e as Error).message}`);
    return { kind: "parse_error" };
  }

  try {
    const route = data.routes?.[0];
    if (!route) return { kind: "parse_error" };

    const coordinates = decodePolyline(route.geometry);
    const steps: RouteStep[] = [];
    for (const segment of route.segments ?? []) {
      for (const step of segment.steps ?? []) {
        steps.push({
          instruction: step.instruction ?? "",
          type: step.type,
          distance: step.distance ?? 0,
          duration: step.duration ?? 0,
          way_points: step.way_points ?? [],
        });
      }
    }

    const result: RouteResult = {
      distance: route.summary.distance ?? 0,
      duration: route.summary.duration ?? 0,
      coordinates,
      steps,
    };
    log.info(`Route calculated: ${Math.round(result.distance)}m, ${steps.length} steps`);
    return { kind: "ok", route: result };
  } catch (e) {
    log.error(`Failed to parse ORS response: ${(e as Error).message}`);
    return { kind: "parse_error" };
  }
}
