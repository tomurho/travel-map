import type { Place, PlaceStatus, PlaceVerifiedStatus } from "@/lib/place";

export type SpreadsheetRow = Record<string, unknown>;

type NormalizedResult =
  | { ok: true; place: Place }
  | { ok: false; reason: string };

export type ImportIdMatchStrategy =
  | "city_name_address"
  | "city_name"
  | "city_address";

export interface AmbiguousIdMatch {
  city: string;
  generatedId: string;
  locationName: string;
  matchStrategy: ImportIdMatchStrategy;
  possibleIds: string[];
}

export interface ImportMigrationReport {
  ambiguousIdMatches: AmbiguousIdMatch[];
  idChangesAvoided: number;
  idsPreserved: number;
  newIdsGenerated: number;
}

export interface NormalizePlacesOptions {
  existingPlaces?: Place[];
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeMatchText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{Letter}\p{Number}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function readText(row: SpreadsheetRow, keys: string[]) {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }

  return "";
}

function readNumber(row: SpreadsheetRow, keys: string[]) {
  const raw = readText(row, keys);
  if (!raw) {
    return null;
  }

  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeStatus(value: string): PlaceStatus | null {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "location";
  }

  if (normalized === "location" || normalized === "place") {
    return "location";
  }

  if (
    normalized === "been" ||
    normalized === "visited" ||
    normalized === "been to" ||
    normalized === "been there" ||
    normalized === "done" ||
    normalized === "loved" ||
    normalized === "loved it"
  ) {
    return "been";
  }

  if (
    normalized === "want to go" ||
    normalized === "want_to_go" ||
    normalized === "wishlist" ||
    normalized === "bucket list"
  ) {
    return "want_to_go";
  }

  if (
    normalized.startsWith("resolved via ") ||
    normalized.startsWith("re-verified via ") ||
    normalized.startsWith("tabelog listing ")
  ) {
    return "location";
  }

  return null;
}

function normalizeLoved(value: string, status: PlaceStatus): boolean | null {
  if (status !== "been") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (["yes", "y", "true", "loved", "loved it"].includes(normalized)) {
    return true;
  }

  return null;
}

export function normalizeVerifiedStatus(value: string): PlaceVerifiedStatus {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    return "";
  }

  if (normalized === "yes" || normalized === "verified") {
    return "Yes";
  }

  if (normalized === "review" || normalized === "needs review") {
    return "Review";
  }

  if (normalized === "no" || normalized === "unverified") {
    return "No";
  }

  if (
    normalized === "closed/moved" ||
    normalized === "closed" ||
    normalized === "moved" ||
    normalized === "inactive"
  ) {
    return "Closed/Moved";
  }

  return "Review";
}

export function normalizeArea(city: string, value: string) {
  const area = value.trim();

  if (city.trim().toLowerCase() !== "taipei") {
    return area;
  }

  return area
    .replace(/\s+District$/i, "")
    .replace(/^Daan$/i, "Da’an")
    .replace(/^Da['’]an$/i, "Da’an")
    .trim();
}

export function normalizePlaceRow(row: SpreadsheetRow): NormalizedResult {
  const name = readText(row, [
    "location name",
    "Location Name",
    "name",
    "location",
    "Location",
  ]);
  const city = readText(row, ["city", "City"]) || "Uncategorized";
  const category =
    readText(row, ["category", "Category", "Verified Category", "type"]) ||
    "Uncategorized";
  const statusRaw = readText(row, ["status", "Status"]);
  const rawDistrict = readText(row, [
    "district/neighborhood",
    "District/Neighborhood",
    "district",
    "neighborhood",
    "Area",
    "area",
  ]);
  const address = readText(row, ["address", "Address"]);
  const latitude = readNumber(row, ["latitude", "Latitude", "lat"]);
  const longitude = readNumber(row, ["longitude", "Longitude", "lng", "lon"]);
  const tabelog = readText(row, ["Tabelog Score", "tabelog score", "tabelog", "Tabelog"]);
  const subway = readText(row, ["Nearest Subway", "nearest subway", "subway", "Subway"]);
  const googleMapsUrl = readText(row, [
    "Google Maps URL",
    "google maps url",
    "googleMapsUrl",
    "google maps link",
  ]);
  const googlePlaceId = readText(row, [
    "Google Place ID",
    "Google Place Id",
    "googlePlaceId",
    "place id",
  ]);
  const canonicalName = readText(row, [
    "Canonical Name",
    "canonical name",
    "canonicalName",
  ]);
  const canonicalAddress = readText(row, [
    "Canonical Address",
    "canonical address",
    "canonicalAddress",
  ]);
  const verifiedLatitude = readNumber(row, [
    "Verified Latitude",
    "verified latitude",
    "verifiedLatitude",
  ]);
  const verifiedLongitude = readNumber(row, [
    "Verified Longitude",
    "verified longitude",
    "verifiedLongitude",
  ]);
  const distanceDeltaMeters = readNumber(row, [
    "Distance Delta Meters",
    "distance delta meters",
    "distanceDeltaMeters",
  ]);
  const businessStatus = readText(row, [
    "Business Status",
    "business status",
    "businessStatus",
  ]);
  const matchConfidence = readNumber(row, [
    "Match Confidence",
    "match confidence",
    "matchConfidence",
  ]);
  const samePlaceDecision = readText(row, [
    "Same Place Decision",
    "same place decision",
    "samePlaceDecision",
  ]) as Place["samePlaceDecision"];
  const samePlaceReason = readText(row, [
    "Same Place Reason",
    "same place reason",
    "samePlaceReason",
  ]);
  const verificationDecision = readText(row, [
    "Verification Decision",
    "verification decision",
    "verificationDecision",
  ]) as Place["verificationDecision"];
  const verificationSource = readText(row, [
    "Verification Source",
    "verification source",
    "verificationSource",
  ]) as Place["verificationSource"];
  const nameScore = readNumber(row, ["Name Score", "name score", "nameScore"]);
  const addressScore = readNumber(row, [
    "Address Score",
    "address score",
    "addressScore",
  ]);
  const cityScore = readNumber(row, ["City Score", "city score", "cityScore"]);
  const districtScore = readNumber(row, [
    "District Score",
    "district score",
    "districtScore",
  ]);
  const countryScore = readNumber(row, [
    "Country Score",
    "country score",
    "countryScore",
  ]);
  const ambiguityScore = readNumber(row, [
    "Ambiguity Score",
    "ambiguity score",
    "ambiguityScore",
  ]);
  const verifiedStatus = normalizeVerifiedStatus(
    readText(row, ["Verified?", "verified?", "Verified", "verifiedStatus"]),
  );
  const lastChecked = readText(row, [
    "Last Checked",
    "last checked",
    "lastChecked",
  ]);
  const verificationNotes = readText(row, [
    "Verification Notes",
    "verification notes",
    "verificationNotes",
  ]);
  const district = normalizeArea(city, rawDistrict);

  if (!name) {
    return { ok: false, reason: "Missing location name." };
  }

  const status = normalizeStatus(statusRaw);
  if (!status) {
    return { ok: false, reason: `Invalid status for "${name}".` };
  }

  if (latitude === null || longitude === null) {
    return { ok: false, reason: `Invalid coordinates for "${name}".` };
  }

  const loved = normalizeLoved(
    readText(row, ["loved it", "Loved it", "loved", "favorite"]) || statusRaw,
    status,
  );
  const coordinateFallback = `${latitude.toFixed(4)}-${longitude.toFixed(4)}`;
  const idBase = [name, address || district || coordinateFallback]
    .filter(Boolean)
    .join("-");

  return {
    ok: true,
    place: {
      id: slugify(idBase) || coordinateFallback,
      name,
      city,
      category,
      status,
      loved,
      district,
      address,
      latitude,
      longitude,
      tabelog,
      subway,
      googleMapsUrl,
      googlePlaceId,
      canonicalName,
      canonicalAddress,
      verifiedLatitude: verifiedLatitude ?? undefined,
      verifiedLongitude: verifiedLongitude ?? undefined,
      distanceDeltaMeters: distanceDeltaMeters ?? undefined,
      businessStatus,
      matchConfidence: matchConfidence ?? undefined,
      samePlaceDecision:
        samePlaceDecision === "Yes" ||
        samePlaceDecision === "No" ||
        samePlaceDecision === "Unsure"
          ? samePlaceDecision
          : undefined,
      samePlaceReason,
      verificationDecision:
        verificationDecision === "auto_verified_small_delta" ||
        verificationDecision === "auto_corrected_large_delta" ||
        verificationDecision === "auto_corrected_from_google_url" ||
        verificationDecision === "auto_corrected_from_place_id" ||
        verificationDecision === "auto_corrected_from_text_search" ||
        verificationDecision === "candidate_only_review" ||
        verificationDecision === "ambiguous_multiple_candidates" ||
        verificationDecision === "no_candidate_found" ||
        verificationDecision === "closed_or_moved"
          ? verificationDecision
          : undefined,
      verificationSource:
        verificationSource === "place_id" ||
        verificationSource === "google_maps_url" ||
        verificationSource === "text_search"
          ? verificationSource
          : undefined,
      nameScore: nameScore ?? undefined,
      addressScore: addressScore ?? undefined,
      cityScore: cityScore ?? undefined,
      districtScore: districtScore ?? undefined,
      countryScore: countryScore ?? undefined,
      ambiguityScore: ambiguityScore ?? undefined,
      verifiedStatus,
      lastChecked,
      verificationNotes,
    },
  };
}

function pushIndex(
  indexes: Map<string, Place[]>,
  keyParts: string[],
  place: Place,
) {
  if (keyParts.some((part) => !part)) {
    return;
  }

  const key = keyParts.join("\u0000");
  indexes.set(key, [...(indexes.get(key) ?? []), place]);
}

function buildExistingPlaceIndexes(existingPlaces: Place[] = []) {
  const byCityNameAddress = new Map<string, Place[]>();
  const byCityName = new Map<string, Place[]>();
  const byCityAddress = new Map<string, Place[]>();

  for (const place of existingPlaces) {
    const city = normalizeMatchText(place.city);
    const name = normalizeMatchText(place.name);
    const address = normalizeMatchText(place.address);

    pushIndex(byCityNameAddress, [city, name, address], place);
    pushIndex(byCityName, [city, name], place);
    pushIndex(byCityAddress, [city, address], place);
  }

  return { byCityAddress, byCityName, byCityNameAddress };
}

function resolveExistingPlaceId(
  place: Place,
  indexes: ReturnType<typeof buildExistingPlaceIndexes>,
) {
  const city = normalizeMatchText(place.city);
  const name = normalizeMatchText(place.name);
  const address = normalizeMatchText(place.address);
  const matchAttempts: Array<{
    candidates: Place[];
    strategy: ImportIdMatchStrategy;
  }> = [
    {
      candidates: indexes.byCityNameAddress.get(
        [city, name, address].join("\u0000"),
      ) ?? [],
      strategy: "city_name_address",
    },
    {
      candidates: indexes.byCityName.get([city, name].join("\u0000")) ?? [],
      strategy: "city_name",
    },
    {
      candidates: indexes.byCityAddress.get([city, address].join("\u0000")) ?? [],
      strategy: "city_address",
    },
  ];

  for (const attempt of matchAttempts) {
    if (attempt.candidates.length === 1) {
      return {
        ambiguous: false as const,
        place: attempt.candidates[0],
        strategy: attempt.strategy,
      };
    }

    if (attempt.candidates.length > 1) {
      return {
        ambiguous: true as const,
        candidates: attempt.candidates,
        strategy: attempt.strategy,
      };
    }
  }

  return null;
}

export function normalizePlaces(
  rows: SpreadsheetRow[],
  options: NormalizePlacesOptions = {},
) {
  const errors: string[] = [];
  const existingIndexes = buildExistingPlaceIndexes(options.existingPlaces);
  const migrationReport: ImportMigrationReport = {
    ambiguousIdMatches: [],
    idChangesAvoided: 0,
    idsPreserved: 0,
    newIdsGenerated: 0,
  };
  const reportedAmbiguousMatches = new Set<string>();
  const seen = new Map<string, number>();
  const places: Place[] = [];

  for (const row of rows) {
    const normalized = normalizePlaceRow(row);

    if (!normalized.ok) {
      errors.push(normalized.reason);
      continue;
    }

    const generatedId = normalized.place.id;
    const existingMatch = resolveExistingPlaceId(
      normalized.place,
      existingIndexes,
    );
    let baseId = generatedId;

    if (existingMatch?.ambiguous) {
      const possibleIds = existingMatch.candidates.map((candidate) => candidate.id);
      const ambiguousKey = [
        normalized.place.city,
        normalized.place.name,
        existingMatch.strategy,
        possibleIds.join("|"),
      ].join("\u0000");

      if (!reportedAmbiguousMatches.has(ambiguousKey)) {
        reportedAmbiguousMatches.add(ambiguousKey);
        migrationReport.ambiguousIdMatches.push({
          city: normalized.place.city,
          generatedId,
          locationName: normalized.place.name,
          matchStrategy: existingMatch.strategy,
          possibleIds,
        });
      }
      migrationReport.newIdsGenerated += 1;
    } else if (existingMatch) {
      baseId = existingMatch.place.id;
      migrationReport.idsPreserved += 1;

      if (baseId !== generatedId) {
        migrationReport.idChangesAvoided += 1;
      }
    } else {
      migrationReport.newIdsGenerated += 1;
    }

    const duplicateCount = seen.get(baseId) ?? 0;
    seen.set(baseId, duplicateCount + 1);

    places.push({
      ...normalized.place,
      id:
        duplicateCount === 0
          ? baseId
          : `${baseId}-${duplicateCount + 1}`,
    });
  }

  return { errors, migrationReport, places };
}
