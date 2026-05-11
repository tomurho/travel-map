import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { CoordinateConfidence, CoordinatePrecision } from "@/lib/place";

export type FreeGeocodingCounters = {
  blockedByLiveDisabled: number;
  blockedByMaxLiveCalls: number;
  cacheHits: number;
  cacheMisses: number;
  freeGeocodingCalls: number;
};

export type FreeGeocodeCandidate = {
  address: string;
  confidence: CoordinateConfidence;
  latitude: number;
  longitude: number;
  precision: CoordinatePrecision;
  provider: "osm";
};

type FreeGeocodeCache = {
  osm: Record<string, FreeGeocodeCandidate[]>;
};

const DEFAULT_CACHE_PATH = join(process.cwd(), ".cache/free-geocoding-cache.json");

function normalizeKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function readCache(cachePath = DEFAULT_CACHE_PATH): FreeGeocodeCache {
  if (!existsSync(cachePath)) {
    return { osm: {} };
  }

  return {
    osm: {},
    ...(JSON.parse(readFileSync(cachePath, "utf8")) as Partial<FreeGeocodeCache>),
  };
}

function writeCache(cache: FreeGeocodeCache, cachePath = DEFAULT_CACHE_PATH) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

export class FreeGeocodingAccess {
  readonly counters: FreeGeocodingCounters = {
    blockedByLiveDisabled: 0,
    blockedByMaxLiveCalls: 0,
    cacheHits: 0,
    cacheMisses: 0,
    freeGeocodingCalls: 0,
  };

  private readonly cachePath: string;
  private readonly liveEnabled: boolean;
  private readonly maxLiveCalls: number;
  private readonly minIntervalMs: number;
  private cache: FreeGeocodeCache;
  private lastLiveCallAt = 0;

  constructor({
    cachePath = DEFAULT_CACHE_PATH,
    liveEnabled = false,
    maxLiveCalls = 25,
    minIntervalMs = 1100,
  }: {
    cachePath?: string;
    liveEnabled?: boolean;
    maxLiveCalls?: number;
    minIntervalMs?: number;
  } = {}) {
    this.cachePath = cachePath;
    this.liveEnabled = liveEnabled;
    this.maxLiveCalls = maxLiveCalls;
    this.minIntervalMs = minIntervalMs;
    this.cache = readCache(cachePath);
  }

  getCachedOsmCandidates(query: string) {
    const cached = this.cache.osm[normalizeKey(query)];

    if (cached) {
      this.counters.cacheHits += 1;
      return cached;
    }

    this.counters.cacheMisses += 1;
    return null;
  }

  async searchOsm(query: string, fetcher: typeof fetch = fetch) {
    const key = normalizeKey(query);
    const cached = this.cache.osm[key];

    if (cached) {
      this.counters.cacheHits += 1;
      return cached;
    }

    this.counters.cacheMisses += 1;

    if (!this.liveEnabled) {
      this.counters.blockedByLiveDisabled += 1;
      return null;
    }

    if (this.counters.freeGeocodingCalls + 1 > this.maxLiveCalls) {
      this.counters.blockedByMaxLiveCalls += 1;
      return null;
    }

    const elapsedMs = Date.now() - this.lastLiveCallAt;
    if (elapsedMs < this.minIntervalMs) {
      await new Promise((resolve) => setTimeout(resolve, this.minIntervalMs - elapsedMs));
    }
    this.lastLiveCallAt = Date.now();

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", "3");
    url.searchParams.set("q", query);

    this.counters.freeGeocodingCalls += 1;
    const response = await fetcher(url, {
      headers: {
        "User-Agent": "travel-map-admin/1.0 (local coordinate QA)",
      },
    });

    if (!response.ok) {
      return null;
    }

    const results = (await response.json()) as Array<{
      display_name?: string;
      importance?: number;
      lat?: string;
      lon?: string;
      type?: string;
    }>;
    const candidates = results
      .map((result): FreeGeocodeCandidate | null => {
        const latitude = Number(result.lat);
        const longitude = Number(result.lon);

        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          return null;
        }

        return {
          address: result.display_name ?? query,
          confidence:
            typeof result.importance === "number" && result.importance >= 0.5
              ? "medium"
              : "low",
          latitude,
          longitude,
          precision: result.type === "yes" ? "address_geocode" : "approximate",
          provider: "osm",
        };
      })
      .filter((candidate): candidate is FreeGeocodeCandidate => candidate !== null);

    this.cache.osm[key] = candidates;
    writeCache(this.cache, this.cachePath);

    return candidates;
  }
}
