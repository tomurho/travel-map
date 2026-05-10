import { readFileSync, writeFileSync } from "node:fs";

import {
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

export async function resolveGoogleMapsUrlForProductionPlace(
  id: string,
  googleMapsUrl: string,
  apiKey: string,
  options: {
    access?: GooglePlacesAccess;
    fetcher?: typeof fetch;
  } = {},
) {
  const currentPlaces = readProductionPlaces();
  const placeIndex = currentPlaces.findIndex((place) => place.id === id);

  if (placeIndex === -1) {
    return { error: "Production place was not found." };
  }

  const currentPlace = currentPlaces[placeIndex];
  const trimmedGoogleMapsUrl = googleMapsUrl.trim();

  if (!currentPlace || !trimmedGoogleMapsUrl) {
    return { error: "Google Maps URL is required." };
  }

  const placeForResolution: Place = {
    ...currentPlace,
    address: currentPlace.canonicalAddress?.trim() || currentPlace.address,
    googleMapsUrl: trimmedGoogleMapsUrl,
  };
  let nextPlace: Place;
  const access = options.access ?? new GooglePlacesAccess();

  try {
    const searchResult = await fetchCandidatesFromGoogleMapsUrl(
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
    nextPlace = addSingleFallbackCandidateForReview(
      nextPlace,
      placeForResolution,
      searchResult,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isBlockedLiveCall = error instanceof GooglePlacesLiveCallBlockedError;

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

  const nextPlaces = currentPlaces.map((place) =>
    place.id === id ? nextPlace : place,
  );

  writeProductionPlaces(nextPlaces);

  return {
    counters: access.counters,
    place: nextPlace,
    places: nextPlaces,
  };
}
