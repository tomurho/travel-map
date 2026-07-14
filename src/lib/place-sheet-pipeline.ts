import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";

import type { OAuth2Client } from "google-auth-library";

import {
  appendValues,
  assertSheetExists,
  batchUpdateValues,
  columnName,
  createGoogleSheetsAuthClient,
  ensureSheet,
  getSpreadsheetMetadata,
  mapSheetRowToObject,
  normalizeSheetHeader,
  quoteSheetName,
  readMappedSheetField,
  readValues,
  updateValues,
} from "@/lib/google-sheets-oauth";
import type { Place, PlaceStatus, PlaceVerifiedStatus } from "@/lib/place";
import {
  readPlacesJsonSnapshot,
  writePlacesJsonAtomic,
} from "@/lib/places-json-store";

const CAPTURE_TAB = "Capture";
const REVIEW_TAB = "Review";
const API_USAGE_TAB = "API Usage";
const PUBLISHED_TAB = "Published";
const AUDIT_TAB = "Audit";
const READY_INTAKE_STATUS = "Ready";
const PLACES_JSON_PATH = path.resolve(process.cwd(), "src/data/places.json");

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const PLACES_DETAILS_URL = "https://places.googleapis.com/v1/places";
const PLACES_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.businessStatus",
  "places.types",
].join(",");

type GooglePlaceCandidate = {
  businessStatus?: string;
  formattedAddress?: string;
  googleMapsUri?: string;
  id?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
  displayName?: {
    text?: string;
  };
  types?: string[];
};

type GoogleTextSearchResponse = {
  places?: GooglePlaceCandidate[];
};

type SheetRow = {
  fields: Record<string, string>;
  rowNumber: number;
  values: string[];
};

type NormalizedPublishedRow =
  | {
      ok: true;
      place: Place;
      rowNumber: number;
    }
  | {
      errors: string[];
      id: string;
      ok: false;
      rowNumber: number;
    };

export type EnrichReadyRowsOptions = {
  confirmLiveApi: boolean;
  maxApiCalls: number | null;
  sheetId: string;
};

export type PublishApprovedRowsOptions = {
  dryRun?: boolean;
  sheetId: string;
  write?: boolean;
};

export type SyncPublishedToAppOptions = {
  allowPartial?: boolean;
  dryRun?: boolean;
  sheetId: string;
  write?: boolean;
};

export type PlacePipelineStatus = {
  appChanges: number;
  capture: {
    enriched: number;
    new: number;
    other: number;
    ready: number;
    total: number;
  };
  fetchedAt: string;
  published: {
    total: number;
    verified: number;
  };
  readyToPublish: number;
  recommendedAction:
    | "fix_errors"
    | "mark_ready"
    | "process_ready"
    | "publish_verified"
    | "up_to_date"
    | "update_app"
    | "verify_candidates";
  review: {
    candidate: number;
    other: number;
    total: number;
    verified: number;
  };
  validationErrors: number;
};

export type ExportPlacesToAuditOptions = {
  city: string;
  sheetId: string;
};

export type LookupAuditCandidatesOptions = {
  confirmLiveApi: boolean;
  maxApiCalls: number | null;
  sheetId: string;
};

export type ApplyAuditUpdatesOptions = {
  dryRun?: boolean;
  sheetId: string;
  write?: boolean;
};

export type ScreenshotCaptureRow = {
  cityHint: string;
  countryHint: string;
  rawName: string;
  rawText: string;
  sourceScreenshot?: string;
};

const REVIEW_REQUIRED_PREFIX = [
  "id",
  "rawName",
  "candidateName",
  "candidateAddress",
  "candidateLatitude",
  "candidateLongitude",
  "candidateGoogleMapsUrl",
  "candidateGooglePlaceId",
  "category",
  "area",
  "city",
  "status",
  "loved",
  "notes",
  "reviewStatus",
];
const REVIEW_HEADERS = [...REVIEW_REQUIRED_PREFIX, "intakeKey"];

const PUBLISHED_HEADERS = [
  "id",
  "name",
  "category",
  "area",
  "city",
  "address",
  "latitude",
  "longitude",
  "googleMapsUrl",
  "googlePlaceId",
  "status",
  "loved",
  "notes",
  "verifiedStatus",
  "lastChecked",
];

const AUDIT_HEADERS = [
  "id",
  "currentName",
  "currentCity",
  "currentCountry",
  "currentCategory",
  "currentArea",
  "currentAddress",
  "currentLatitude",
  "currentLongitude",
  "currentGoogleMapsUrl",
  "currentGooglePlaceId",
  "currentStatus",
  "currentLoved",
  "currentNotes",
  "candidateName",
  "candidateAddress",
  "candidateLatitude",
  "candidateLongitude",
  "candidateGoogleMapsUrl",
  "candidateGooglePlaceId",
  "candidateCategory",
  "candidateDistanceMeters",
  "auditStatus",
  "auditNotes",
  "lastAudited",
];

const API_USAGE_HEADERS = [
  "timestamp",
  "provider",
  "endpoint",
  "apiCalls",
  "maxApiCalls",
  "sheetId",
  "captureRow",
  "query",
  "candidateCount",
  "status",
  "error",
];
const CAPTURE_NAME_HEADERS = [
  "rawName",
  "name",
  "locationName",
  "location",
  "placeName",
];
const CITY_HINT_HEADERS = ["cityHint", "city"];
const COUNTRY_HINT_HEADERS = ["countryHint", "country"];
const AREA_HINT_HEADERS = ["areaHint", "districtHint"];
const REQUIRED_SCREENSHOT_CAPTURE_HEADERS = [
  "rawName",
  "rawText",
  "sourceType",
  "cityHint",
  "countryHint",
  "intakeStatus",
];

function assertNotPublishedRange(range: string) {
  const trimmedRange = range.trim();
  const unquotedPublishedPrefix = `${PUBLISHED_TAB}!`;
  const quotedPublishedPrefix = `${quoteSheetName(PUBLISHED_TAB)}!`;

  if (
    trimmedRange === PUBLISHED_TAB ||
    trimmedRange.startsWith(unquotedPublishedPrefix) ||
    trimmedRange.startsWith(quotedPublishedPrefix)
  ) {
    throw new Error("Refusing to write to Published.");
  }
}

function indexHeaders(headerRow: string[]) {
  const headers = new Map<string, number>();

  headerRow.forEach((header, index) => {
    const normalized = normalizeSheetHeader(String(header ?? ""));

    if (normalized && !headers.has(normalized)) {
      headers.set(normalized, index);
    }
  });

  return headers;
}

function getHeaderIndex(headers: Map<string, number>, names: string[]) {
  for (const name of names) {
    const index = headers.get(normalizeSheetHeader(name));

    if (index !== undefined) {
      return index;
    }
  }

  return undefined;
}

function readByHeader(
  row: string[],
  headers: Map<string, number>,
  names: string[],
) {
  const index = getHeaderIndex(headers, names);

  return index === undefined ? "" : String(row[index] ?? "").trim();
}

async function appendNonPublishedValues(
  authClient: OAuth2Client,
  sheetId: string,
  range: string,
  values: string[][],
) {
  assertNotPublishedRange(range);
  await appendValues(authClient, sheetId, range, values);
}

async function updateNonPublishedValues(
  authClient: OAuth2Client,
  sheetId: string,
  range: string,
  values: string[][],
) {
  assertNotPublishedRange(range);
  await updateValues(authClient, sheetId, range, values);
}

async function ensureHeaders(
  authClient: OAuth2Client,
  sheetId: string,
  sheetName: string,
  requiredHeaders: string[],
) {
  const range = `${quoteSheetName(sheetName)}!1:1`;
  const values = await readValues(authClient, sheetId, range);
  const existingHeaders = (values[0] ?? []).map((value) => String(value ?? ""));

  if (existingHeaders.length === 0) {
    await updateNonPublishedValues(
      authClient,
      sheetId,
      `${quoteSheetName(sheetName)}!A1:${columnName(requiredHeaders.length - 1)}1`,
      [requiredHeaders],
    );
    return requiredHeaders;
  }

  const normalizedExisting = new Set(existingHeaders.map(normalizeSheetHeader));
  const missingHeaders = requiredHeaders.filter(
    (header) => !normalizedExisting.has(normalizeSheetHeader(header)),
  );

  if (missingHeaders.length === 0) {
    return existingHeaders;
  }

  const nextHeaders = [...existingHeaders, ...missingHeaders];
  await updateNonPublishedValues(
    authClient,
    sheetId,
    `${quoteSheetName(sheetName)}!A1:${columnName(nextHeaders.length - 1)}1`,
    [nextHeaders],
  );

  return nextHeaders;
}

async function getReviewHeaders(authClient: OAuth2Client, sheetId: string) {
  const values = await readValues(
    authClient,
    sheetId,
    `${quoteSheetName(REVIEW_TAB)}!1:1`,
  );
  const existingHeaders = (values[0] ?? []).map((value) => String(value ?? ""));
  const normalizedExistingHeaders = existingHeaders
    .slice(0, REVIEW_REQUIRED_PREFIX.length)
    .map(normalizeSheetHeader);
  const normalizedReviewHeaders = REVIEW_REQUIRED_PREFIX.map(normalizeSheetHeader);
  const hasAgreedHeaderPrefix = normalizedReviewHeaders.every(
    (header, index) => normalizedExistingHeaders[index] === header,
  );

  if (!hasAgreedHeaderPrefix) {
    throw new Error(
      `Review tab must already contain the agreed schema in columns A:${columnName(
        REVIEW_REQUIRED_PREFIX.length - 1,
      )}: ${REVIEW_REQUIRED_PREFIX.join(", ")}`,
    );
  }

  return ensureHeaders(
    authClient,
    sheetId,
    REVIEW_TAB,
    REVIEW_HEADERS,
  );
}

function requireHeaders(
  sheetName: string,
  actualHeaders: string[],
  requiredHeaders: string[],
) {
  const actual = new Set(actualHeaders.map(normalizeSheetHeader));
  const missing = requiredHeaders.filter(
    (header) => !actual.has(normalizeSheetHeader(header)),
  );

  if (missing.length > 0) {
    throw new Error(
      `${sheetName} is missing required column(s): ${missing.join(", ")}`,
    );
  }
}

function rowFromRecord(headers: string[], record: Record<string, unknown>) {
  return headers.map((header) => {
    const value = record[header];

    if (value === undefined || value === null) {
      return "";
    }

    return String(value);
  });
}

function normalizeText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugifyIdPart(value: string, fallback: string) {
  const slug = normalizeText(value).replace(/\s+/g, "_");

  return slug || fallback;
}

function buildGeneratedPlaceId(input: {
  cityHint: string;
  rawName: string;
  rowNumber: number;
}) {
  const nameSlug = slugifyIdPart(input.rawName, "");

  if (!input.rawName.trim()) {
    throw new Error("Cannot generate a place id without rawName.");
  }

  if (!nameSlug) {
    return `place_${slugifyIdPart(input.cityHint, "unknown_city")}_row_${
      input.rowNumber
    }`;
  }

  return `place_${slugifyIdPart(input.cityHint, "unknown_city")}_${nameSlug}`;
}

async function readPlacesJsonIds() {
  try {
    const places = JSON.parse(await fs.readFile(PLACES_JSON_PATH, "utf8")) as Place[];

    return places
      .map((place) => place.id)
      .filter((id): id is string => Boolean(id?.trim()));
  } catch {
    return [];
  }
}

function readIdsFromSheetValues(values: string[][]) {
  const headers = values[0] ?? [];

  if (headers.length === 0) {
    return [];
  }

  return values
    .slice(1)
    .map((row) => readMappedSheetField(mapSheetRowToObject(headers, row), ["id"]))
    .filter(Boolean);
}

function getCollisionSafeId(baseId: string, existingIds: Set<string>) {
  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let suffix = 2;
  let nextId = `${baseId}_${suffix}`;

  while (existingIds.has(nextId)) {
    suffix += 1;
    nextId = `${baseId}_${suffix}`;
  }

  return nextId;
}

export async function appendScreenshotRowsToCapture(input: {
  rows: ScreenshotCaptureRow[];
  sheetId: string;
}) {
  if (!input.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  const rows = input.rows
    .map((row) => ({
      ...row,
      rawName: row.rawName.trim(),
      rawText: row.rawText.trim(),
      cityHint: row.cityHint.trim(),
      countryHint: row.countryHint.trim(),
      sourceScreenshot: row.sourceScreenshot?.trim() ?? "",
    }))
    .filter((row) => row.rawName);

  if (rows.length === 0) {
    return { results: [], rowsCreated: 0, rowsSkipped: input.rows.length };
  }

  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, input.sheetId);
  assertSheetExists(metadata, CAPTURE_TAB);

  const captureValues = await readValues(
    sheetsAuthClient,
    input.sheetId,
    `${quoteSheetName(CAPTURE_TAB)}!A1:ZZ`,
  );
  const captureHeaders = (captureValues[0] ?? []).map((value) =>
    String(value ?? ""),
  );
  requireHeaders(
    CAPTURE_TAB,
    captureHeaders,
    REQUIRED_SCREENSHOT_CAPTURE_HEADERS,
  );

  const existingKeys = new Set(
    captureValues.slice(1).map((values) =>
      buildCaptureIntakeKey(mapSheetRowToObject(captureHeaders, values)),
    ),
  );
  const timestamp = new Date().toISOString();
  const results: Array<{
    intakeKey: string;
    rawName: string;
    sourceScreenshot: string;
    status: "created" | "duplicate";
  }> = [];
  const values: string[][] = [];

  for (const row of rows) {
    const fields = {
      cityHint: row.cityHint,
      countryHint: row.countryHint,
      rawName: row.rawName,
      rawText: row.rawText,
      sourceScreenshot: row.sourceScreenshot,
    };
    const intakeKey = buildCaptureIntakeKey(fields);

    if (existingKeys.has(intakeKey)) {
      results.push({
        intakeKey,
        rawName: row.rawName,
        sourceScreenshot: row.sourceScreenshot,
        status: "duplicate",
      });
      continue;
    }

    existingKeys.add(intakeKey);
    values.push(rowFromRecord(captureHeaders, {
      rawName: row.rawName,
      rawText: row.rawText,
      sourceType: "Screenshot",
      sourceScreenshot: row.sourceScreenshot,
      cityHint: row.cityHint,
      countryHint: row.countryHint,
      notes: row.sourceScreenshot
        ? `Source screenshot: ${row.sourceScreenshot}`
        : "",
      intakeStatus: "New",
      createdAt: timestamp,
    }));
    results.push({
      intakeKey,
      rawName: row.rawName,
      sourceScreenshot: row.sourceScreenshot,
      status: "created",
    });
  }

  if (values.length > 0) {
    await appendNonPublishedValues(
      sheetsAuthClient,
      input.sheetId,
      `${quoteSheetName(CAPTURE_TAB)}!A:${columnName(captureHeaders.length - 1)}`,
      values,
    );
  }

  return {
    results,
    rowsCreated: values.length,
    rowsSkipped: input.rows.length - values.length,
  };
}

function formatPlaceNotes(notes: Place["notes"]) {
  if (Array.isArray(notes)) {
    return notes.join(" | ");
  }

  return notes ?? "";
}

function buildAuditRecord(place: Place) {
  return {
    id: place.id,
    currentName: place.name,
    currentCity: place.city,
    currentCountry: "",
    currentCategory: place.category,
    currentArea: place.district,
    currentAddress: place.address,
    currentLatitude: place.latitude,
    currentLongitude: place.longitude,
    currentGoogleMapsUrl: place.googleMapsUrl ?? "",
    currentGooglePlaceId: place.googlePlaceId ?? "",
    currentStatus: place.status,
    currentLoved:
      place.loved === null || place.loved === undefined ? "" : String(place.loved),
    currentNotes: formatPlaceNotes(place.notes),
    candidateName: "",
    candidateAddress: "",
    candidateLatitude: "",
    candidateLongitude: "",
    candidateGoogleMapsUrl: "",
    candidateGooglePlaceId: "",
    candidateCategory: "",
    candidateDistanceMeters: "",
    auditStatus: "Queued",
    auditNotes: "",
    lastAudited: "",
  };
}

async function getAuditHeaders(authClient: OAuth2Client, sheetId: string) {
  const range = `${quoteSheetName(AUDIT_TAB)}!1:1`;
  const values = await readValues(authClient, sheetId, range);
  const existingHeaders = (values[0] ?? []).map((value) => String(value ?? ""));

  if (existingHeaders.length === 0) {
    await updateNonPublishedValues(
      authClient,
      sheetId,
      `${quoteSheetName(AUDIT_TAB)}!A1:${columnName(AUDIT_HEADERS.length - 1)}1`,
      [AUDIT_HEADERS],
    );
    return AUDIT_HEADERS;
  }

  const normalizedExistingHeaders = existingHeaders
    .slice(0, AUDIT_HEADERS.length)
    .map(normalizeSheetHeader);
  const normalizedAuditHeaders = AUDIT_HEADERS.map(normalizeSheetHeader);
  const hasExpectedHeaderPrefix = normalizedAuditHeaders.every(
    (header, index) => normalizedExistingHeaders[index] === header,
  );

  if (!hasExpectedHeaderPrefix) {
    throw new Error(
      `Audit tab header does not match expected v1 schema in columns A:${columnName(
        AUDIT_HEADERS.length - 1,
      )}. Expected: ${AUDIT_HEADERS.join(", ")}`,
    );
  }

  return AUDIT_HEADERS;
}

export async function exportPlacesToAudit(options: ExportPlacesToAuditOptions) {
  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  const city = options.city?.trim();

  if (!city) {
    throw new Error("--city is required.");
  }

  const productionSnapshot = readPlacesJsonSnapshot(PLACES_JSON_PATH);
  const currentPlaces = productionSnapshot.places;
  const matchingPlaces = currentPlaces.filter(
    (place) => place.city.toLowerCase() === city.toLowerCase(),
  );
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, options.sheetId);

  await ensureSheet(sheetsAuthClient, options.sheetId, metadata, AUDIT_TAB);

  const auditHeaders = await getAuditHeaders(sheetsAuthClient, options.sheetId);
  const auditRows = await readValues(
    sheetsAuthClient,
    options.sheetId,
    `${quoteSheetName(AUDIT_TAB)}!A1:ZZ`,
  );
  const existingAuditIds = new Set(readIdsFromSheetValues(auditRows));
  const rowsToAppend = matchingPlaces
    .filter((place) => !existingAuditIds.has(place.id))
    .map((place) => rowFromRecord(auditHeaders, buildAuditRecord(place)));
  const skippedDuplicateIds = matchingPlaces
    .filter((place) => existingAuditIds.has(place.id))
    .map((place) => place.id);

  if (rowsToAppend.length > 0) {
    await appendNonPublishedValues(
      sheetsAuthClient,
      options.sheetId,
      `${quoteSheetName(AUDIT_TAB)}!A:${columnName(auditHeaders.length - 1)}`,
      rowsToAppend,
    );
  }

  console.log("Audit export summary");
  console.table({
    city,
    rowsMatched: matchingPlaces.length,
    rowsExported: rowsToAppend.length,
    duplicatesSkipped: skippedDuplicateIds.length,
  });

  return {
    city,
    duplicatesSkipped: skippedDuplicateIds.length,
    rowsExported: rowsToAppend.length,
    rowsMatched: matchingPlaces.length,
    skippedDuplicateIds,
  };
}

function inferCategoryFromTypes(types: string[] = []) {
  const normalizedTypes = new Set(types.map(normalizeText));

  if (normalizedTypes.has("coffee shop") || normalizedTypes.has("cafe")) {
    return "Cafe";
  }

  if (normalizedTypes.has("restaurant")) {
    return "Restaurant";
  }

  if (normalizedTypes.has("bar")) {
    return "Bar";
  }

  if (normalizedTypes.has("lodging")) {
    return "Hotel";
  }

  if (normalizedTypes.has("bakery")) {
    return "Bakery";
  }

  if (normalizedTypes.has("store")) {
    return "Shop";
  }

  if (
    normalizedTypes.has("tourist attraction") ||
    normalizedTypes.has("museum") ||
    normalizedTypes.has("shrine") ||
    normalizedTypes.has("temple")
  ) {
    return "Sight";
  }

  return "";
}

function buildPlaceQuery(row: SheetRow) {
  const rawName = readMappedSheetField(row.fields, CAPTURE_NAME_HEADERS);
  const cityHint = readMappedSheetField(row.fields, CITY_HINT_HEADERS);
  const countryHint = readMappedSheetField(row.fields, COUNTRY_HINT_HEADERS);
  const locationHints = [cityHint, countryHint].filter(Boolean);

  return [rawName, ...locationHints].filter(Boolean).join(", ");
}

export function buildCaptureIntakeKey(fields: Record<string, string>) {
  const identity = [
    readMappedSheetField(fields, CAPTURE_NAME_HEADERS),
    readMappedSheetField(fields, CITY_HINT_HEADERS),
    readMappedSheetField(fields, COUNTRY_HINT_HEADERS),
    readMappedSheetField(fields, ["rawText"]),
    readMappedSheetField(fields, ["sourceScreenshot"]),
  ]
    .map(normalizeText)
    .join("\u0000");

  return `capture_${createHash("sha256").update(identity).digest("hex").slice(0, 20)}`;
}

export function shouldReconcileCapture(
  existingReviewIntakeKeys: ReadonlySet<string>,
  fields: Record<string, string>,
) {
  return existingReviewIntakeKeys.has(buildCaptureIntakeKey(fields));
}

function buildLocationBias(row: string[], headers: Map<string, number>) {
  const latitude = Number(readByHeader(row, headers, ["latitude", "lat"]));
  const longitude = Number(readByHeader(row, headers, ["longitude", "lng", "lon"]));

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return undefined;
  }

  return {
    circle: {
      center: { latitude, longitude },
      radius: 10000,
    },
  };
}

async function searchGooglePlaces(input: {
  apiKey: string;
  query: string;
  row: string[];
  headers: Map<string, number>;
}) {
  const response = await fetch(PLACES_TEXT_SEARCH_URL, {
    body: JSON.stringify({
      locationBias: buildLocationBias(input.row, input.headers),
      pageSize: 5,
      textQuery: input.query,
    }),
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": input.apiKey,
      "X-Goog-FieldMask": PLACES_FIELD_MASK,
    },
    method: "POST",
  });

  if (!response.ok) {
    throw new Error(`Google Places API ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as GoogleTextSearchResponse;
}

async function fetchGooglePlaceDetails(input: {
  apiKey: string;
  placeId: string;
}) {
  const placeId = input.placeId.replace(/^places\//, "").trim();
  const response = await fetch(
    `${PLACES_DETAILS_URL}/${encodeURIComponent(placeId)}`,
    {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": input.apiKey,
        "X-Goog-FieldMask": PLACES_FIELD_MASK.replace(/places\./g, ""),
      },
      method: "GET",
    },
  );

  if (!response.ok) {
    throw new Error(`Google Places API ${response.status}: ${await response.text()}`);
  }

  return (await response.json()) as GooglePlaceCandidate;
}

function buildAuditSearchQuery(row: SheetRow) {
  return [
    readMappedSheetField(row.fields, ["currentName"]),
    readMappedSheetField(row.fields, ["currentCity"]),
    readMappedSheetField(row.fields, ["currentCountry"]),
  ]
    .filter(Boolean)
    .join(", ");
}

function readCoordinateField(row: SheetRow, names: string[]) {
  const value = Number(readMappedSheetField(row.fields, names));

  return Number.isFinite(value) ? value : null;
}

function distanceMetersBetween(input: {
  fromLatitude: number | null;
  fromLongitude: number | null;
  toLatitude: number | undefined;
  toLongitude: number | undefined;
}) {
  if (
    input.fromLatitude === null ||
    input.fromLongitude === null ||
    input.toLatitude === undefined ||
    input.toLongitude === undefined
  ) {
    return "";
  }

  const earthRadiusMeters = 6371000;
  const toRadians = (value: number) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(input.toLatitude - input.fromLatitude);
  const deltaLongitude = toRadians(input.toLongitude - input.fromLongitude);
  const fromLatitudeRadians = toRadians(input.fromLatitude);
  const toLatitudeRadians = toRadians(input.toLatitude);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(fromLatitudeRadians) *
      Math.cos(toLatitudeRadians) *
      Math.sin(deltaLongitude / 2) ** 2;
  const distance =
    earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(distance);
}

function getAuditUpdateRow(input: {
  candidate?: GooglePlaceCandidate;
  headers: string[];
  lastAudited: string;
  row: SheetRow;
}) {
  const candidate = input.candidate;
  const currentLatitude = readCoordinateField(input.row, ["currentLatitude"]);
  const currentLongitude = readCoordinateField(input.row, ["currentLongitude"]);
  const record: Record<string, unknown> = {};

  for (const header of input.headers) {
    record[header] = readMappedSheetField(input.row.fields, [header]);
  }

  return rowFromRecord(input.headers, {
    ...record,
    auditStatus: "Candidate",
    candidateAddress: candidate?.formattedAddress ?? "",
    candidateCategory: inferCategoryFromTypes(candidate?.types),
    candidateDistanceMeters: distanceMetersBetween({
      fromLatitude: currentLatitude,
      fromLongitude: currentLongitude,
      toLatitude: candidate?.location?.latitude,
      toLongitude: candidate?.location?.longitude,
    }),
    candidateGoogleMapsUrl: candidate?.googleMapsUri ?? "",
    candidateGooglePlaceId: candidate?.id ?? "",
    candidateLatitude: candidate?.location?.latitude ?? "",
    candidateLongitude: candidate?.location?.longitude ?? "",
    candidateName: candidate?.displayName?.text ?? "",
    lastAudited: input.lastAudited,
  });
}

export async function lookupAuditCandidates(options: LookupAuditCandidatesOptions) {
  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  if (!options.confirmLiveApi) {
    throw new Error("--confirm-live-api is required for live Google Places calls.");
  }

  if (options.maxApiCalls === null) {
    throw new Error("--max-api-calls is required.");
  }

  if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    throw new Error("GOOGLE_PLACES_API_KEY is required.");
  }

  const sheetId = options.sheetId;
  const maxApiCalls = options.maxApiCalls;
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, sheetId);
  assertSheetExists(metadata, AUDIT_TAB);
  await ensureSheet(sheetsAuthClient, sheetId, metadata, API_USAGE_TAB);

  const auditHeaders = await getAuditHeaders(sheetsAuthClient, sheetId);
  const auditRows = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(AUDIT_TAB)}!A1:ZZ`,
  );
  const apiUsageHeaders = await ensureHeaders(
    sheetsAuthClient,
    sheetId,
    API_USAGE_TAB,
    API_USAGE_HEADERS,
  );
  const auditDataRows: SheetRow[] = auditRows.slice(1).map((values, index) => ({
    fields: mapSheetRowToObject(auditHeaders, values),
    rowNumber: index + 2,
    values,
  }));
  const queuedRows = auditDataRows.filter(
    (row) => readMappedSheetField(row.fields, ["auditStatus"]) === "Queued",
  );
  const timestamp = new Date().toISOString();
  let apiCallsMade = 0;
  let candidatesFound = 0;
  let rowsUpdated = 0;
  let skippedRows = 0;

  for (const auditRow of queuedRows) {
    if (apiCallsMade >= maxApiCalls) {
      break;
    }

    const currentGooglePlaceId = readMappedSheetField(auditRow.fields, [
      "currentGooglePlaceId",
    ]);
    const query = currentGooglePlaceId || buildAuditSearchQuery(auditRow);
    const endpoint = currentGooglePlaceId ? "places.get" : "places:searchText";

    if (!query) {
      skippedRows += 1;
      await appendNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(API_USAGE_TAB)}!A1`,
        [
          rowFromRecord(apiUsageHeaders, {
            timestamp,
            provider: "Google Places",
            endpoint,
            apiCalls: 0,
            maxApiCalls,
            sheetId,
            captureRow: auditRow.rowNumber,
            query,
            candidateCount: 0,
            status: "skipped",
            error: "Missing audit lookup fields.",
          }),
        ],
      );
      continue;
    }

    let candidate: GooglePlaceCandidate | undefined;
    let candidateCount = 0;

    try {
      if (currentGooglePlaceId) {
        candidate = await fetchGooglePlaceDetails({
          apiKey: process.env.GOOGLE_PLACES_API_KEY as string,
          placeId: currentGooglePlaceId,
        });
        candidateCount = 1;
      } else {
        const response = await searchGooglePlaces({
          apiKey: process.env.GOOGLE_PLACES_API_KEY as string,
          headers: new Map(),
          query,
          row: [],
        });
        candidate = response.places?.[0];
        candidateCount = response.places?.length ?? 0;
      }
    } catch (caughtError) {
      const error =
        caughtError instanceof Error ? caughtError.message : String(caughtError);

      await appendNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(API_USAGE_TAB)}!A1`,
        [
          rowFromRecord(apiUsageHeaders, {
            timestamp,
            provider: "Google Places",
            endpoint,
            apiCalls: 0,
            maxApiCalls,
            sheetId,
            captureRow: auditRow.rowNumber,
            query,
            candidateCount: 0,
            status: "error",
            error,
          }),
        ],
      );

      throw new Error(error);
    }

    apiCallsMade += 1;

    await appendNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(API_USAGE_TAB)}!A1`,
      [
        rowFromRecord(apiUsageHeaders, {
          timestamp,
          provider: "Google Places",
          endpoint,
          apiCalls: 1,
          maxApiCalls,
          sheetId,
          captureRow: auditRow.rowNumber,
          query,
          candidateCount,
          status: "ok",
          error: "",
        }),
      ],
    );

    if (candidate) {
      candidatesFound += 1;
    }

    const candidateStartIndex = AUDIT_HEADERS.indexOf("candidateName");
    const auditUpdateHeaders = auditHeaders.slice(candidateStartIndex);

    await updateNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(AUDIT_TAB)}!${columnName(candidateStartIndex)}${
        auditRow.rowNumber
      }:${columnName(auditHeaders.length - 1)}${auditRow.rowNumber}`,
      [
        getAuditUpdateRow({
          candidate,
          headers: auditUpdateHeaders,
          lastAudited: timestamp,
          row: auditRow,
        }),
      ],
    );
    rowsUpdated += 1;
  }

  console.log(
    `Audited ${rowsUpdated} row(s), skipped ${skippedRows}, made ${apiCallsMade} Google Places call(s), and found ${candidatesFound} candidate(s).`,
  );

  return {
    apiCallsMade,
    candidatesFound,
    rowsUpdated,
    skippedRows,
  };
}

function getRequiredHeaderIndex(
  sheetName: string,
  headers: string[],
  header: string,
) {
  const index = getHeaderIndex(indexHeaders(headers), [header]);

  if (index === undefined) {
    throw new Error(`${sheetName} is missing required column: ${header}`);
  }

  return index;
}

function getAuditAction(row: SheetRow) {
  const auditStatus = readMappedSheetField(row.fields, ["auditStatus"]);

  return auditStatus === "Update" || auditStatus === "Delete"
    ? auditStatus
    : null;
}

export async function applyAuditUpdates(options: ApplyAuditUpdatesOptions) {
  const dryRun = options.dryRun ?? !options.write;
  const write = options.write ?? false;

  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  if (dryRun && write) {
    throw new Error("Choose only one of --dry-run or --write.");
  }

  const sheetId = options.sheetId;
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, sheetId);
  assertSheetExists(metadata, AUDIT_TAB);

  const auditHeaders = await getAuditHeaders(sheetsAuthClient, sheetId);
  const auditValues = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(AUDIT_TAB)}!A1:ZZ`,
  );
  const auditStatusIndex = getRequiredHeaderIndex(
    AUDIT_TAB,
    auditHeaders,
    "auditStatus",
  );
  const auditRows: SheetRow[] = auditValues.slice(1).map((values, index) => ({
    fields: mapSheetRowToObject(auditHeaders, values),
    rowNumber: index + 2,
    values,
  }));
  const productionSnapshot = readPlacesJsonSnapshot(PLACES_JSON_PATH);
  const currentPlaces = productionSnapshot.places;
  const placesById = new Map(currentPlaces.map((place) => [place.id, place]));
  const rowsToProcess = auditRows.filter((row) => getAuditAction(row));
  const timestamp = new Date().toISOString();
  const auditStatusUpdates: Array<{
    range: string;
    values: string[][];
  }> = [];
  const changes: Array<{
    action: "Update" | "Delete";
    id: string;
    auditRowNumber: number;
  }> = [];
  const sampleUpdates: Array<{
    id: string;
    name: string;
    rowNumber: number;
  }> = [];
  const sampleDeletes: Array<{
    id: string;
    name: string;
    rowNumber: number;
  }> = [];
  const validationIssues: Array<{
    id: string;
    reason: string;
    rowNumber: number;
  }> = [];
  const missingJsonMatches: Array<{
    id: string;
    rowNumber: number;
  }> = [];
  const updatedPlacesById = new Map(placesById);
  const deletedPlaceIds = new Set<string>();

  for (const auditRow of rowsToProcess) {
    const action = getAuditAction(auditRow);
    const id = readMappedSheetField(auditRow.fields, ["id"]);

    if (!action) {
      continue;
    }

    if (!id) {
      validationIssues.push({
        id,
        reason: "Missing id.",
        rowNumber: auditRow.rowNumber,
      });
      continue;
    }

    const currentPlace = updatedPlacesById.get(id);

    if (!currentPlace) {
      missingJsonMatches.push({
        id,
        rowNumber: auditRow.rowNumber,
      });
      continue;
    }

    if (action === "Delete") {
      deletedPlaceIds.add(id);
      auditStatusUpdates.push({
        range: `${quoteSheetName(AUDIT_TAB)}!${columnName(auditStatusIndex)}${
          auditRow.rowNumber
        }`,
        values: [["Applied"]],
      });
      changes.push({
        action,
        auditRowNumber: auditRow.rowNumber,
        id,
      });
      sampleDeletes.push({
        id,
        name: currentPlace.name,
        rowNumber: auditRow.rowNumber,
      });
      continue;
    }

    const candidateAddress = readMappedSheetField(auditRow.fields, [
      "candidateAddress",
    ]);
    const candidateLatitude = readMappedSheetField(auditRow.fields, [
      "candidateLatitude",
    ]);
    const candidateLongitude = readMappedSheetField(auditRow.fields, [
      "candidateLongitude",
    ]);
    const candidateGoogleMapsUrl = readMappedSheetField(auditRow.fields, [
      "candidateGoogleMapsUrl",
    ]);
    const candidateGooglePlaceId = readMappedSheetField(auditRow.fields, [
      "candidateGooglePlaceId",
    ]);
    const candidateLatitudeNumber = Number(candidateLatitude);
    const candidateLongitudeNumber = Number(candidateLongitude);
    const missingCandidateFields = [
      candidateAddress ? null : "candidateAddress",
      candidateLatitude ? null : "candidateLatitude",
      candidateLongitude ? null : "candidateLongitude",
      candidateGoogleMapsUrl ? null : "candidateGoogleMapsUrl",
      candidateGooglePlaceId ? null : "candidateGooglePlaceId",
    ].filter((field): field is string => field !== null);

    if (missingCandidateFields.length > 0) {
      validationIssues.push({
        id,
        reason: `Missing candidate field(s): ${missingCandidateFields.join(", ")}.`,
        rowNumber: auditRow.rowNumber,
      });
      continue;
    }

    if (!Number.isFinite(candidateLatitudeNumber) || !Number.isFinite(candidateLongitudeNumber)) {
      validationIssues.push({
        id,
        reason: "Invalid candidate latitude/longitude.",
        rowNumber: auditRow.rowNumber,
      });
      continue;
    }

    updatedPlacesById.set(id, {
      ...currentPlace,
      address: candidateAddress,
      googleMapsUrl: candidateGoogleMapsUrl,
      googlePlaceId: candidateGooglePlaceId,
      lastChecked: timestamp,
      latitude: candidateLatitudeNumber,
      longitude: candidateLongitudeNumber,
      verifiedStatus: "Yes",
    });
    auditStatusUpdates.push({
      range: `${quoteSheetName(AUDIT_TAB)}!${columnName(auditStatusIndex)}${
        auditRow.rowNumber
      }`,
      values: [["Applied"]],
    });
    changes.push({
      action,
      auditRowNumber: auditRow.rowNumber,
      id,
    });
    sampleUpdates.push({
      id,
      name: currentPlace.name,
      rowNumber: auditRow.rowNumber,
    });
  }

  if (write) {
    const nextPlaces = currentPlaces
      .filter((place) => !deletedPlaceIds.has(place.id))
      .map((place) => updatedPlacesById.get(place.id) ?? place);

    writePlacesJsonAtomic(nextPlaces, {
      expectedFileHash: productionSnapshot.fileHash,
      filePath: PLACES_JSON_PATH,
    });
    await batchUpdateValues(sheetsAuthClient, sheetId, auditStatusUpdates);
  }

  console.log("Audit apply summary");
  console.table({
    mode: write ? "write" : "dry-run",
    rowsRead: auditRows.length,
    rowsToProcess: rowsToProcess.length,
    updates: changes.filter((change) => change.action === "Update").length,
    deletes: changes.filter((change) => change.action === "Delete").length,
    missingJsonMatches: missingJsonMatches.length,
    validationIssues: validationIssues.length,
  });

  return {
    changes,
    deletes: changes.filter((change) => change.action === "Delete").length,
    dryRun: !write,
    missingJsonMatchRows: missingJsonMatches,
    missingJsonMatches: missingJsonMatches.length,
    rowsRead: auditRows.length,
    rowsToProcess: rowsToProcess.length,
    sampleDeletes: sampleDeletes.slice(0, 10),
    sampleUpdates: sampleUpdates.slice(0, 10),
    updates: changes.filter((change) => change.action === "Update").length,
    validationIssues,
    wrote: write,
  };
}

function buildReviewRecords(input: {
  candidates: GooglePlaceCandidate[];
  captureRow: SheetRow;
  duplicateBaseId?: string;
  intakeKey: string;
  reviewId: string;
}) {
  const sourceFields = input.captureRow.fields;
  const rawName = readMappedSheetField(sourceFields, CAPTURE_NAME_HEADERS);
  const cityHint = readMappedSheetField(sourceFields, CITY_HINT_HEADERS);
  const countryHint = readMappedSheetField(sourceFields, COUNTRY_HINT_HEADERS);
  const area = readMappedSheetField(sourceFields, AREA_HINT_HEADERS);
  const status = readMappedSheetField(sourceFields, ["status"]) || "Location";

  function hasCountryMismatch(candidate: GooglePlaceCandidate) {
    const normalizedCountryHint = normalizeText(countryHint);

    if (!normalizedCountryHint) {
      return false;
    }

    return !normalizeText(candidate.formattedAddress ?? "").includes(
      normalizedCountryHint,
    );
  }

  function stripDiacritics(value: string) {
    return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  }

  function deriveAreaFromCandidateAddress(candidate?: GooglePlaceCandidate) {
    const address = candidate?.formattedAddress ?? "";
    const normalizedCity = normalizeText(cityHint);
    const normalizedAddress = normalizeText(address);

    if (!address) {
      return "";
    }

    if (
      normalizedCity.includes("kyoto") ||
      normalizedAddress.includes("kyoto")
    ) {
      return address.match(/\b([A-Za-z][A-Za-z\s'-]+?)\s+Ward\b/i)?.[1]?.trim()
        ?? "";
    }

    if (
      normalizedCity.includes("tokyo") ||
      normalizedAddress.includes("tokyo")
    ) {
      const cityMatch = address.match(
        /\b([A-Za-z][A-Za-z\s'-]+?)\s+City\b(?=,|\s|$)/i,
      )?.[1]?.trim();

      if (cityMatch) {
        return cityMatch;
      }

      const tokyoWards = [
        "Adachi",
        "Arakawa",
        "Bunkyo",
        "Chiyoda",
        "Chuo",
        "Edogawa",
        "Itabashi",
        "Katsushika",
        "Kita",
        "Koto",
        "Meguro",
        "Minato",
        "Nakano",
        "Nerima",
        "Ota",
        "Setagaya",
        "Shibuya",
        "Shinagawa",
        "Shinjuku",
        "Suginami",
        "Sumida",
        "Taito",
        "Toshima",
      ];
      const normalizedTokyoAddress = normalizeText(address);
      const ward = tokyoWards.find((candidateWard) =>
        new RegExp(`\\b${normalizeText(candidateWard)}\\b`).test(
          normalizedTokyoAddress,
        ),
      );

      return ward ?? "";
    }

    if (
      normalizedCity.includes("taipei") ||
      normalizedAddress.includes("taipei")
    ) {
      return address
        .match(/\b([A-Za-z][A-Za-z\s'’.-]+?)\s+District\b/i)?.[1]
        ?.trim() ?? "";
    }

    if (
      normalizedCity.includes("ho chi minh") ||
      normalizedAddress.includes("ho chi minh") ||
      normalizedAddress.includes("hcmc")
    ) {
      const numberedDistrict = address.match(/\bDistrict\s+\d+[A-Za-z]?\b/i)?.[0];

      if (numberedDistrict) {
        return numberedDistrict;
      }

      const normalizedAddressWithoutDiacritics = stripDiacritics(address);

      if (/\bThao\s+Dien\b/i.test(normalizedAddressWithoutDiacritics)) {
        return "Thao Dien";
      }
    }

    return "";
  }

  function buildRecord(candidate?: GooglePlaceCandidate) {
    const countryMismatch = candidate ? hasCountryMismatch(candidate) : false;
    const duplicateNote = input.duplicateBaseId
      ? `Possible duplicate id: ${input.duplicateBaseId}`
      : "";
    const reviewArea = area || deriveAreaFromCandidateAddress(candidate);

    return {
      id: input.reviewId,
      rawName,
      candidateName: candidate?.displayName?.text ?? "",
      candidateAddress: candidate?.formattedAddress ?? "",
      candidateLatitude: candidate?.location?.latitude ?? "",
      candidateLongitude: candidate?.location?.longitude ?? "",
      candidateGoogleMapsUrl: candidate?.googleMapsUri ?? "",
      candidateGooglePlaceId: candidate?.id ?? "",
      category: inferCategoryFromTypes(candidate?.types),
      area: reviewArea,
      city: cityHint,
      status,
      loved: "FALSE",
      notes: duplicateNote
        ? duplicateNote
        : countryMismatch
          ? "Candidate country/location mismatch; verify manually."
          : "",
      reviewStatus: "Candidate",
      intakeKey: input.intakeKey,
    };
  }

  if (input.candidates.length === 0) {
    return [buildRecord()];
  }

  return [buildRecord(input.candidates[0])];
}

export async function enrichReadyRows(options: EnrichReadyRowsOptions) {
  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  if (!options.confirmLiveApi) {
    throw new Error("--confirm-live-api is required for live Google Places calls.");
  }

  if (options.maxApiCalls === null) {
    throw new Error("--max-api-calls is required.");
  }

  if (!process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    throw new Error("GOOGLE_PLACES_API_KEY is required.");
  }

  const sheetId = options.sheetId;
  const maxApiCalls = options.maxApiCalls;
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, sheetId);

  assertSheetExists(metadata, CAPTURE_TAB);
  assertSheetExists(metadata, PUBLISHED_TAB);
  await ensureSheet(sheetsAuthClient, sheetId, metadata, REVIEW_TAB);
  await ensureSheet(sheetsAuthClient, sheetId, metadata, API_USAGE_TAB);

  const captureRows = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(CAPTURE_TAB)}!A1:ZZ`,
  );
  const reviewRows = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(REVIEW_TAB)}!A1:ZZ`,
  );
  const publishedRows = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(PUBLISHED_TAB)}!A1:ZZ`,
  );
  const captureHeaders = captureRows[0] ?? [];
  const headerIndexes = indexHeaders(captureHeaders);
  const intakeStatusIndex = getHeaderIndex(headerIndexes, ["intakeStatus"]);

  if (intakeStatusIndex === undefined) {
    throw new Error('Capture tab must include an "intakeStatus" column.');
  }

  const captureDataRows: SheetRow[] = captureRows
    .slice(1)
    .map((values, index) => ({
      fields: mapSheetRowToObject(captureHeaders, values),
      rowNumber: index + 2,
      values,
    }));
  const eligibleRows = captureDataRows.filter(
    (row) =>
      String(row.values[intakeStatusIndex] ?? "").trim() === READY_INTAKE_STATUS,
  );

  if (eligibleRows.length === 0) {
    console.log("No Capture rows are eligible for enrichment.");
    return { apiCallsMade: 0, enrichedRows: 0, skippedRows: 0 };
  }

  const reviewHeaders = await getReviewHeaders(sheetsAuthClient, sheetId);
  const apiUsageHeaders = await ensureHeaders(
    sheetsAuthClient,
    sheetId,
    API_USAGE_TAB,
    API_USAGE_HEADERS,
  );
  const existingReviewIds = new Set(readIdsFromSheetValues(reviewRows));
  const existingReviewIntakeKeys = new Set(
    reviewRows
      .slice(1)
      .map((row) =>
        readMappedSheetField(
          mapSheetRowToObject(reviewRows[0] ?? [], row),
          ["intakeKey"],
        ),
      )
      .filter(Boolean),
  );
  const existingPublishedOrAppIds = new Set([
    ...readIdsFromSheetValues(publishedRows),
    ...(await readPlacesJsonIds()),
  ]);
  const timestamp = new Date().toISOString();
  let apiCallsMade = 0;
  let enrichedRows = 0;
  let reconciledRows = 0;
  let skippedRows = 0;
  let blankRawName = 0;
  const duplicateReviewIds: string[] = [];
  const duplicateReviewRows: Array<{
    id: string;
    rowNumber: number;
  }> = [];
  const skippedRowDetails: Array<{
    reason: "blankRawName" | "duplicateReviewId" | "missingQuery";
    rowNumber: number;
  }> = [];

  for (const captureRow of eligibleRows) {
    const rawName = readMappedSheetField(captureRow.fields, CAPTURE_NAME_HEADERS);

    if (!rawName.trim()) {
      blankRawName += 1;
      skippedRows += 1;
      skippedRowDetails.push({
        reason: "blankRawName",
        rowNumber: captureRow.rowNumber,
      });
      continue;
    }

    const intakeKey = buildCaptureIntakeKey(captureRow.fields);

    if (shouldReconcileCapture(existingReviewIntakeKeys, captureRow.fields)) {
      await updateNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(CAPTURE_TAB)}!${columnName(intakeStatusIndex)}${
          captureRow.rowNumber
        }`,
        [["Enriched"]],
      );
      enrichedRows += 1;
      reconciledRows += 1;
      continue;
    }

    if (apiCallsMade >= maxApiCalls) {
      continue;
    }

    const query = buildPlaceQuery(captureRow);
    const cityHint = readMappedSheetField(captureRow.fields, CITY_HINT_HEADERS);
    const captureId = readMappedSheetField(captureRow.fields, ["id"]);
    const generatedId = buildGeneratedPlaceId({
      cityHint,
      rawName,
      rowNumber: captureRow.rowNumber,
    });

    if (!query) {
      skippedRows += 1;
      skippedRowDetails.push({
        reason: "missingQuery",
        rowNumber: captureRow.rowNumber,
      });
      await appendNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(API_USAGE_TAB)}!A1`,
        [
          rowFromRecord(apiUsageHeaders, {
            timestamp,
            provider: "Google Places",
            endpoint: "places:searchText",
            apiCalls: 0,
            maxApiCalls,
            sheetId,
            captureRow: captureRow.rowNumber,
            query,
            candidateCount: 0,
            status: "skipped",
            error: "Missing place query fields.",
          }),
        ],
      );
      continue;
    }

    const reviewId = captureId
      ? captureId
      : getCollisionSafeId(
          generatedId,
          new Set([...existingPublishedOrAppIds, ...existingReviewIds]),
        );
    const duplicateBaseId =
      !captureId && reviewId !== generatedId ? generatedId : undefined;

    if (existingReviewIds.has(reviewId)) {
      skippedRows += 1;
      duplicateReviewIds.push(reviewId);
      duplicateReviewRows.push({
        id: reviewId,
        rowNumber: captureRow.rowNumber,
      });
      skippedRowDetails.push({
        reason: "duplicateReviewId",
        rowNumber: captureRow.rowNumber,
      });
      await appendNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(API_USAGE_TAB)}!A1`,
        [
          rowFromRecord(apiUsageHeaders, {
            timestamp,
            provider: "Google Places",
            endpoint: "places:searchText",
            apiCalls: 0,
            maxApiCalls,
            sheetId,
            captureRow: captureRow.rowNumber,
            query,
            candidateCount: 0,
            status: "skipped",
            error: `Duplicate Review id: ${reviewId}.`,
          }),
        ],
      );
      continue;
    }

    let response: GoogleTextSearchResponse;

    try {
      response = await searchGooglePlaces({
        apiKey: process.env.GOOGLE_PLACES_API_KEY as string,
        headers: headerIndexes,
        query,
        row: captureRow.values,
      });
    } catch (caughtError) {
      const error =
        caughtError instanceof Error ? caughtError.message : String(caughtError);

      await appendNonPublishedValues(
        sheetsAuthClient,
        sheetId,
        `${quoteSheetName(API_USAGE_TAB)}!A1`,
        [
          rowFromRecord(apiUsageHeaders, {
            timestamp,
            provider: "Google Places",
            endpoint: "places:searchText",
            apiCalls: 0,
            maxApiCalls,
            sheetId,
            captureRow: captureRow.rowNumber,
            query,
            candidateCount: 0,
            status: "error",
            error,
          }),
        ],
      );

      throw new Error(error);
    }

    apiCallsMade += 1;
    const candidates = response.places ?? [];

    await appendNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(API_USAGE_TAB)}!A1`,
      [
        rowFromRecord(apiUsageHeaders, {
          timestamp,
          provider: "Google Places",
          endpoint: "places:searchText",
          apiCalls: 1,
          maxApiCalls,
          sheetId,
          captureRow: captureRow.rowNumber,
          query,
          candidateCount: candidates.length,
          status: "ok",
          error: "",
        }),
      ],
    );

    existingReviewIds.add(reviewId);

    const reviewRecords = buildReviewRecords({
      candidates,
      captureRow,
      duplicateBaseId,
      intakeKey,
      reviewId,
    });

    await appendNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(REVIEW_TAB)}!A:${columnName(reviewHeaders.length - 1)}`,
      reviewRecords.map((record) => rowFromRecord(reviewHeaders, record)),
    );
    existingReviewIntakeKeys.add(intakeKey);

    await updateNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(CAPTURE_TAB)}!${columnName(intakeStatusIndex)}${
        captureRow.rowNumber
      }`,
      [["Enriched"]],
    );
    enrichedRows += 1;
  }

  console.log(
    `Enriched ${enrichedRows} Capture row(s), skipped ${skippedRows}, made ${apiCallsMade} Google Places call(s), and wrote candidates to Review.`,
  );
  if (duplicateReviewIds.length > 0) {
    console.log(`Skipped duplicate Review id(s): ${duplicateReviewIds.join(", ")}`);
  }
  if (blankRawName > 0) {
    console.log(`Skipped ${blankRawName} row(s) with blankRawName.`);
  }

  return {
    apiCallsMade,
    blankRawName,
    duplicateReviewId: duplicateReviewIds[0] ?? "",
    duplicateReviewIds,
    duplicateReviewRows,
    enrichedRows,
    reconciledRows,
    skippedRowDetails,
    skippedRows,
  };
}

function buildPublishedRecord(reviewRow: Record<string, string>, lastChecked: string) {
  return {
    id: readMappedSheetField(reviewRow, ["id"]),
    name: readMappedSheetField(reviewRow, ["candidateName"]),
    category: readMappedSheetField(reviewRow, ["category"]),
    area: readMappedSheetField(reviewRow, ["area"]),
    city: readMappedSheetField(reviewRow, ["city"]),
    address: readMappedSheetField(reviewRow, ["candidateAddress"]),
    latitude: readMappedSheetField(reviewRow, ["candidateLatitude"]),
    longitude: readMappedSheetField(reviewRow, ["candidateLongitude"]),
    googleMapsUrl: readMappedSheetField(reviewRow, ["candidateGoogleMapsUrl"]),
    googlePlaceId: readMappedSheetField(reviewRow, ["candidateGooglePlaceId"]),
    status: readMappedSheetField(reviewRow, ["status"]),
    loved: readMappedSheetField(reviewRow, ["loved"]),
    notes: readMappedSheetField(reviewRow, ["notes"]),
    verifiedStatus: readMappedSheetField(reviewRow, ["reviewStatus"]),
    lastChecked,
  };
}

export function buildPublishedUpsertPlan(input: {
  approvedRows: Record<string, string>[];
  lastChecked: string;
  publishedHeaders: string[];
  publishedValues: string[][];
}) {
  const publishedRowsById = new Map<
    string,
    { rowNumber: number; values: string[] }
  >();
  const duplicatePublishedIds = new Set<string>();

  input.publishedValues.slice(1).forEach((values, index) => {
    const id = readMappedSheetField(
      mapSheetRowToObject(input.publishedHeaders, values),
      ["id"],
    );

    if (!id) {
      return;
    }

    if (publishedRowsById.has(id)) {
      duplicatePublishedIds.add(id);
      return;
    }

    publishedRowsById.set(id, { rowNumber: index + 2, values });
  });

  if (duplicatePublishedIds.size > 0) {
    throw new Error(
      `Published contains duplicate id(s): ${Array.from(duplicatePublishedIds).join(", ")}. Resolve them before publishing.`,
    );
  }

  const approvedIds = new Set<string>();
  const duplicateApprovedIds = new Set<string>();
  const appendRows: string[][] = [];
  const updateRows: Array<{
    id: string;
    name: string;
    rowNumber: number;
    values: string[];
  }> = [];
  const publishableRows: Array<{ id: string; name: string }> = [];
  const unchangedIds: string[] = [];
  let blankIdRowsSkipped = 0;

  for (const approvedRow of input.approvedRows) {
    const id = readMappedSheetField(approvedRow, ["id"]);

    if (!id) {
      blankIdRowsSkipped += 1;
      continue;
    }

    if (approvedIds.has(id)) {
      duplicateApprovedIds.add(id);
      continue;
    }
    approvedIds.add(id);

    const name = readMappedSheetField(approvedRow, ["candidateName"]);
    const nextValues = rowFromRecord(
      input.publishedHeaders,
      buildPublishedRecord(approvedRow, input.lastChecked),
    );
    const normalizedCandidate = normalizePublishedRow({
      fields: mapSheetRowToObject(input.publishedHeaders, nextValues),
      rowNumber: 0,
      values: nextValues,
    });

    if (!normalizedCandidate.ok) {
      throw new Error(
        `Verified Review row ${id} is not publishable: ${normalizedCandidate.errors.join(" ")}`,
      );
    }
    const current = publishedRowsById.get(id);

    if (!current) {
      appendRows.push(nextValues);
      publishableRows.push({ id, name });
      continue;
    }

    const currentValues = input.publishedHeaders.map(
      (_, index) => String(current.values[index] ?? ""),
    );

    const comparableIndexes = input.publishedHeaders
      .map((header, index) =>
        normalizeSheetHeader(header) === normalizeSheetHeader("lastChecked")
          ? -1
          : index,
      )
      .filter((index) => index >= 0);
    const currentComparableValues = comparableIndexes.map(
      (index) => currentValues[index],
    );
    const nextComparableValues = comparableIndexes.map(
      (index) => nextValues[index],
    );

    if (
      JSON.stringify(currentComparableValues) ===
      JSON.stringify(nextComparableValues)
    ) {
      unchangedIds.push(id);
      continue;
    }

    updateRows.push({ id, name, rowNumber: current.rowNumber, values: nextValues });
    publishableRows.push({ id, name });
  }

  if (duplicateApprovedIds.size > 0) {
    throw new Error(
      `Review contains multiple Verified rows for id(s): ${Array.from(duplicateApprovedIds).join(", ")}. Approve only one row per id.`,
    );
  }

  return {
    appendRows,
    blankIdRowsSkipped,
    publishableRows,
    unchangedIds,
    updateRows,
  };
}

export async function publishApprovedRows(options: PublishApprovedRowsOptions) {
  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  const dryRun =
    options.dryRun ?? (options.write === undefined ? false : !options.write);
  const write = options.write ?? !dryRun;
  if (dryRun && write) {
    throw new Error("Choose only one of preview mode or write mode.");
  }

  const sheetId = options.sheetId;
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, sheetId);

  assertSheetExists(metadata, REVIEW_TAB);
  assertSheetExists(metadata, PUBLISHED_TAB);

  const reviewValues = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(REVIEW_TAB)}!A1:ZZ`,
  );
  const publishedValues = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(PUBLISHED_TAB)}!A1:ZZ`,
  );
  const reviewHeaders = (reviewValues[0] ?? []).map((value) => String(value ?? ""));
  const publishedHeaders = (publishedValues[0] ?? []).map((value) =>
    String(value ?? ""),
  );

  requireHeaders(REVIEW_TAB, reviewHeaders, [
    "id",
    "candidateName",
    "category",
    "area",
    "city",
    "candidateAddress",
    "candidateLatitude",
    "candidateLongitude",
    "candidateGoogleMapsUrl",
    "candidateGooglePlaceId",
    "status",
    "loved",
    "notes",
    "reviewStatus",
  ]);
  requireHeaders(PUBLISHED_TAB, publishedHeaders, PUBLISHED_HEADERS);

  const approvedRows = reviewValues
    .slice(1)
    .map((row) => mapSheetRowToObject(reviewHeaders, row))
    .filter(
      (row) => readMappedSheetField(row, ["reviewStatus"]) === "Verified",
    );
  const lastChecked = new Date().toISOString();
  const plan = buildPublishedUpsertPlan({
    approvedRows,
    lastChecked,
    publishedHeaders,
    publishedValues,
  });

  if (write && plan.updateRows.length > 0) {
    await batchUpdateValues(
      sheetsAuthClient,
      sheetId,
      plan.updateRows.map((row) => ({
        range: `${quoteSheetName(PUBLISHED_TAB)}!A${row.rowNumber}:${columnName(
          publishedHeaders.length - 1,
        )}${row.rowNumber}`,
        values: [row.values],
      })),
    );
  }

  if (write && plan.appendRows.length > 0) {
    await appendValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(PUBLISHED_TAB)}!A:${columnName(publishedHeaders.length - 1)}`,
      plan.appendRows,
    );
  }

  console.log(
    `${write ? "Published" : "Would publish"} ${plan.appendRows.length} new row(s) and ${write ? "updated" : "would update"} ${plan.updateRows.length} row(s). Skipped ${plan.unchangedIds.length} unchanged row(s) and ${plan.blankIdRowsSkipped} blank id row(s).`,
  );

  return {
    approvedRowsFound: approvedRows.length,
    blankIdRowsSkipped: plan.blankIdRowsSkipped,
    duplicateIdsSkipped: [] as string[],
    duplicateRowsSkipped: 0,
    mode: write ? "write" : "preview",
    publishedRows: write ? plan.appendRows.length : 0,
    rowsSkipped: plan.unchangedIds.length + plan.blankIdRowsSkipped,
    rowsToPublish: plan.appendRows.length + plan.updateRows.length,
    unchangedRows: plan.unchangedIds.length,
    updatedRows: write ? plan.updateRows.length : 0,
    rowsToUpdate: plan.updateRows.length,
    validationIssues: plan.blankIdRowsSkipped,
    verifiedRowsFound: approvedRows.length,
    wouldPublishRows: plan.publishableRows,
    wrote: write,
  };
}

function readNumber(value: string) {
  const numberValue = Number(value);

  return Number.isFinite(numberValue) ? numberValue : null;
}

function normalizeStatus(value: string): PlaceStatus | null {
  const normalized = value.trim().toLowerCase();

  if (normalized === "visited" || normalized === "been") {
    return "been";
  }

  if (normalized === "want to go" || normalized === "want_to_go") {
    return "want_to_go";
  }

  if (normalized === "location" || normalized === "place") {
    return "location";
  }

  return null;
}

function readLoved(value: string) {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  return null;
}

function normalizeVerifiedStatus(value: string): PlaceVerifiedStatus {
  const normalized = value.trim().toLowerCase();

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
    normalized === "moved"
  ) {
    return "Closed/Moved";
  }

  return "";
}

function normalizeNotes(value: string) {
  return value
    .split(/\r?\n|\s+\|\s+/)
    .map((note) => note.trim())
    .filter(Boolean);
}

function normalizePublishedRow(row: SheetRow): NormalizedPublishedRow {
  const fields = row.fields;
  const id = readMappedSheetField(fields, ["id"]);
  const name = readMappedSheetField(fields, ["name"]);
  const city = readMappedSheetField(fields, ["city"]);
  const category = readMappedSheetField(fields, ["category"]);
  const latitude = readNumber(readMappedSheetField(fields, ["latitude", "lat"]));
  const longitude = readNumber(readMappedSheetField(fields, ["longitude", "lng", "lon"]));
  const googleMapsUrl = readMappedSheetField(fields, [
    "googleMapsUrl",
    "google maps url",
  ]);
  const status = normalizeStatus(readMappedSheetField(fields, ["status"]));
  const verifiedStatus = normalizeVerifiedStatus(
    readMappedSheetField(fields, ["verifiedStatus", "verificationStatus"]),
  );
  const errors = [
    id ? null : "Missing id.",
    name ? null : "Missing name.",
    city ? null : "Missing city.",
    category ? null : "Missing category.",
    latitude === null || latitude < -90 || latitude > 90
      ? "Invalid latitude."
      : null,
    longitude === null || longitude < -180 || longitude > 180
      ? "Invalid longitude."
      : null,
    googleMapsUrl ? null : "Missing googleMapsUrl.",
    status ? null : "Invalid status.",
    verifiedStatus === "Yes"
      ? null
      : "verifiedStatus must be Yes or Verified before publication.",
  ].filter((error): error is string => error !== null);

  if (errors.length > 0) {
    return {
      errors,
      id,
      ok: false,
      rowNumber: row.rowNumber,
    };
  }

  const validStatus = status as PlaceStatus;
  const validLatitude = latitude as number;
  const validLongitude = longitude as number;

  return {
    ok: true,
    place: {
      id,
      name,
      city,
      category,
      status: validStatus,
      loved: readLoved(readMappedSheetField(fields, ["loved"])),
      district: readMappedSheetField(fields, ["area", "district"]),
      address: readMappedSheetField(fields, ["address"]),
      latitude: validLatitude,
      longitude: validLongitude,
      tabelog: "",
      subway: "",
      googleMapsUrl,
      googlePlaceId: readMappedSheetField(fields, [
        "googlePlaceId",
        "google place id",
      ]),
      verifiedStatus,
      lastChecked: readMappedSheetField(fields, ["lastChecked", "last checked"]),
      notes: normalizeNotes(readMappedSheetField(fields, ["notes"])),
    },
    rowNumber: row.rowNumber,
  };
}

function sortPlaces(places: Place[]) {
  return [...places].sort((firstPlace, secondPlace) => {
    const citySort = firstPlace.city.localeCompare(secondPlace.city);

    if (citySort !== 0) {
      return citySort;
    }

    return firstPlace.name.localeCompare(secondPlace.name);
  });
}

function stableJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableJsonValue);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, childValue]) => childValue !== undefined)
        .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
        .map(([key, childValue]) => [key, stableJsonValue(childValue)]),
    );
  }

  return value;
}

function placesEqual(firstPlace: Place, secondPlace: Place) {
  return (
    JSON.stringify(stableJsonValue(firstPlace)) ===
    JSON.stringify(stableJsonValue(secondPlace))
  );
}

export function buildPublishedSyncPlan(input: {
  currentPlaces: Place[];
  publishedHeaders: string[];
  publishedValues: string[][];
}) {
  const publishedRows: SheetRow[] = input.publishedValues
    .slice(1)
    .map((values, index) => ({
      fields: mapSheetRowToObject(input.publishedHeaders, values),
      rowNumber: index + 2,
      values,
    }))
    .filter((row) => row.values.some((value) => String(value ?? "").trim()));
  const nextPlacesById = new Map(
    input.currentPlaces.map((place) => [place.id, place]),
  );
  const changes: Array<{
    action: "insert" | "update";
    id: string;
    name: string;
    rowNumber: number;
  }> = [];
  const validationErrors: Array<{
    errors: string[];
    id: string;
    rowNumber: number;
  }> = [];
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const row of publishedRows) {
    const normalized = normalizePublishedRow(row);

    if (!normalized.ok) {
      skipped += 1;
      validationErrors.push({
        errors: normalized.errors,
        id: normalized.id,
        rowNumber: normalized.rowNumber,
      });
      continue;
    }

    const existingPlace = nextPlacesById.get(normalized.place.id);

    if (!existingPlace) {
      inserted += 1;
      nextPlacesById.set(normalized.place.id, normalized.place);
      changes.push({
        action: "insert",
        id: normalized.place.id,
        name: normalized.place.name,
        rowNumber: normalized.rowNumber,
      });
      continue;
    }

    if (placesEqual(existingPlace, normalized.place)) {
      skipped += 1;
      continue;
    }

    updated += 1;
    nextPlacesById.set(normalized.place.id, normalized.place);
    changes.push({
      action: "update",
      id: normalized.place.id,
      name: normalized.place.name,
      rowNumber: normalized.rowNumber,
    });
  }

  return {
    changes,
    inserted,
    nextPlaces: sortPlaces(Array.from(nextPlacesById.values())),
    rowsRead: publishedRows.length,
    skipped,
    updated,
    validationErrors,
  };
}

export function assertPublishedSyncCanWrite(input: {
  allowPartial?: boolean;
  validationErrorCount: number;
}) {
  if (input.validationErrorCount > 0 && !input.allowPartial) {
    throw new Error(
      `Refusing to write because Published contains ${input.validationErrorCount} invalid row(s). Run a dry run, correct every row, or explicitly allow a partial sync.`,
    );
  }
}

function countSheetStatuses(
  values: string[][],
  headers: string[],
  fieldName: string,
) {
  const counts = new Map<string, number>();
  let total = 0;

  for (const valuesRow of values.slice(1)) {
    if (!valuesRow.some((value) => String(value ?? "").trim())) {
      continue;
    }

    total += 1;
    const status = readMappedSheetField(
      mapSheetRowToObject(headers, valuesRow),
      [fieldName],
    ).toLowerCase();
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }

  return { counts, total };
}

export async function getPlacePipelineStatus(input: {
  sheetId: string;
}): Promise<PlacePipelineStatus> {
  if (!input.sheetId?.trim()) {
    throw new Error("A Google Sheet ID is required.");
  }

  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, input.sheetId);
  assertSheetExists(metadata, CAPTURE_TAB);
  assertSheetExists(metadata, REVIEW_TAB);
  assertSheetExists(metadata, PUBLISHED_TAB);

  const [captureValues, reviewValues, publishedValues] = await Promise.all([
    readValues(
      sheetsAuthClient,
      input.sheetId,
      `${quoteSheetName(CAPTURE_TAB)}!A1:ZZ`,
    ),
    readValues(
      sheetsAuthClient,
      input.sheetId,
      `${quoteSheetName(REVIEW_TAB)}!A1:ZZ`,
    ),
    readValues(
      sheetsAuthClient,
      input.sheetId,
      `${quoteSheetName(PUBLISHED_TAB)}!A1:ZZ`,
    ),
  ]);
  const captureHeaders = (captureValues[0] ?? []).map(String);
  const reviewHeaders = (reviewValues[0] ?? []).map(String);
  const publishedHeaders = (publishedValues[0] ?? []).map(String);
  requireHeaders(CAPTURE_TAB, captureHeaders, ["intakeStatus"]);
  requireHeaders(REVIEW_TAB, reviewHeaders, [
    "id",
    "candidateName",
    "category",
    "area",
    "city",
    "candidateAddress",
    "candidateLatitude",
    "candidateLongitude",
    "candidateGoogleMapsUrl",
    "candidateGooglePlaceId",
    "status",
    "loved",
    "notes",
    "reviewStatus",
  ]);
  requireHeaders(PUBLISHED_TAB, publishedHeaders, PUBLISHED_HEADERS);

  const captureStatus = countSheetStatuses(
    captureValues,
    captureHeaders,
    "intakeStatus",
  );
  const reviewStatus = countSheetStatuses(
    reviewValues,
    reviewHeaders,
    "reviewStatus",
  );
  const publishedStatus = countSheetStatuses(
    publishedValues,
    publishedHeaders,
    "verifiedStatus",
  );
  const approvedRows = reviewValues
    .slice(1)
    .map((row) => mapSheetRowToObject(reviewHeaders, row))
    .filter(
      (row) =>
        readMappedSheetField(row, ["reviewStatus"]).toLowerCase() === "verified",
    );
  const publishPlan = buildPublishedUpsertPlan({
    approvedRows,
    lastChecked: new Date().toISOString(),
    publishedHeaders,
    publishedValues,
  });
  const productionSnapshot = readPlacesJsonSnapshot(PLACES_JSON_PATH);
  const appPlan = buildPublishedSyncPlan({
    currentPlaces: productionSnapshot.places,
    publishedHeaders,
    publishedValues,
  });
  const readyToPublish =
    publishPlan.appendRows.length + publishPlan.updateRows.length;
  const appChanges = appPlan.inserted + appPlan.updated;
  const validationErrors = appPlan.validationErrors.length;
  const captureNew = captureStatus.counts.get("new") ?? 0;
  const captureReady = captureStatus.counts.get("ready") ?? 0;
  const captureEnriched = captureStatus.counts.get("enriched") ?? 0;
  const reviewCandidate = reviewStatus.counts.get("candidate") ?? 0;
  const reviewVerified = reviewStatus.counts.get("verified") ?? 0;
  const publishedVerified =
    (publishedStatus.counts.get("verified") ?? 0) +
    (publishedStatus.counts.get("yes") ?? 0);
  const recommendedAction: PlacePipelineStatus["recommendedAction"] =
    validationErrors > 0
      ? "fix_errors"
      : captureReady > 0
        ? "process_ready"
        : reviewCandidate > 0
          ? "verify_candidates"
          : readyToPublish > 0
            ? "publish_verified"
            : appChanges > 0
              ? "update_app"
              : captureNew > 0
                ? "mark_ready"
                : "up_to_date";

  return {
    appChanges,
    capture: {
      enriched: captureEnriched,
      new: captureNew,
      other:
        captureStatus.total - captureNew - captureReady - captureEnriched,
      ready: captureReady,
      total: captureStatus.total,
    },
    fetchedAt: new Date().toISOString(),
    published: {
      total: publishedStatus.total,
      verified: publishedVerified,
    },
    readyToPublish,
    recommendedAction,
    review: {
      candidate: reviewCandidate,
      other: reviewStatus.total - reviewCandidate - reviewVerified,
      total: reviewStatus.total,
      verified: reviewVerified,
    },
    validationErrors,
  };
}

export async function syncPublishedToApp(options: SyncPublishedToAppOptions) {
  const dryRun = options.dryRun ?? !options.write;
  const write = options.write ?? false;

  if (!options.sheetId?.trim()) {
    throw new Error("--sheet-id is required.");
  }

  if (dryRun && write) {
    throw new Error("Choose only one of --dry-run or --write.");
  }

  const sheetId = options.sheetId;
  const sheetsAuthClient = await createGoogleSheetsAuthClient();
  const metadata = await getSpreadsheetMetadata(sheetsAuthClient, sheetId);
  assertSheetExists(metadata, PUBLISHED_TAB);

  const publishedValues = await readValues(
    sheetsAuthClient,
    sheetId,
    `${quoteSheetName(PUBLISHED_TAB)}!A1:ZZ`,
  );
  const publishedHeaders = (publishedValues[0] ?? []).map((value) =>
    String(value ?? ""),
  );
  const productionSnapshot = readPlacesJsonSnapshot(PLACES_JSON_PATH);
  const plan = buildPublishedSyncPlan({
    currentPlaces: productionSnapshot.places,
    publishedHeaders,
    publishedValues,
  });
  const { changes, inserted, nextPlaces, rowsRead, skipped, updated, validationErrors } =
    plan;

  console.log("Published sync summary");
  console.table({
    mode: write ? "write" : "dry-run",
    rowsRead,
    inserted,
    updated,
    skipped,
    validationErrors: validationErrors.length,
  });

  if (changes.length > 0) {
    console.log(write ? "Rows changed" : "Rows that would change");
    console.table(changes);
  }

  if (validationErrors.length > 0) {
    console.log("Validation errors");
    console.table(
      validationErrors.map((error) => ({
        rowNumber: error.rowNumber,
        id: error.id,
        errors: error.errors.join(" "),
      })),
    );
  }

  if (dryRun) {
    console.log("Dry-run mode: src/data/places.json was not written.");
    return {
      changes,
      inserted,
      rowsRead,
      skipped,
      updated,
      validationErrors,
      wrote: false,
    };
  }

  assertPublishedSyncCanWrite({
    allowPartial: options.allowPartial,
    validationErrorCount: validationErrors.length,
  });

  writePlacesJsonAtomic(nextPlaces, {
    expectedFileHash: productionSnapshot.fileHash,
    filePath: PLACES_JSON_PATH,
  });
  console.log(`Wrote ${nextPlaces.length} place(s) to ${PLACES_JSON_PATH}.`);

  return {
    changes,
    inserted,
    rowsRead,
    skipped,
    updated,
    validationErrors,
    partialWrite: validationErrors.length > 0,
    wrote: true,
  };
}
