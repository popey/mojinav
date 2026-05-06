// Privacy helpers — coordinates, IPs, and cache keys keep full precision
// in actual cache keys and upstream API calls. These exist purely to scrub
// PII out of `console.log` output (visible via `wrangler tail` and Logpush).

export function fuzzCoord(value: number): string {
  return value.toFixed(1);
}

export function fuzzIp(ip: string): string {
  if (ip.includes(".")) {
    const lastDot = ip.lastIndexOf(".");
    if (lastDot > 0 && lastDot < ip.length - 1) {
      return ip.slice(0, lastDot) + ".x";
    }
  }
  if (ip.includes(":")) {
    const parts = ip.split(":");
    if (parts.length > 2) {
      return parts.slice(0, 2).join(":") + "::x";
    }
  }
  return "x";
}

export function fuzzCacheKey(key: string): string {
  return key
    .split(":")
    .map((part) => (Number.isFinite(Number(part)) && part.trim() !== "" ? "x" : part))
    .join(":");
}

type Level = "DEBUG" | "INFO" | "WARNING" | "ERROR";
const LEVEL_ORDER: Record<Level, number> = { DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40 };

let configuredLevel: Level = "INFO";

export function configureLogger(envLevel: string | undefined): void {
  const upper = (envLevel ?? "INFO").toUpperCase();
  if (upper === "DEBUG" || upper === "INFO" || upper === "WARNING" || upper === "ERROR") {
    configuredLevel = upper;
  } else {
    configuredLevel = "INFO";
  }
}

function shouldEmit(level: Level): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel];
}

const DEFAULT_CONTACT_URL = "https://github.com/popey/mojinav";

export function userAgent(contactUrl: string | undefined): string {
  return `MojiNav/0.1.0 (+${contactUrl || DEFAULT_CONTACT_URL})`;
}

export const log = {
  debug: (msg: string) => {
    if (shouldEmit("DEBUG")) console.log(`DEBUG: ${msg}`);
  },
  info: (msg: string) => {
    if (shouldEmit("INFO")) console.log(`INFO: ${msg}`);
  },
  warn: (msg: string) => {
    if (shouldEmit("WARNING")) console.warn(`WARNING: ${msg}`);
  },
  error: (msg: string) => {
    if (shouldEmit("ERROR")) console.error(`ERROR: ${msg}`);
  },
};
