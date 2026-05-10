import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  assertAutoDecisionSafetyGate,
  assertCoordinateAuditFields,
  getCandidateDiagnostics,
  type GoogleCandidate,
  summarizeAutoDecisions,
  type VerificationDecision,
  verifyPlaceFromCandidates,
} from "@/lib/google-place-verification";
import {
  assertNarrowFieldMask,
  assertBroadLiveRunAllowed,
  getPlaceDetailsCacheKey,
  getTextSearchCacheKey,
  GooglePlacesAccess,
  GooglePlacesLiveCallBlockedError,
} from "@/lib/google-places-access";
import { formatDateForInput } from "@/lib/place-verification";
import type { Place } from "@/lib/place";
import type { VerificationSource } from "@/lib/place";

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places";
const TEXT_SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
].join(",");
const DETAILS_FIELD_MASK = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "googleMapsUri",
  "businessStatus",
].join(",");

type CliOptions = {
  applySafeCoordinateUpdates: boolean;
  cacheOnly: boolean;
  applyAutoDecisions: boolean;
  city: string | null;
  confirmLiveApi: boolean;
  coordinateReportJson: boolean;
  debug: boolean;
  dryRun: boolean;
  force: boolean;
  inputPath: string;
  limit: number | null;
  maxApiCalls: number | null;
  monthlyBudgetUsd: number;
  estimatedCostPerCallUsd: number;
  name: string | null;
  outputPath: string;
  help: boolean;
  writeCandidates: boolean;
};

type GoogleTextSearchResponse = {
  places?: GoogleCandidate[];
};

type VerificationSummary = {
  candidateCoordinatesPopulated: number;
  closedMoved: number;
  googleMapsUrlsPopulated: number;
  highConfidenceMatches: number;
  noMatch: number;
  placeIdsPopulated: number;
  rowsNeedingReview: number;
  rowsProcessed: number;
  safeCoordinateUpdatesApplied: number;
};

function parseArgs(argv: string[]): CliOptions {
  const today = formatDateForInput(new Date());
  const options: CliOptions = {
    applySafeCoordinateUpdates: false,
    applyAutoDecisions: false,
    cacheOnly: false,
    city: null,
    confirmLiveApi: false,
    coordinateReportJson: false,
    debug: false,
    dryRun: false,
    force: false,
    inputPath: path.join(process.cwd(), "src/data/places.json"),
    limit: null,
    maxApiCalls: null,
    monthlyBudgetUsd: 5,
    estimatedCostPerCallUsd: 0.02,
    name: null,
    outputPath: path.join(
      process.cwd(),
      "outputs",
      `google-places-candidates-${today}.json`,
    ),
    help: false,
    writeCandidates: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--cache-only") {
      options.cacheOnly = true;
    } else if (arg === "--confirm-live-api") {
      options.confirmLiveApi = true;
    } else if (arg === "--debug") {
      options.debug = true;
    } else if (arg === "--coordinate-report-json") {
      options.coordinateReportJson = true;
    } else if (arg === "--write-candidates") {
      options.writeCandidates = true;
    } else if (arg === "--apply-safe-coordinate-updates") {
      options.applySafeCoordinateUpdates = true;
    } else if (arg === "--apply-auto-decisions") {
      options.applyAutoDecisions = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--input") {
      options.inputPath = path.resolve(argv[index + 1] ?? options.inputPath);
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = path.resolve(argv[index + 1] ?? options.outputPath);
      index += 1;
    } else if (arg === "--limit") {
      const limit = Number(argv[index + 1]);
      options.limit = Number.isFinite(limit) && limit > 0 ? limit : null;
      index += 1;
    } else if (arg === "--max-api-calls") {
      const maxApiCalls = Number(argv[index + 1]);
      options.maxApiCalls =
        Number.isFinite(maxApiCalls) && maxApiCalls >= 0 ? maxApiCalls : null;
      index += 1;
    } else if (arg === "--monthly-budget-usd") {
      const budget = Number(argv[index + 1]);
      options.monthlyBudgetUsd = Number.isFinite(budget) && budget > 0 ? budget : 5;
      index += 1;
    } else if (arg === "--estimated-cost-per-call-usd") {
      const cost = Number(argv[index + 1]);
      options.estimatedCostPerCallUsd =
        Number.isFinite(cost) && cost > 0 ? cost : 0.02;
      index += 1;
    } else if (arg === "--city") {
      options.city = argv[index + 1] ?? null;
      index += 1;
    } else if (arg === "--name") {
      options.name = argv[index + 1] ?? null;
      index += 1;
    }
  }

  return options;
}

function printHelp() {
  console.log(`Google Places verifier

Safety defaults:
  --dry-run does not write data. It does not call Google unless --confirm-live-api is present.
  --cache-only makes zero live Google calls and uses .cache/google-places-cache.json only.
  Live Google calls require --confirm-live-api and --max-api-calls N.
  City-wide live runs over 25 rows also require --force.
  Budget estimate defaults to $5/month and $0.02/call unless overridden.

Examples:
  pnpm verify:places -- --dry-run --cache-only --city "Taipei"
  pnpm verify:places -- --dry-run --city "Taipei" --name "Ironwood coffee" --confirm-live-api --max-api-calls 5
  GOOGLE_PLACES_LIVE_ENABLED=true pnpm verify:places -- --dry-run --city "Taipei" --confirm-live-api --max-api-calls 100 --force --monthly-budget-usd 5
`);
}

function estimateMaxTextSearchCalls(places: Place[]) {
  return places.reduce((total, place) => total + getSearchAttempts(place).length, 0);
}

function printPreRunEstimate(input: {
  liveEnabled: boolean;
  maxApiCalls: number | null;
  options: CliOptions;
  placesToProcess: Place[];
}) {
  const placeDetailsCandidates = input.placesToProcess.filter(
    (place) => place.googlePlaceId?.trim() || place.googleMapsUrl?.trim(),
  ).length;
  const textSearchCalls = estimateMaxTextSearchCalls(input.placesToProcess);
  const urlExpansionAttempts = input.placesToProcess.filter(
    (place) =>
      place.googleMapsUrl?.trim() &&
      !extractGooglePlaceIdFromUrl(place.googleMapsUrl),
  ).length;
  const effectiveMaxCalls = input.maxApiCalls ?? 0;
  const estimatedMaxCostUsd =
    effectiveMaxCalls * input.options.estimatedCostPerCallUsd;

  console.log("\nGoogle Places pre-run safety estimate");
  console.table({
    rowsToProcess: input.placesToProcess.length,
    estimatedMaxTextSearchCalls: textSearchCalls,
    estimatedMaxPlaceDetailsCalls: placeDetailsCandidates,
    estimatedMaxUrlExpansionAttempts: urlExpansionAttempts,
    estimatedMaxTotalGoogleCalls:
      textSearchCalls + placeDetailsCandidates + urlExpansionAttempts,
    maxApiCallsConfigured: input.maxApiCalls ?? "not set",
    monthlyBudgetUsd: input.options.monthlyBudgetUsd,
    estimatedCostPerCallUsd: input.options.estimatedCostPerCallUsd,
    estimatedCostAtConfiguredCapUsd: estimatedMaxCostUsd.toFixed(2),
    withinMonthlyBudget:
      input.maxApiCalls === null
        ? "unknown"
        : estimatedMaxCostUsd <= input.options.monthlyBudgetUsd,
    cacheOnly: input.options.cacheOnly || !input.options.confirmLiveApi,
    liveApiEnabled:
      input.liveEnabled && input.options.confirmLiveApi && input.maxApiCalls !== null,
  });
}

async function loadLocalEnvFile() {
  const envPath = path.join(process.cwd(), ".env.local");

  try {
    const content = await fs.readFile(envPath, "utf8");

    for (const line of content.split(/\r?\n/)) {
      const trimmedLine = line.trim();

      if (!trimmedLine || trimmedLine.startsWith("#")) {
        continue;
      }

      const separatorIndex = trimmedLine.indexOf("=");

      if (separatorIndex === -1) {
        continue;
      }

      const key = trimmedLine.slice(0, separatorIndex).trim();
      const rawValue = trimmedLine.slice(separatorIndex + 1).trim();

      if (key && process.env[key] === undefined) {
        process.env[key] = rawValue.replace(/^['"]|['"]$/g, "");
      }
    }
  } catch {
    // Shell-provided environment variables are enough; .env.local is optional.
  }
}

function stripAccentsAndPunctuation(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getRegionCode(city: string) {
  const normalizedCity = stripAccentsAndPunctuation(city).toLowerCase();

  if (normalizedCity.includes("ho chi minh")) {
    return "VN";
  }

  if (normalizedCity.includes("taipei")) {
    return "TW";
  }

  if (
    ["tokyo", "kyoto", "osaka", "fukuoka", "sapporo", "kanazawa"].some((cityName) =>
      normalizedCity.includes(cityName),
    )
  ) {
    return "JP";
  }

  if (normalizedCity.includes("seoul")) {
    return "KR";
  }

  return undefined;
}

function getSearchAttempts(place: Place) {
  const queryParts = [
    [place.name, place.address, place.city],
    [place.name, place.city],
    [place.name, place.district, place.city],
  ];
  const attempts = queryParts
    .map((parts) =>
      parts
        .map((value) => value.trim())
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean);
  const accentStrippedAttempts = attempts.map(stripAccentsAndPunctuation);
  const seen = new Set<string>();

  return [...attempts, ...accentStrippedAttempts].filter((query) => {
    const key = query.toLowerCase();

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getLocationBias(place: Place) {
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) {
    return undefined;
  }

  return {
    circle: {
      center: {
        latitude: place.latitude,
        longitude: place.longitude,
      },
      radius: 10000,
    },
  };
}

async function fetchJson<TResponse>(
  url: string,
  options: {
    apiKey: string;
    body?: Record<string, unknown>;
    fieldMask: string;
    method: "GET" | "POST";
  },
) {
  assertNarrowFieldMask(options.fieldMask);
  const response = await fetch(url, {
    body: options.body ? JSON.stringify(options.body) : undefined,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": options.apiKey,
      "X-Goog-FieldMask": options.fieldMask,
    },
    method: options.method,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google Places API ${response.status}: ${errorText}`);
  }

  return (await response.json()) as TResponse;
}

type CandidateSearchResult = {
  apiError?: string;
  candidates: GoogleCandidate[];
  queryAttempts: Array<{
    candidateCount: number;
    error?: string;
    query: string;
  }>;
  source: VerificationSource;
  urlResolutionReason?: string;
};

function extractGooglePlaceIdFromUrl(url: string) {
  const trimmedUrl = url.trim();

  if (!trimmedUrl) {
    return null;
  }

  try {
    const parsedUrl = new URL(trimmedUrl);
    const queryPlaceId =
      parsedUrl.searchParams.get("query_place_id") ??
      parsedUrl.searchParams.get("place_id");

    if (queryPlaceId) {
      return queryPlaceId;
    }
  } catch {
    // Some copied Maps URLs are partial strings; regex fallback handles those.
  }

  const decodedUrl = decodeURIComponent(trimmedUrl);
  const placeIdMatch =
    decodedUrl.match(/(?:query_place_id|place_id)=([^&]+)/) ??
    decodedUrl.match(/!1s(ChI[A-Za-z0-9_-]+)/) ??
    decodedUrl.match(/\b(ChI[A-Za-z0-9_-]{10,})\b/);

  return placeIdMatch?.[1] ?? null;
}

async function fetchTextSearchCandidates(
  place: Place,
  apiKey: string,
  access: GooglePlacesAccess,
  initialAttempts: CandidateSearchResult["queryAttempts"] = [],
  urlResolutionReason?: string,
): Promise<CandidateSearchResult> {
  const queryAttempts: CandidateSearchResult["queryAttempts"] = [
    ...initialAttempts,
  ];
  const candidateMap = new Map<string, GoogleCandidate>();
  const regionCode = getRegionCode(place.city);
  const locationBias = getLocationBias(place);

  for (const query of getSearchAttempts(place)) {
    try {
      const payload = await access.fetchJson<GoogleTextSearchResponse>(
        "textSearch",
        getTextSearchCacheKey({
          city: place.city,
          fieldMask: TEXT_SEARCH_FIELD_MASK,
          query,
          regionCode,
        }),
        "textSearch",
        () =>
          fetchJson<GoogleTextSearchResponse>(TEXT_SEARCH_URL, {
            apiKey,
            body: {
              locationBias,
              pageSize: 5,
              regionCode,
              textQuery: query,
            },
            fieldMask: TEXT_SEARCH_FIELD_MASK,
            method: "POST",
          }),
      );
      const candidates = payload.places ?? [];

      queryAttempts.push({
        candidateCount: candidates.length,
        query,
      });

      for (const candidate of candidates) {
        candidateMap.set(candidate.id, candidate);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      queryAttempts.push({
        candidateCount: 0,
        error: message,
        query,
      });
    }
  }

  const apiError = queryAttempts.find((attempt) => attempt.error)?.error;

  return {
    apiError,
    candidates: Array.from(candidateMap.values()),
    queryAttempts,
    source: "text_search",
    urlResolutionReason,
  };
}

async function resolveRedirectedUrl(url: string) {
  const response = await fetch(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    },
    method: "GET",
    redirect: "follow",
  });

  return response.url || url;
}

async function fetchPlaceDetailsCandidate(
  placeId: string,
  apiKey: string,
  access: GooglePlacesAccess,
) {
  return access.fetchJson<GoogleCandidate>(
    "placeDetails",
    getPlaceDetailsCacheKey(placeId, DETAILS_FIELD_MASK),
    "placeDetails",
    () =>
      fetchJson<GoogleCandidate>(
        `${PLACE_DETAILS_URL}/${encodeURIComponent(placeId)}`,
        {
          apiKey,
          fieldMask: DETAILS_FIELD_MASK,
          method: "GET",
        },
      ),
  );
}

async function getPlaceIdFromGoogleMapsUrl(
  googleMapsUrl: string,
  access: GooglePlacesAccess,
) {
  const directPlaceId = extractGooglePlaceIdFromUrl(googleMapsUrl);

  if (directPlaceId) {
    access.setUrlPlaceId(googleMapsUrl, directPlaceId);
    return directPlaceId;
  }

  const cachedPlaceId = access.getUrlPlaceId(googleMapsUrl);

  if (cachedPlaceId) {
    return cachedPlaceId;
  }

  const expandedUrl = await access.expandUrl(googleMapsUrl, () =>
    resolveRedirectedUrl(googleMapsUrl),
  );
  const resolvedPlaceId = extractGooglePlaceIdFromUrl(expandedUrl);

  if (resolvedPlaceId) {
    access.setUrlPlaceId(googleMapsUrl, resolvedPlaceId);
  }

  return resolvedPlaceId;
}

async function fetchCandidates(
  place: Place,
  apiKey: string,
  access: GooglePlacesAccess,
): Promise<CandidateSearchResult> {
  if (place.googlePlaceId?.trim()) {
    const placeResourceId = place.googlePlaceId.trim().replace(/^places\//, "");
    try {
      const candidate = await fetchPlaceDetailsCandidate(
        placeResourceId,
        apiKey,
        access,
      );

      return {
        candidates: [candidate],
        queryAttempts: [
          {
            candidateCount: 1,
            query: `Place Details: ${placeResourceId}`,
          },
        ],
        source: "place_id",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fetchTextSearchCandidates(
        place,
        apiKey,
        access,
        [
          {
            candidateCount: 0,
            error: message,
            query: `Place Details: ${placeResourceId}`,
          },
        ],
        "Stored Google Place ID could not be resolved; verifier fell back to Text Search.",
      );
    }
  }

  const placeIdFromUrl = place.googleMapsUrl
    ? await getPlaceIdFromGoogleMapsUrl(place.googleMapsUrl, access)
    : null;

  if (placeIdFromUrl) {
    try {
      const candidate = await fetchPlaceDetailsCandidate(
        placeIdFromUrl,
        apiKey,
        access,
      );

      return {
        candidates: [candidate],
        queryAttempts: [
          {
            candidateCount: 1,
            query: `Google Maps URL Place Details: ${placeIdFromUrl}`,
          },
        ],
        source: "google_maps_url",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return fetchTextSearchCandidates(
        place,
        apiKey,
        access,
        [
          {
            candidateCount: 0,
            error: message,
            query: `Google Maps URL Place Details: ${placeIdFromUrl}`,
          },
        ],
        "Google Maps URL contained a Place ID but it could not be resolved; verifier fell back to Text Search.",
      );
    }
  }

  return fetchTextSearchCandidates(
    place,
    apiKey,
    access,
    [],
    place.googleMapsUrl
      ? "Google Maps URL did not contain a directly resolvable Place ID; verifier used Text Search fallback."
      : undefined,
  );
}

function printDebugDetails(
  place: Place,
  searchResult: CandidateSearchResult,
  decision: VerificationDecision,
) {
  console.log(`\nDEBUG ${place.city} - ${place.name}`);
  console.log(`Source: ${searchResult.source}`);
  console.log("Query attempts:");

  for (const attempt of searchResult.queryAttempts) {
    console.log(
      `- "${attempt.query}" -> ${attempt.candidateCount} candidate${
        attempt.candidateCount === 1 ? "" : "s"
      }${attempt.error ? ` | API error: ${attempt.error}` : ""}`,
    );
  }

  if (searchResult.candidates.length === 0) {
    console.log(
      searchResult.apiError
        ? `No candidates because of API error: ${searchResult.apiError}`
        : "Google returned zero candidates across all query attempts.",
    );
    return;
  }

  console.log("Candidates:");
  for (const diagnostic of getCandidateDiagnostics(
    place,
    searchResult.candidates,
  )) {
    const candidate = diagnostic.candidate;
    const locationText = candidate.location
      ? `${candidate.location.latitude}, ${candidate.location.longitude}`
      : "No coordinates";
    const statusText =
      diagnostic.rejectionReasons.length === 0
        ? "accepted by scoring rules"
        : `rejected: ${diagnostic.rejectionReasons.join("; ")}`;

    console.log(
      `- ${candidate.displayName?.text ?? "Unnamed"} | ${
        candidate.formattedAddress ?? "No address"
      } | ${candidate.id} | ${candidate.googleMapsUri ?? "No Google Maps URI"} | ${
        candidate.businessStatus ?? "UNKNOWN"
      } | ${locationText}`,
    );
    console.log(
      `  scores: confidence=${candidate.matchConfidence}, name=${candidate.nameScore}, address=${candidate.addressScore}, city=${candidate.cityScore}, district=${candidate.districtScore}, country=${candidate.countryScore}, ambiguity=${candidate.ambiguityScore}, distance=${
        candidate.distanceMeters === null
          ? "unknown"
          : `${Math.round(candidate.distanceMeters)}m`
      }`,
    );
    console.log(`  ${statusText}`);
  }

  if (decision.kind === "no_match") {
    console.log("Decision: no_match because candidates were rejected by scoring.");
  } else {
    console.log(`Decision: ${decision.kind}`);
  }
}

function getEmptySummary(): VerificationSummary {
  return {
    candidateCoordinatesPopulated: 0,
    closedMoved: 0,
    googleMapsUrlsPopulated: 0,
    highConfidenceMatches: 0,
    noMatch: 0,
    placeIdsPopulated: 0,
    rowsNeedingReview: 0,
    rowsProcessed: 0,
    safeCoordinateUpdatesApplied: 0,
  };
}

function updateSummary(
  summary: VerificationSummary,
  originalPlace: Place,
  decision: VerificationDecision,
) {
  const nextPlace = decision.place;
  summary.rowsProcessed += 1;

  if (decision.kind === "high_confidence") {
    summary.highConfidenceMatches += 1;
    if (decision.safeCoordinateUpdateApplied) {
      summary.safeCoordinateUpdatesApplied += 1;
    }
  }

  if (decision.kind === "closed_moved") {
    summary.closedMoved += 1;
  }

  if (decision.kind === "no_match") {
    summary.noMatch += 1;
  }

  if (!originalPlace.googlePlaceId && nextPlace.googlePlaceId) {
    summary.placeIdsPopulated += 1;
  }

  if (!originalPlace.googleMapsUrl && nextPlace.googleMapsUrl) {
    summary.googleMapsUrlsPopulated += 1;
  }

  if (
    (originalPlace.verifiedLatitude === undefined ||
      originalPlace.verifiedLongitude === undefined) &&
    nextPlace.verifiedLatitude !== undefined &&
    nextPlace.verifiedLongitude !== undefined
  ) {
    summary.candidateCoordinatesPopulated += 1;
  }

  if (nextPlace.verifiedStatus === "Review") {
    summary.rowsNeedingReview += 1;
  }
}

function printReviewRows(places: Place[]) {
  const reviewRows = places.filter((place) => place.verifiedStatus === "Review");

  if (reviewRows.length === 0) {
    return;
  }

  console.log("\nRows left for Review");
  console.table(
    reviewRows.map((place) => ({
      name: place.name,
      verificationDecision: place.verificationDecision ?? "",
      candidate: place.canonicalName ?? "",
      distanceDeltaMeters: place.distanceDeltaMeters ?? "",
      reason:
        place.samePlaceReason ||
        place.verificationNotes ||
        "No candidate metadata captured.",
    })),
  );
}

function getGoogleUrlReviewReason(place: Place) {
  const reason = [place.samePlaceReason, place.verificationNotes]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (place.verificationDecision === "ambiguous_multiple_candidates") {
    return "multiple candidates";
  }

  if (place.verificationDecision === "closed_or_moved") {
    return "closed/moved";
  }

  if (place.verificationDecision === "no_candidate_found") {
    return place.verificationSource === "text_search"
      ? "URL not resolvable; Text Search found no candidate"
      : "URL not resolvable";
  }

  if (reason.includes("city/country")) {
    return "city/country mismatch";
  }

  if (reason.includes("name")) {
    return "name mismatch";
  }

  if (reason.includes("address")) {
    return "address mismatch";
  }

  if (place.verificationSource === "text_search") {
    return "URL not resolvable; weak Text Search match";
  }

  return "resolved Google place needs review";
}

function printGoogleMapsUrlReviewRows(places: Place[]) {
  const reviewRows = places.filter(
    (place) => place.googleMapsUrl?.trim() && place.verifiedStatus === "Review",
  );

  if (reviewRows.length === 0) {
    return;
  }

  console.log("\nGoogle Maps URL rows still left for Review");
  console.table(
    reviewRows.map((place) => ({
      name: place.name,
      city: place.city,
      reviewReason: getGoogleUrlReviewReason(place),
      verificationDecision: place.verificationDecision ?? "",
      verificationSource: place.verificationSource ?? "",
      canonicalName: place.canonicalName ?? "",
      canonicalAddress: place.canonicalAddress ?? "",
      samePlaceReason: place.samePlaceReason ?? "",
    })),
  );
}

function printCoordinateChangeReport(
  originalPlacesById: Map<string, Place>,
  places: Place[],
  options: { asJson?: boolean } = {},
) {
  const coordinateChanges = places
    .map((place) => {
      const originalPlace = originalPlacesById.get(place.id);

      if (
        !originalPlace ||
        (originalPlace.latitude === place.latitude &&
          originalPlace.longitude === place.longitude)
      ) {
        return null;
      }

      const flags = [
        typeof place.distanceDeltaMeters === "number" &&
        place.distanceDeltaMeters > 1000
          ? "distance>1000m"
          : null,
        typeof place.nameScore === "number" && place.nameScore < 0.6
          ? "nameScore<0.6"
          : null,
        typeof place.addressScore === "number" && place.addressScore < 0.5
          ? "addressScore<0.5"
          : null,
      ].filter(Boolean);

      return {
        name: place.name,
        oldLatitude: originalPlace.latitude,
        oldLongitude: originalPlace.longitude,
        newLatitude: place.latitude,
        newLongitude: place.longitude,
        distanceDeltaMeters: place.distanceDeltaMeters ?? "",
        verificationDecision: place.verificationDecision ?? "",
        candidateName: place.canonicalName ?? "",
        candidateAddress: place.canonicalAddress ?? "",
        source: place.verificationSource ?? "",
        samePlaceReason: place.samePlaceReason ?? "",
        nameScore: place.nameScore ?? "",
        addressScore: place.addressScore ?? "",
        flags: flags.join(", "),
        hasAuditFields: Boolean(
          place.verificationDecision &&
            place.verificationSource &&
            place.samePlaceReason,
        ),
      };
    })
    .filter((change) => change !== null);

  if (coordinateChanges.length === 0) {
    return;
  }

  if (options.asJson) {
    console.log("\nProposed coordinate changes JSON");
    console.log(JSON.stringify(coordinateChanges, null, 2));
    return;
  }

  console.log("\nProposed coordinate changes");
  console.table(coordinateChanges);

  const flaggedChanges = coordinateChanges.filter((change) => change.flags);

  if (flaggedChanges.length > 0) {
    console.log("\nFlagged proposed coordinate changes");
    console.table(flaggedChanges);
  }

  const auditGaps = coordinateChanges.filter((change) => !change.hasAuditFields);

  if (auditGaps.length > 0) {
    console.log("\nCoordinate changes missing audit fields");
    console.table(auditGaps);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  await loadLocalEnvFile();
  const liveEnabled = process.env.GOOGLE_PLACES_LIVE_ENABLED === "true";
  const apiKey =
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY ?? "";

  const rawPlaces = await fs.readFile(options.inputPath, "utf8");
  const places = JSON.parse(rawPlaces) as Place[];
  const cityFilteredPlaces = options.city
    ? places.filter(
        (place) =>
          place.city.localeCompare(options.city ?? "", undefined, {
            sensitivity: "accent",
          }) === 0,
      )
    : places;
  const nameFilteredPlaces = options.name
    ? cityFilteredPlaces.filter(
        (place) =>
          place.name.localeCompare(options.name ?? "", undefined, {
            sensitivity: "accent",
          }) === 0,
      )
    : cityFilteredPlaces;
  const placesToProcess =
    options.limit === null
      ? nameFilteredPlaces
      : nameFilteredPlaces.slice(0, options.limit);
  const liveCallsRequested = options.confirmLiveApi && !options.cacheOnly;

  printPreRunEstimate({
    liveEnabled,
    maxApiCalls: options.maxApiCalls,
    options,
    placesToProcess,
  });

  if (liveCallsRequested && !apiKey) {
    throw new Error(
      "GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY is required for live Google calls.",
    );
  }

  if (liveCallsRequested && !liveEnabled) {
    throw new Error(
      "Live Google Places calls are disabled. Set GOOGLE_PLACES_LIVE_ENABLED=true before using --confirm-live-api.",
    );
  }

  assertBroadLiveRunAllowed({
    confirmLiveApi: liveCallsRequested,
    force: options.force,
    maxApiCalls: options.maxApiCalls,
    rowCount: placesToProcess.length,
  });

  const access = new GooglePlacesAccess({
    cacheOnly: options.cacheOnly || !options.confirmLiveApi,
    confirmLiveApi: options.confirmLiveApi,
    liveEnabled,
    maxApiCalls: options.maxApiCalls,
  });
  const today = new Date();
  const summary = getEmptySummary();
  const updatedById = new Map<string, Place>();

  for (const [index, place] of placesToProcess.entries()) {
    try {
      const searchResult = await fetchCandidates(place, apiKey, access);
      const decision = verifyPlaceFromCandidates(place, searchResult.candidates, {
        applyAutoDecisions: options.applyAutoDecisions,
        applySafeCoordinateUpdates: options.applySafeCoordinateUpdates,
        candidateSource: searchResult.source,
        today,
      });

      updatedById.set(place.id, decision.place);
      updateSummary(summary, place, decision);
      console.log(
        `${index + 1}/${placesToProcess.length} ${place.city} - ${place.name}: ${
          decision.kind
        }`,
      );

      if (options.debug) {
        printDebugDetails(place, searchResult, decision);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const isBlockedLiveCall = error instanceof GooglePlacesLiveCallBlockedError;
      const failedPlace: Place = {
        ...place,
        lastChecked: formatDateForInput(today),
        verifiedStatus: "Review",
        samePlaceDecision: "Unsure",
        samePlaceReason: isBlockedLiveCall
          ? "Cache miss; live Google Places calls were not allowed for this run."
          : place.samePlaceReason,
        verificationDecision: isBlockedLiveCall
          ? "no_candidate_found"
          : place.verificationDecision,
        verificationSource: place.verificationSource ?? "text_search",
        verificationNotes: place.verificationNotes
          ? `${place.verificationNotes}\n${message}`
          : message,
      };

      updatedById.set(place.id, failedPlace);
      summary.rowsProcessed += 1;
      summary.rowsNeedingReview += 1;
      console.warn(
        `${index + 1}/${placesToProcess.length} ${place.city} - ${place.name}: failed`,
      );
    }
  }

  const nextPlaces = places.map((place) => updatedById.get(place.id) ?? place);
  const processedNextPlaces = placesToProcess.map(
    (place) => updatedById.get(place.id) ?? place,
  );
  const originalPlacesById = new Map(places.map((place) => [place.id, place]));
  const autoDecisionSummary = summarizeAutoDecisions(processedNextPlaces);
  autoDecisionSummary.autoCorrectedLargeDelta =
    autoDecisionSummary.autoCorrectedLargeDelta.map((correction) => {
      const correctedPlace = processedNextPlaces.find(
        (place) => place.name === correction.name,
      );
      const originalPlace = correctedPlace
        ? originalPlacesById.get(correctedPlace.id)
        : undefined;

      return {
        ...correction,
        oldLatitude: originalPlace?.latitude ?? correction.oldLatitude,
        oldLongitude: originalPlace?.longitude ?? correction.oldLongitude,
      };
    });

  console.log("\nGoogle Places verification summary");
  console.table(summary);
  console.log("\nGoogle Places API/cache safety counters");
  console.table({
    ...access.counters,
    liveCallsMade: access.getLiveCallCount(),
  });
  console.log("\nAuto-decision safety report");
  console.table({
    rowsProcessed: autoDecisionSummary.rowsProcessed,
    auto_verified_small_delta: autoDecisionSummary.autoVerifiedSmallDeltaCount,
    corrected_from_place_id: autoDecisionSummary.correctedFromPlaceIdCount,
    corrected_from_google_maps_url:
      autoDecisionSummary.correctedFromGoogleMapsUrlCount,
    corrected_from_text_search: autoDecisionSummary.correctedFromTextSearchCount,
    auto_corrected_large_delta: autoDecisionSummary.autoCorrectedLargeDeltaCount,
    review: autoDecisionSummary.candidateOnlyReviewCount,
    no_candidate_found: autoDecisionSummary.noCandidateCount,
    closed_or_moved: autoDecisionSummary.closedMovedCount,
  });

  if (
    autoDecisionSummary.autoCorrectedLargeDelta.length > 0 &&
    !options.coordinateReportJson
  ) {
    console.log("\nLarge-delta auto-correction proposals");
    console.table(autoDecisionSummary.autoCorrectedLargeDelta);
  }

  printCoordinateChangeReport(originalPlacesById, processedNextPlaces, {
    asJson: options.coordinateReportJson,
  });

  if (!options.coordinateReportJson) {
    printReviewRows(processedNextPlaces);
    printGoogleMapsUrlReviewRows(processedNextPlaces);
  }

  if (options.writeCandidates && !options.dryRun) {
    if (options.applyAutoDecisions) {
      assertAutoDecisionSafetyGate(processedNextPlaces, { force: options.force });
    }

    assertCoordinateAuditFields(originalPlacesById, processedNextPlaces);

    await fs.mkdir(path.dirname(options.outputPath), { recursive: true });
    await fs.writeFile(
      options.outputPath,
      `${JSON.stringify(nextPlaces, null, 2)}\n`,
    );
    console.log(`Candidate output written to ${options.outputPath}`);
  } else {
    console.log(
      "No file written. Pass --write-candidates to write candidate output JSON.",
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
