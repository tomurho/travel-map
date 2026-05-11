import { readFileSync, writeFileSync } from "node:fs";

import {
  FreeGeocodingAccess,
  type FreeGeocodeCandidate,
  type FreeGeocodingCounters,
} from "@/lib/free-geocoding";
import {
  getDistanceMeters,
  type GoogleCandidate,
  scoreGoogleCandidate,
  verifyPlaceFromCandidates,
} from "@/lib/google-place-verification";
import {
  assertNarrowFieldMask,
  getPlaceDetailsCacheKey,
  getTextSearchCacheKey,
  GooglePlacesAccess,
  GooglePlacesLiveCallBlockedError,
  type GooglePlacesCounters,
} from "@/lib/google-places-access";
import type { Place, VerificationSource } from "@/lib/place";

const PLACES_FILE_PATH = "src/data/places.json";
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

type CandidateSearchResult = {
  candidates: GoogleCandidate[];
  counters?: GooglePlacesCounters;
  expandedUrl?: string;
  placeIdFromUrl?: string;
  source: VerificationSource;
  resolutionNotes: string[];
  textSearchQueries: string[];
};

export type CoordinateResolverProviderAttempt = {
  provider: "existing" | "free_geocoding" | "google_places" | "manual";
  status: "hit" | "miss" | "skipped" | "blocked" | "error";
  detail: string;
};

export type AdminCandidateSummary = {
  addressScore: number;
  businessStatus: string;
  candidateCoordinateSource: Place["candidateCoordinateSource"];
  canonicalAddress: string;
  canonicalName: string;
  coordinateConfidence: Place["coordinateConfidence"];
  coordinatePrecision: Place["coordinatePrecision"];
  distanceDeltaMeters: number | null;
  googleMapsUrl: string;
  googlePlaceId: string;
  latitude: number | null;
  longitude: number | null;
  matchConfidence: number;
  nameScore: number;
  provider: VerificationSource;
};

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
    ["tokyo", "kyoto", "osaka", "fukuoka", "sapporo", "kanazawa"].some(
      (cityName) => normalizedCity.includes(cityName),
    )
  ) {
    return "JP";
  }

  if (normalizedCity.includes("seoul")) {
    return "KR";
  }

  return undefined;
}

export function getAdminResolverSearchAttempts(place: Place) {
  const addresses = Array.from(
    new Set(
      [place.address, place.canonicalAddress]
        .map((address) => address?.trim())
        .filter((address): address is string => Boolean(address)),
    ),
  );
  const queryParts = [
    ...addresses.map((address) => [place.name, address, place.city]),
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
    fetcher?: typeof fetch;
    fieldMask: string;
    method: "GET" | "POST";
  },
) {
  assertNarrowFieldMask(options.fieldMask);
  const fetcher = options.fetcher ?? fetch;
  const response = await fetcher(url, {
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

export function extractGooglePlaceIdFromUrl(url: string) {
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
    // Regex fallback covers copied partial Maps URLs.
  }

  const decodedUrl = decodeURIComponent(trimmedUrl);
  const placeIdMatch =
    decodedUrl.match(/(?:query_place_id|place_id)=([^&]+)/) ??
    decodedUrl.match(/!1s(ChI[A-Za-z0-9_-]+)/) ??
    decodedUrl.match(/\b(ChI[A-Za-z0-9_-]{10,})\b/);

  return placeIdMatch?.[1] ?? null;
}

async function resolveRedirectedUrl(url: string, fetcher: typeof fetch = fetch) {
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      },
      method: "GET",
      redirect: "follow",
    });

    return {
      error: "",
      url: response.url || url,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      url,
    };
  }
}

async function fetchTextSearchCandidates(
  place: Place,
  apiKey: string,
  resolutionNotes: string[] = [],
  fetcher: typeof fetch = fetch,
  access = new GooglePlacesAccess(),
): Promise<CandidateSearchResult> {
  const candidateMap = new Map<string, GoogleCandidate>();
  const regionCode = getRegionCode(place.city);
  const locationBias = getLocationBias(place);
  const textSearchQueries = getAdminResolverSearchAttempts(place);

  for (const query of textSearchQueries) {
    try {
      const payload = await access.fetchJson<{ places?: GoogleCandidate[] }>(
        "textSearch",
        getTextSearchCacheKey({
          city: place.city,
          fieldMask: TEXT_SEARCH_FIELD_MASK,
          query,
          regionCode,
        }),
        "textSearch",
        () =>
          fetchJson<{ places?: GoogleCandidate[] }>(TEXT_SEARCH_URL, {
            apiKey,
            body: {
              locationBias,
              pageSize: 5,
              regionCode,
              textQuery: query,
            },
            fetcher,
            fieldMask: TEXT_SEARCH_FIELD_MASK,
            method: "POST",
          }),
      );

      for (const candidate of payload.places ?? []) {
        candidateMap.set(candidate.id, candidate);
      }
    } catch {
      // Try all fallback queries before reporting no candidate.
    }
  }

  return {
    candidates: Array.from(candidateMap.values()),
    counters: access.counters,
    resolutionNotes:
      candidateMap.size === 0
        ? [
            ...resolutionNotes,
            "Text Search fallback found no Google Places candidates.",
          ]
        : resolutionNotes,
    source: "text_search",
    textSearchQueries,
  };
}

export async function fetchCandidatesFromGoogleMapsUrl(
  place: Place,
  googleMapsUrl: string,
  apiKey: string,
  fetcher: typeof fetch = fetch,
  access = new GooglePlacesAccess(),
): Promise<CandidateSearchResult> {
  const directPlaceId = extractGooglePlaceIdFromUrl(googleMapsUrl);
  let redirectResult = { error: "", url: googleMapsUrl };

  if (!directPlaceId) {
    try {
      redirectResult = {
        error: "",
        url: await access.expandUrl(googleMapsUrl, async () => {
          const result = await resolveRedirectedUrl(googleMapsUrl, fetcher);

          if (result.error) {
            throw new Error(result.error);
          }

          return result.url;
        }),
      };
    } catch (error) {
      redirectResult = {
        error: error instanceof Error ? error.message : String(error),
        url: googleMapsUrl,
      };
    }
  }
  const resolvedPlaceId =
    directPlaceId ?? extractGooglePlaceIdFromUrl(redirectResult.url);
  const resolutionNotes = [
    directPlaceId
      ? "Place ID was extracted from the pasted Google Maps URL."
      : "",
    !directPlaceId && redirectResult.url !== googleMapsUrl
      ? `Short Google Maps URL expanded to: ${redirectResult.url}`
      : "",
    !directPlaceId && redirectResult.error
      ? `Short Google Maps URL could not be expanded: ${redirectResult.error}`
      : "",
    !resolvedPlaceId
      ? "Place ID was not found in the pasted or expanded Google Maps URL; Text Search fallback was used."
      : "",
  ].filter(Boolean);

  if (resolvedPlaceId) {
    const candidate = await access.fetchJson<GoogleCandidate>(
      "placeDetails",
      getPlaceDetailsCacheKey(resolvedPlaceId, DETAILS_FIELD_MASK),
      "placeDetails",
      () =>
        fetchJson<GoogleCandidate>(
          `${PLACE_DETAILS_URL}/${encodeURIComponent(resolvedPlaceId)}`,
          {
            apiKey,
            fetcher,
            fieldMask: DETAILS_FIELD_MASK,
            method: "GET",
          },
        ),
    );

    return {
      candidates: [candidate],
      counters: access.counters,
      expandedUrl:
        redirectResult.url !== googleMapsUrl ? redirectResult.url : undefined,
      placeIdFromUrl: resolvedPlaceId,
      resolutionNotes,
      source: "google_maps_url",
      textSearchQueries: [],
    };
  }

  return fetchTextSearchCandidates(
    place,
    apiKey,
    resolutionNotes,
    fetcher,
    access,
  );
}

async function fetchGoogleCandidatesForAdminPlace(
  place: Place,
  googleMapsUrl: string,
  apiKey: string,
  fetcher: typeof fetch,
  access: GooglePlacesAccess,
): Promise<CandidateSearchResult> {
  const googlePlaceId = place.googlePlaceId?.trim().replace(/^places\//, "");

  if (googlePlaceId) {
    const candidate = await access.fetchJson<GoogleCandidate>(
      "placeDetails",
      getPlaceDetailsCacheKey(googlePlaceId, DETAILS_FIELD_MASK),
      "placeDetails",
      () =>
        fetchJson<GoogleCandidate>(
          `${PLACE_DETAILS_URL}/${encodeURIComponent(googlePlaceId)}`,
          {
            apiKey,
            fetcher,
            fieldMask: DETAILS_FIELD_MASK,
            method: "GET",
          },
        ),
    );

    return {
      candidates: [candidate],
      counters: access.counters,
      placeIdFromUrl: googlePlaceId,
      resolutionNotes: ["Stored Google Place ID was used for Place Details."],
      source: "place_id",
      textSearchQueries: [],
    };
  }

  if (googleMapsUrl.trim()) {
    return fetchCandidatesFromGoogleMapsUrl(
      place,
      googleMapsUrl,
      apiKey,
      fetcher,
      access,
    );
  }

  return fetchTextSearchCandidates(
    place,
    apiKey,
    ["No Google Maps URL or Place ID was supplied; Google Text Search fallback was used."],
    fetcher,
    access,
  );
}

export function readProductionPlaces() {
  return JSON.parse(readFileSync(PLACES_FILE_PATH, "utf8")) as Place[];
}

export function writeProductionPlaces(places: Place[]) {
  writeFileSync(PLACES_FILE_PATH, `${JSON.stringify(places, null, 2)}\n`);
}

function hasVerifiedCandidateCoordinates(place: Place) {
  return (
    typeof place.verifiedLatitude === "number" &&
    typeof place.verifiedLongitude === "number"
  );
}

function getFreeGeocodingQueries(place: Place) {
  const addresses = Array.from(
    new Set(
      [place.canonicalAddress, place.address]
        .map((address) => address?.trim())
        .filter((address): address is string => Boolean(address)),
    ),
  );
  const queryParts = [
    ...addresses.map((address) => [place.name, address, place.city]),
    [place.name, place.city],
    [place.name, place.district, place.city],
  ];
  const seen = new Set<string>();

  return queryParts
    .map((parts) =>
      parts
        .map((part) => part.trim())
        .filter(Boolean)
        .join(", "),
    )
    .filter(Boolean)
    .filter((query) => {
      const key = stripAccentsAndPunctuation(query).toLowerCase();

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function applyFreeGeocodingCandidateForReview(
  place: Place,
  candidate: FreeGeocodeCandidate,
  provider: "osm" | "free_geocoding" = "osm",
) {
  const distanceDeltaMeters =
    Number.isFinite(place.latitude) && Number.isFinite(place.longitude)
      ? Number(
          getDistanceMeters(
            { latitude: place.latitude, longitude: place.longitude },
            {
              latitude: candidate.latitude,
              longitude: candidate.longitude,
            },
          ).toFixed(1),
        )
      : undefined;

  return {
    ...place,
    businessStatus: place.businessStatus ?? "",
    canonicalAddress: candidate.address,
    candidateCoordinateSource: provider,
    coordinateConfidence: candidate.confidence,
    coordinatePrecision: candidate.precision,
    distanceDeltaMeters,
    lastChecked: new Date().toISOString().slice(0, 10),
    matchConfidence:
      candidate.confidence === "high" ? 0.82 : candidate.confidence === "medium" ? 0.62 : 0.35,
    samePlaceDecision: "Unsure" as const,
    samePlaceReason:
      "Free geocoding returned candidate coordinates. Review before accepting because free geocoding can return address centroids or approximate pins.",
    verificationDecision: "candidate_only_review" as const,
    verificationSource: provider,
    verifiedLatitude: candidate.latitude,
    verifiedLongitude: candidate.longitude,
    verifiedStatus: "Review" as const,
    verificationNotes: [
      place.verificationNotes,
      `Free geocoding candidate from ${provider} saved for manual review.`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

async function resolveFreeGeocodingCandidate(
  place: Place,
  attempts: CoordinateResolverProviderAttempt[],
  options: {
    fetcher?: typeof fetch;
    freeAccess: FreeGeocodingAccess;
  },
) {
  const queries = getFreeGeocodingQueries(place);

  for (const query of queries) {
    const candidates = await options.freeAccess.searchOsm(
      query,
      options.fetcher ?? fetch,
    );

    if (candidates === null) {
      attempts.push({
        provider: "free_geocoding",
        status: "blocked",
        detail:
          "Free geocoding live lookup is disabled and no cached free result exists.",
      });
      continue;
    }

    if (candidates.length === 0) {
      attempts.push({
        provider: "free_geocoding",
        status: "miss",
        detail: `OSM/Nominatim returned no candidates for "${query}".`,
      });
      continue;
    }

    attempts.push({
      provider: "free_geocoding",
      status: "hit",
      detail: `OSM/Nominatim returned ${candidates.length} candidate${
        candidates.length === 1 ? "" : "s"
      } for "${query}".`,
    });

    return candidates[0];
  }

  return null;
}

function addSingleFallbackCandidateForReview(
  place: Place,
  rowForScoring: Place,
  searchResult: CandidateSearchResult,
) {
  if (
    hasVerifiedCandidateCoordinates(place) ||
    searchResult.candidates.length !== 1
  ) {
    return place;
  }

  const rawCandidate = searchResult.candidates[0];

  if (!rawCandidate) {
    return place;
  }

  const candidate = scoreGoogleCandidate(rowForScoring, rawCandidate);

  return {
    ...place,
    addressScore: candidate.addressScore,
    ambiguityScore: candidate.ambiguityScore,
    businessStatus: candidate.businessStatus ?? "",
    canonicalAddress: candidate.formattedAddress ?? "",
    canonicalName: candidate.displayName?.text ?? "",
    cityScore: candidate.cityScore,
    countryScore: candidate.countryScore,
    distanceDeltaMeters: candidate.distanceMeters ?? undefined,
    districtScore: candidate.districtScore,
    googlePlaceId: candidate.id,
    matchConfidence: candidate.matchConfidence,
    nameScore: candidate.nameScore,
    candidateCoordinateSource: "google_places" as const,
    coordinatePrecision: "place_pin" as const,
    coordinateConfidence:
      candidate.matchConfidence >= 0.78
        ? ("high" as const)
        : candidate.matchConfidence >= 0.62
          ? ("medium" as const)
          : ("low" as const),
    samePlaceDecision: "Unsure" as const,
    samePlaceReason:
      "Text Search fallback returned one candidate, but the row evidence was not strong enough to auto-verify. Candidate metadata was saved for manual review.",
    verificationDecision: "candidate_only_review" as const,
    verificationSource: searchResult.source,
    verifiedLatitude: candidate.location?.latitude,
    verifiedLongitude: candidate.location?.longitude,
    verificationNotes: [
      place.verificationNotes,
      "Single Text Search fallback candidate saved for manual review.",
      candidate.googleMapsUri
        ? `Candidate Google Maps URL: ${candidate.googleMapsUri}`
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

function getCoordinateConfidence(matchConfidence: number) {
  return matchConfidence >= 0.78
    ? ("high" as const)
    : matchConfidence >= 0.62
      ? ("medium" as const)
      : ("low" as const);
}

function summarizeAdminCandidate(
  place: Place,
  rawCandidate: GoogleCandidate,
  provider: VerificationSource,
): AdminCandidateSummary | null {
  if (!rawCandidate.id) {
    return null;
  }

  const candidate = scoreGoogleCandidate(place, rawCandidate);

  return {
    addressScore: candidate.addressScore,
    businessStatus: candidate.businessStatus ?? "",
    candidateCoordinateSource: "google_places",
    canonicalAddress: candidate.formattedAddress ?? "",
    canonicalName: candidate.displayName?.text ?? "",
    coordinateConfidence: getCoordinateConfidence(candidate.matchConfidence),
    coordinatePrecision: "place_pin",
    distanceDeltaMeters: candidate.distanceMeters,
    googleMapsUrl: candidate.googleMapsUri ?? "",
    googlePlaceId: candidate.id,
    latitude: candidate.location?.latitude ?? null,
    longitude: candidate.location?.longitude ?? null,
    matchConfidence: candidate.matchConfidence,
    nameScore: candidate.nameScore,
    provider,
  };
}

export function summarizeAdminCandidates(
  place: Place,
  searchResult: CandidateSearchResult,
) {
  return searchResult.candidates
    .map((candidate) =>
      summarizeAdminCandidate(place, candidate, searchResult.source),
    )
    .filter((candidate): candidate is AdminCandidateSummary => candidate !== null)
    .sort(
      (firstCandidate, secondCandidate) =>
        secondCandidate.matchConfidence - firstCandidate.matchConfidence,
    );
}

export async function resolveGoogleMapsUrlForProductionPlace(
  id: string,
  googleMapsUrl: string,
  apiKey: string,
  options: {
    access?: GooglePlacesAccess;
    fetcher?: typeof fetch;
    freeAccess?: FreeGeocodingAccess;
    placeOverrides?: Partial<
      Pick<
        Place,
        | "address"
        | "canonicalAddress"
        | "googleMapsUrl"
        | "latitude"
        | "longitude"
        | "verifiedStatus"
        | "verificationNotes"
      >
    >;
  } = {},
) {
  const currentPlaces = readProductionPlaces();
  const placeIndex = currentPlaces.findIndex((place) => place.id === id);

  if (placeIndex === -1) {
    return { error: "Production place was not found." };
  }

  const currentPlace = {
    ...currentPlaces[placeIndex],
    ...options.placeOverrides,
  } as Place;
  const trimmedGoogleMapsUrl = googleMapsUrl.trim();

  if (!currentPlace) {
    return { error: "Production place was not found." };
  }

  const placeForResolution: Place = {
    ...currentPlace,
    address: currentPlace.canonicalAddress?.trim() || currentPlace.address,
    googleMapsUrl: trimmedGoogleMapsUrl,
  };
  let nextPlace: Place | null = null;
  const access = options.access ?? new GooglePlacesAccess();
  const freeAccess = options.freeAccess ?? new FreeGeocodingAccess();
  const providerAttempts: CoordinateResolverProviderAttempt[] = [];
  let candidateSummaries: AdminCandidateSummary[] = [];

  if (hasVerifiedCandidateCoordinates(currentPlace)) {
    providerAttempts.push({
      provider: "existing",
      status: "hit",
      detail: "Existing candidate coordinates are already present on this row.",
    });
    nextPlace = {
      ...currentPlace,
      googleMapsUrl: trimmedGoogleMapsUrl || currentPlace.googleMapsUrl,
      verificationNotes: [
        currentPlace.verificationNotes,
        "Existing candidate coordinates were reused; no live lookup was needed.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (!nextPlace) {
    const freeCandidate = await resolveFreeGeocodingCandidate(
      placeForResolution,
      providerAttempts,
      {
        fetcher: options.fetcher,
        freeAccess,
      },
    );

    if (freeCandidate) {
      nextPlace = applyFreeGeocodingCandidateForReview(
        {
          ...currentPlace,
          googleMapsUrl: trimmedGoogleMapsUrl || currentPlace.googleMapsUrl,
        },
        freeCandidate,
        freeCandidate.provider,
      );
    }
  }

  if (!nextPlace) {
    providerAttempts.push({
      provider: "google_places",
      status: "skipped",
      detail:
        "Trying cached Google Places next; live Google Places calls require GOOGLE_PLACES_LIVE_ENABLED=true and the server-side call cap.",
    });
  }

  try {
    if (nextPlace) {
      throw new Error("__candidate_already_resolved__");
    }

    const searchResult = await fetchGoogleCandidatesForAdminPlace(
      placeForResolution,
      trimmedGoogleMapsUrl,
      apiKey,
      options.fetcher ?? fetch,
      access,
    );
    const decision = verifyPlaceFromCandidates(
      placeForResolution,
      searchResult.candidates,
      {
        applyAutoDecisions: false,
        candidateSource: searchResult.source,
      },
    );
    candidateSummaries = summarizeAdminCandidates(
      placeForResolution,
      searchResult,
    );
    const note =
      [
        "Google Maps URL was resolved from the admin QA panel.",
        ...searchResult.resolutionNotes,
        searchResult.textSearchQueries.length > 0
          ? `Text Search queries tried: ${searchResult.textSearchQueries.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");

    nextPlace = {
      ...decision.place,
      address: currentPlace.address,
      latitude: currentPlace.latitude,
      longitude: currentPlace.longitude,
      googleMapsUrl: trimmedGoogleMapsUrl || decision.place.googleMapsUrl,
      googlePlaceId: decision.place.googlePlaceId ?? searchResult.placeIdFromUrl,
      verifiedStatus:
        decision.place.verificationDecision === "closed_or_moved"
          ? "Closed/Moved"
          : "Review",
      verificationNotes: [decision.place.verificationNotes, note]
        .filter(Boolean)
        .join("\n"),
    };
    if (decision.kind === "ambiguous") {
      nextPlace = {
        ...nextPlace,
        samePlaceReason:
          "Multiple candidates were found. Choose the correct listing below.",
        verificationNotes: [
          nextPlace.verificationNotes,
          "Multiple candidates were found. Choose the correct listing below.",
        ]
          .filter(Boolean)
          .join("\n"),
      };
    }
    nextPlace = addSingleFallbackCandidateForReview(
      nextPlace,
      placeForResolution,
      searchResult,
    );
    providerAttempts.push({
      provider: "google_places",
      status:
        searchResult.candidates.length > 0
          ? "hit"
          : searchResult.counters?.blockedByMissingConfirm
            ? "blocked"
            : "miss",
      detail:
        searchResult.candidates.length > 0
          ? `Google Places returned ${searchResult.candidates.length} candidate${
              searchResult.candidates.length === 1 ? "" : "s"
            }.`
          : searchResult.resolutionNotes.join(" ") ||
            "Google Places returned no cached candidate.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "__candidate_already_resolved__") {
      // Free/cache candidate already populated nextPlace.
    } else {
    const message = error instanceof Error ? error.message : String(error);
    const isBlockedLiveCall = error instanceof GooglePlacesLiveCallBlockedError;

    providerAttempts.push({
      provider: "google_places",
      status: isBlockedLiveCall ? "blocked" : "error",
      detail: isBlockedLiveCall
        ? "Live Google Places calls are disabled and no cached Google result exists."
        : `Google Places lookup failed: ${message}`,
    });

    nextPlace = {
      ...currentPlace,
      googleMapsUrl: trimmedGoogleMapsUrl,
      lastChecked: new Date().toISOString().slice(0, 10),
      samePlaceDecision: "Unsure",
      samePlaceReason: "Google Maps URL could not be resolved.",
      verificationDecision: "no_candidate_found",
      verificationSource: "google_maps_url",
      verifiedStatus: "Review",
      verificationNotes: [
        currentPlace.verificationNotes,
        isBlockedLiveCall
          ? message
          : `Google Maps URL could not be resolved: ${message}`,
      ]
        .filter(Boolean)
        .join("\n"),
    };
    }
  }

  const nextPlaces = currentPlaces.map((place) =>
    place.id === id ? (nextPlace as Place) : place,
  );

  writeProductionPlaces(nextPlaces);

  return {
    candidateSummaries,
    counters: access.counters,
    freeCounters: freeAccess.counters,
    place: nextPlace,
    places: nextPlaces,
    providerAttempts,
  };
}
