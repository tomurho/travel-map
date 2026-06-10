import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import type { OAuth2Client } from "google-auth-library";

import {
  appendValues,
  assertSheetExists,
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

const CAPTURE_TAB = "Capture";
const REVIEW_TAB = "Review";
const API_USAGE_TAB = "API Usage";
const PUBLISHED_TAB = "Published";
const READY_INTAKE_STATUS = "Ready";
const PLACES_JSON_PATH = path.resolve(process.cwd(), "src/data/places.json");

const PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
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
  dryRun?: boolean;
  sheetId: string;
  write?: boolean;
};

const REVIEW_HEADERS = [
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
    .slice(0, REVIEW_HEADERS.length)
    .map(normalizeSheetHeader);
  const normalizedReviewHeaders = REVIEW_HEADERS.map(normalizeSheetHeader);
  const hasAgreedHeaderPrefix = normalizedReviewHeaders.every(
    (header, index) => normalizedExistingHeaders[index] === header,
  );

  if (!hasAgreedHeaderPrefix) {
    throw new Error(
      `Review tab must already contain the agreed schema in columns A:${columnName(
        REVIEW_HEADERS.length - 1,
      )}: ${REVIEW_HEADERS.join(", ")}`,
    );
  }

  return REVIEW_HEADERS;
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

function buildReviewRecords(input: {
  candidates: GooglePlaceCandidate[];
  captureRow: SheetRow;
  duplicateBaseId?: string;
  reviewId: string;
}) {
  const sourceFields = input.captureRow.fields;
  const rawName = readMappedSheetField(sourceFields, CAPTURE_NAME_HEADERS);
  const cityHint = readMappedSheetField(sourceFields, CITY_HINT_HEADERS);
  const countryHint = readMappedSheetField(sourceFields, COUNTRY_HINT_HEADERS);
  const area = readMappedSheetField(sourceFields, AREA_HINT_HEADERS);
  const status = readMappedSheetField(sourceFields, ["status"]) || "Want To Go";

  function hasCountryMismatch(candidate: GooglePlaceCandidate) {
    const normalizedCountryHint = normalizeText(countryHint);

    if (!normalizedCountryHint) {
      return false;
    }

    return !normalizeText(candidate.formattedAddress ?? "").includes(
      normalizedCountryHint,
    );
  }

  function buildRecord(candidate?: GooglePlaceCandidate) {
    const countryMismatch = candidate ? hasCountryMismatch(candidate) : false;
    const duplicateNote = input.duplicateBaseId
      ? `Possible duplicate id: ${input.duplicateBaseId}`
      : "";

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
      area,
      city: cityHint,
      status,
      loved: "FALSE",
      notes: duplicateNote
        ? duplicateNote
        : countryMismatch
          ? "Candidate country/location mismatch; verify manually."
          : "",
      reviewStatus: "Candidate",
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

  if (maxApiCalls === 0) {
    console.log(
      `${eligibleRows.length} row(s) are eligible, but --max-api-calls is 0. No live calls or writes performed.`,
    );
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
  const existingPublishedOrAppIds = new Set([
    ...readIdsFromSheetValues(publishedRows),
    ...(await readPlacesJsonIds()),
  ]);
  const timestamp = new Date().toISOString();
  let apiCallsMade = 0;
  let enrichedRows = 0;
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

    if (apiCallsMade >= maxApiCalls) {
      break;
    }

    const query = buildPlaceQuery(captureRow);
    const cityHint = readMappedSheetField(captureRow.fields, CITY_HINT_HEADERS);
    const captureId = readMappedSheetField(captureRow.fields, ["id"]);
    const generatedId = buildGeneratedPlaceId({
      cityHint,
      rawName,
      rowNumber: captureRow.rowNumber,
    });
    const baseReviewId = captureId || generatedId;

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

    if (existingReviewIds.has(baseReviewId)) {
      skippedRows += 1;
      duplicateReviewIds.push(baseReviewId);
      duplicateReviewRows.push({
        id: baseReviewId,
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
            error: `Duplicate Review id: ${baseReviewId}.`,
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
      reviewId,
    });

    await appendNonPublishedValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(REVIEW_TAB)}!A:${columnName(REVIEW_HEADERS.length - 1)}`,
      reviewRecords.map((record) => rowFromRecord(reviewHeaders, record)),
    );

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

  const existingPublishedIds = new Set(
    publishedValues
      .slice(1)
      .map((row) =>
        readMappedSheetField(mapSheetRowToObject(publishedHeaders, row), ["id"]),
      )
      .filter(Boolean),
  );
  const approvedRows = reviewValues
    .slice(1)
    .map((row) => mapSheetRowToObject(reviewHeaders, row))
    .filter(
      (row) => readMappedSheetField(row, ["reviewStatus"]) === "Verified",
    );
  const lastChecked = new Date().toISOString();
  const rowsToPublish: string[][] = [];
  const publishableRows: Array<{
    id: string;
    name: string;
  }> = [];
  let duplicateRowsSkipped = 0;
  let blankIdRowsSkipped = 0;
  const duplicateIdsSkipped: string[] = [];

  for (const reviewRow of approvedRows) {
    const id = readMappedSheetField(reviewRow, ["id"]);

    if (!id) {
      blankIdRowsSkipped += 1;
      continue;
    }

    if (existingPublishedIds.has(id)) {
      duplicateRowsSkipped += 1;
      duplicateIdsSkipped.push(id);
      continue;
    }

    existingPublishedIds.add(id);
    publishableRows.push({
      id,
      name: readMappedSheetField(reviewRow, ["candidateName"]),
    });
    rowsToPublish.push(
      rowFromRecord(publishedHeaders, buildPublishedRecord(reviewRow, lastChecked)),
    );
  }

  if (write && rowsToPublish.length > 0) {
    await appendValues(
      sheetsAuthClient,
      sheetId,
      `${quoteSheetName(PUBLISHED_TAB)}!A:${columnName(publishedHeaders.length - 1)}`,
      rowsToPublish,
    );
  }

  console.log(
    `${write ? "Published" : "Would publish"} ${rowsToPublish.length} row(s). Skipped ${duplicateRowsSkipped} duplicate id row(s) and ${blankIdRowsSkipped} blank id row(s).`,
  );
  if (duplicateIdsSkipped.length > 0) {
    console.log(`Skipped duplicate id(s): ${duplicateIdsSkipped.join(", ")}`);
  }

  return {
    approvedRowsFound: approvedRows.length,
    blankIdRowsSkipped,
    duplicateIdsSkipped,
    duplicateRowsSkipped,
    mode: write ? "write" : "preview",
    publishedRows: write ? rowsToPublish.length : 0,
    rowsSkipped: duplicateRowsSkipped + blankIdRowsSkipped,
    rowsToPublish: rowsToPublish.length,
    validationIssues: blankIdRowsSkipped,
    verifiedRowsFound: approvedRows.length,
    wouldPublishRows: publishableRows,
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
    latitude === null ? "Invalid latitude." : null,
    longitude === null ? "Invalid longitude." : null,
    googleMapsUrl ? null : "Missing googleMapsUrl.",
    status ? null : "Invalid status.",
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

function placesEqual(firstPlace: Place, secondPlace: Place) {
  return JSON.stringify(firstPlace) === JSON.stringify(secondPlace);
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
  const publishedRows: SheetRow[] = publishedValues
    .slice(1)
    .map((values, index) => ({
      fields: mapSheetRowToObject(publishedHeaders, values),
      rowNumber: index + 2,
      values,
    }));
  const currentPlaces = JSON.parse(
    await fs.readFile(PLACES_JSON_PATH, "utf8"),
  ) as Place[];
  const nextPlacesById = new Map(currentPlaces.map((place) => [place.id, place]));
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

  const nextPlaces = sortPlaces(Array.from(nextPlacesById.values()));

  console.log("Published sync summary");
  console.table({
    mode: write ? "write" : "dry-run",
    rowsRead: publishedRows.length,
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
      rowsRead: publishedRows.length,
      skipped,
      updated,
      validationErrors,
      wrote: false,
    };
  }

  await fs.writeFile(PLACES_JSON_PATH, `${JSON.stringify(nextPlaces, null, 2)}\n`);
  console.log(`Wrote ${nextPlaces.length} place(s) to ${PLACES_JSON_PATH}.`);

  return {
    changes,
    inserted,
    rowsRead: publishedRows.length,
    skipped,
    updated,
    validationErrors,
    wrote: true,
  };
}
