import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type GooglePlacesCounters = {
  blockedByLiveDisabled: number;
  blockedByMaxApiCalls: number;
  blockedByMissingConfirm: number;
  cacheHits: number;
  cacheMisses: number;
  placeDetailsCalls: number;
  textSearchCalls: number;
  urlExpansionAttempts: number;
};

export type GooglePlacesAccessOptions = {
  cacheOnly?: boolean;
  cachePath?: string;
  confirmLiveApi?: boolean;
  liveEnabled?: boolean;
  maxApiCalls?: number | null;
};

type GooglePlacesCache = {
  placeDetails: Record<string, unknown>;
  textSearch: Record<string, unknown>;
  urlExpansions: Record<string, string>;
  urlPlaceIds: Record<string, string>;
};

type LiveCallType = "placeDetails" | "textSearch" | "urlExpansion";

const DEFAULT_CACHE_PATH = join(process.cwd(), ".cache/google-places-cache.json");

export class GooglePlacesLiveCallBlockedError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export function createEmptyGooglePlacesCounters(): GooglePlacesCounters {
  return {
    blockedByLiveDisabled: 0,
    blockedByMaxApiCalls: 0,
    blockedByMissingConfirm: 0,
    cacheHits: 0,
    cacheMisses: 0,
    placeDetailsCalls: 0,
    textSearchCalls: 0,
    urlExpansionAttempts: 0,
  };
}

function createEmptyCache(): GooglePlacesCache {
  return {
    placeDetails: {},
    textSearch: {},
    urlExpansions: {},
    urlPlaceIds: {},
  };
}

function normalizeCacheKey(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function getPlaceDetailsCacheKey(placeId: string, fieldMask: string) {
  return normalizeCacheKey(`${placeId}::${fieldMask}`);
}

export function getTextSearchCacheKey(input: {
  city: string;
  fieldMask: string;
  query: string;
  regionCode?: string;
}) {
  return normalizeCacheKey(
    `${input.query}::${input.city}::${input.regionCode ?? ""}::${input.fieldMask}`,
  );
}

export function assertNarrowFieldMask(fieldMask: string) {
  if (fieldMask.split(",").some((field) => field.trim() === "*")) {
    throw new Error("Wildcard Google Places field masks are not allowed.");
  }
}

export function assertBroadLiveRunAllowed(input: {
  confirmLiveApi: boolean;
  force: boolean;
  maxApiCalls: number | null;
  rowCount: number;
}) {
  if (!input.confirmLiveApi) {
    return;
  }

  if (input.maxApiCalls === null) {
    throw new GooglePlacesLiveCallBlockedError(
      "Live Google Places calls require --max-api-calls.",
    );
  }

  if (input.rowCount > 25 && !input.force) {
    throw new GooglePlacesLiveCallBlockedError(
      "Broad live Google Places runs over 25 rows require --force.",
    );
  }
}

export function readGooglePlacesCache(
  cachePath = DEFAULT_CACHE_PATH,
): GooglePlacesCache {
  if (!existsSync(cachePath)) {
    return createEmptyCache();
  }

  return {
    ...createEmptyCache(),
    ...(JSON.parse(readFileSync(cachePath, "utf8")) as Partial<GooglePlacesCache>),
  };
}

export function writeGooglePlacesCache(
  cache: GooglePlacesCache,
  cachePath = DEFAULT_CACHE_PATH,
) {
  mkdirSync(dirname(cachePath), { recursive: true });
  writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
}

export class GooglePlacesAccess {
  readonly counters = createEmptyGooglePlacesCounters();

  private cache: GooglePlacesCache;
  private liveCallCount = 0;
  private readonly cachePath: string;
  private readonly cacheOnly: boolean;
  private readonly confirmLiveApi: boolean;
  private readonly liveEnabled: boolean;
  private readonly maxApiCalls: number | null;

  constructor(options: GooglePlacesAccessOptions = {}) {
    this.cachePath = options.cachePath ?? DEFAULT_CACHE_PATH;
    this.cache = readGooglePlacesCache(this.cachePath);
    this.cacheOnly = options.cacheOnly ?? false;
    this.confirmLiveApi = options.confirmLiveApi ?? false;
    this.liveEnabled = options.liveEnabled ?? false;
    this.maxApiCalls = options.maxApiCalls ?? null;
  }

  getLiveCallCount() {
    return this.liveCallCount;
  }

  getUrlExpansion(url: string) {
    const cached = this.cache.urlExpansions[url];

    if (cached) {
      this.counters.cacheHits += 1;
      return cached;
    }

    this.counters.cacheMisses += 1;
    return null;
  }

  setUrlExpansion(url: string, expandedUrl: string) {
    this.cache.urlExpansions[url] = expandedUrl;
    this.persist();
  }

  getUrlPlaceId(url: string) {
    const cached = this.cache.urlPlaceIds[url];

    if (cached) {
      this.counters.cacheHits += 1;
      return cached;
    }

    this.counters.cacheMisses += 1;
    return null;
  }

  setUrlPlaceId(url: string, placeId: string) {
    this.cache.urlPlaceIds[url] = placeId;
    this.persist();
  }

  async fetchJson<TResponse>(
    cacheBucket: "placeDetails" | "textSearch",
    cacheKey: string,
    callType: Exclude<LiveCallType, "urlExpansion">,
    fetcher: () => Promise<TResponse>,
  ) {
    const cached = this.cache[cacheBucket][cacheKey];

    if (cached !== undefined) {
      this.counters.cacheHits += 1;
      return cached as TResponse;
    }

    this.counters.cacheMisses += 1;
    this.assertLiveCallAllowed();
    this.liveCallCount += 1;

    if (callType === "placeDetails") {
      this.counters.placeDetailsCalls += 1;
    } else {
      this.counters.textSearchCalls += 1;
    }

    const response = await fetcher();
    this.cache[cacheBucket][cacheKey] = response;
    this.persist();

    return response;
  }

  async expandUrl(url: string, fetcher: () => Promise<string>) {
    const cached = this.getUrlExpansion(url);

    if (cached) {
      return cached;
    }

    this.assertLiveCallAllowed();
    this.liveCallCount += 1;
    this.counters.urlExpansionAttempts += 1;
    const expandedUrl = await fetcher();
    this.setUrlExpansion(url, expandedUrl);

    return expandedUrl;
  }

  private assertLiveCallAllowed() {
    if (!this.liveEnabled) {
      this.counters.blockedByLiveDisabled += 1;
      throw new GooglePlacesLiveCallBlockedError(
        "Live Google Places calls are disabled. Use cached data or set GOOGLE_PLACES_LIVE_ENABLED=true.",
      );
    }

    if (this.cacheOnly || !this.confirmLiveApi) {
      this.counters.blockedByMissingConfirm += 1;
      throw new GooglePlacesLiveCallBlockedError(
        "Live Google Places calls require --confirm-live-api and --max-api-calls. Use --cache-only for zero-call runs.",
      );
    }

    if (this.maxApiCalls === null) {
      this.counters.blockedByMissingConfirm += 1;
      throw new GooglePlacesLiveCallBlockedError(
        "Live Google Places calls require --max-api-calls.",
      );
    }

    if (this.liveCallCount + 1 > this.maxApiCalls) {
      this.counters.blockedByMaxApiCalls += 1;
      throw new GooglePlacesLiveCallBlockedError(
        `Google Places max API call cap reached (${this.maxApiCalls}).`,
      );
    }
  }

  private persist() {
    writeGooglePlacesCache(this.cache, this.cachePath);
  }
}
