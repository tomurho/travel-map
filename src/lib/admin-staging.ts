import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as xlsx from "xlsx";

import { getDistanceKm } from "@/lib/geo";
import type { Place, PlaceStatus, PlaceVerifiedStatus } from "@/lib/place";
import { validatePlaceVerification } from "@/lib/place-verification";

export type AdminDraftStatus = PlaceStatus | "loved";

export interface AdminStagedPlace {
  id: string;
  name: string;
  city: string;
  category: string;
  status: PlaceStatus;
  loved: boolean | null;
  district: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  tabelog: string;
  subway: string;
  googleMapsUrl: string;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
  sourceLabel: string;
  notes: string[];
  createdAt: string;
}

export interface AdminDuplicateMatch {
  address: string;
  category: string;
  distanceKm: number | null;
  id: string;
  name: string;
  reason: string;
}

export type AdminStagedPlaceWithDuplicates = AdminStagedPlace & {
  duplicateMatches: AdminDuplicateMatch[];
};

export interface AdminStagedPlaceInput {
  name: string;
  city: string;
  category: string;
  draftStatus: AdminDraftStatus;
  area: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  tabelog: string;
  subway: string;
  googleMapsUrl: string;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
  sourceLabel: string;
  notes: string[];
}

export interface AdminProductionPlaceVerificationInput {
  address?: string;
  googleMapsUrl: string;
  latitude: number | null;
  longitude: number | null;
  verifiedStatus: PlaceVerifiedStatus;
  lastChecked: string;
  verificationNotes: string;
}

const STAGING_FILE_PATH = join(process.cwd(), "src/data/admin-staged-places.json");
const PLACES_FILE_PATH = join(process.cwd(), "src/data/places.json");

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function normalizeDuplicateText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTokenOverlap(firstValue: string, secondValue: string) {
  const firstTokens = new Set(
    normalizeDuplicateText(firstValue)
      .split(" ")
      .filter((token) => token.length >= 3),
  );
  const secondTokens = new Set(
    normalizeDuplicateText(secondValue)
      .split(" ")
      .filter((token) => token.length >= 3),
  );

  if (firstTokens.size === 0 || secondTokens.size === 0) {
    return 0;
  }

  const overlapCount = Array.from(firstTokens).filter((token) =>
    secondTokens.has(token),
  ).length;

  return overlapCount / Math.min(firstTokens.size, secondTokens.size);
}

function getDuplicateDistanceKm(
  stagedPlace: AdminStagedPlace,
  productionPlace: Place,
) {
  if (stagedPlace.latitude === null || stagedPlace.longitude === null) {
    return null;
  }

  return getDistanceKm(
    {
      latitude: stagedPlace.latitude,
      longitude: stagedPlace.longitude,
    },
    {
      latitude: productionPlace.latitude,
      longitude: productionPlace.longitude,
    },
  );
}

function getDuplicateReason(
  stagedPlace: AdminStagedPlace,
  productionPlace: Place,
) {
  if (stagedPlace.city !== productionPlace.city) {
    return null;
  }

  const stagedName = normalizeDuplicateText(stagedPlace.name);
  const productionName = normalizeDuplicateText(productionPlace.name);
  const stagedAddress = normalizeDuplicateText(stagedPlace.address);
  const productionAddress = normalizeDuplicateText(productionPlace.address);
  const distanceKm = getDuplicateDistanceKm(stagedPlace, productionPlace);

  if (stagedName && stagedName === productionName) {
    return "Same city and same normalized name";
  }

  if (stagedAddress && stagedAddress === productionAddress) {
    return "Same city and same normalized address";
  }

  if (
    distanceKm !== null &&
    distanceKm <= 0.05 &&
    getTokenOverlap(stagedPlace.name, productionPlace.name) >= 0.5
  ) {
    return "Very close coordinates and similar name";
  }

  return null;
}

function normalizeDraftStatus(draftStatus: AdminDraftStatus) {
  if (draftStatus === "loved") {
    return { status: "been" as const, loved: true };
  }

  return {
    status: draftStatus,
    loved: draftStatus === "been" ? false : null,
  };
}

export function readStagedPlaces() {
  if (!existsSync(STAGING_FILE_PATH)) {
    return [];
  }

  const rawContent = readFileSync(STAGING_FILE_PATH, "utf8").trim();

  if (!rawContent) {
    return [];
  }

  return JSON.parse(rawContent) as AdminStagedPlace[];
}

export function getDuplicateMatchesForStagedPlace(
  stagedPlace: AdminStagedPlace,
  productionPlaces = readProductionPlaces(),
): AdminDuplicateMatch[] {
  return productionPlaces
    .map((productionPlace) => {
      const reason = getDuplicateReason(stagedPlace, productionPlace);

      if (!reason) {
        return null;
      }

      return {
        address: productionPlace.address,
        category: productionPlace.category,
        distanceKm: getDuplicateDistanceKm(stagedPlace, productionPlace),
        id: productionPlace.id,
        name: productionPlace.name,
        reason,
      };
    })
    .filter((match): match is AdminDuplicateMatch => match !== null)
    .slice(0, 3);
}

export function getStagedPlacesWithDuplicates() {
  const productionPlaces = readProductionPlaces();

  return readStagedPlaces().map((place) => ({
    ...place,
    duplicateMatches: getDuplicateMatchesForStagedPlace(place, productionPlaces),
  }));
}

export function clearStagedPlaces() {
  writeFileSync(STAGING_FILE_PATH, "[]\n");
}

export function deleteStagedPlace(id: string) {
  const nextPlaces = readStagedPlaces().filter((place) => place.id !== id);
  writeFileSync(STAGING_FILE_PATH, `${JSON.stringify(nextPlaces, null, 2)}\n`);

  return nextPlaces;
}

export function stagePlace(input: AdminStagedPlaceInput) {
  const currentPlaces = readStagedPlaces();
  const normalizedStatus = normalizeDraftStatus(input.draftStatus);
  const idBase = slugify(
    [
      input.city,
      input.name,
      input.address,
      input.latitude?.toString() ?? "",
      input.longitude?.toString() ?? "",
    ]
      .filter(Boolean)
      .join(" "),
  );

  const stagedPlace: AdminStagedPlace = {
    id: idBase || `staged-${Date.now()}`,
    name: input.name.trim(),
    city: input.city.trim() || "Unknown",
    category: input.category.trim(),
    status: normalizedStatus.status,
    loved: normalizedStatus.loved,
    district: input.area.trim(),
    address: input.address.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    tabelog: input.tabelog.trim(),
    subway: input.subway.trim(),
    googleMapsUrl: (input.googleMapsUrl ?? "").trim(),
    verifiedStatus:
      input.verifiedStatus ||
      (input.latitude === null || input.longitude === null ? "Review" : ""),
    lastChecked: (input.lastChecked ?? "").trim(),
    verificationNotes: (input.verificationNotes ?? "").trim(),
    sourceLabel: input.sourceLabel.trim(),
    notes: input.notes,
    createdAt: new Date().toISOString(),
  };

  const nextPlaces = [
    ...currentPlaces.filter((place) => place.id !== stagedPlace.id),
    stagedPlace,
  ];

  writeFileSync(STAGING_FILE_PATH, `${JSON.stringify(nextPlaces, null, 2)}\n`);

  return stagedPlace;
}

function stagedPlaceToPlace(place: AdminStagedPlace): Place {
  if (place.latitude === null || place.longitude === null) {
    throw new Error(`Cannot publish ${place.name} without coordinates.`);
  }

  return {
    id: place.id,
    name: place.name,
    city: place.city,
    category: place.category,
    status: place.status,
    loved: place.loved,
    district: place.district,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    tabelog: place.tabelog,
    subway: place.subway,
    googleMapsUrl: place.googleMapsUrl,
    verifiedStatus: place.verifiedStatus,
    lastChecked: place.lastChecked,
    verificationNotes: place.verificationNotes,
  };
}

export function publishStagedPlaces({ allowDuplicates = false } = {}) {
  const stagedPlaces = readStagedPlaces();

  if (stagedPlaces.length === 0) {
    return { publishedCount: 0, places: [] as AdminStagedPlace[] };
  }

  const verifiedPlacesMissingUrls = stagedPlaces.filter(
    (place) => place.verifiedStatus === "Yes" && !place.googleMapsUrl?.trim(),
  );

  if (verifiedPlacesMissingUrls.length > 0) {
    return {
      places: stagedPlaces,
      publishedCount: 0,
      validationError: `${verifiedPlacesMissingUrls.length} verified staged place${
        verifiedPlacesMissingUrls.length === 1 ? "" : "s"
      } need a Google Maps URL before publishing.`,
    };
  }

  const currentPlaces = JSON.parse(
    readFileSync(PLACES_FILE_PATH, "utf8"),
  ) as Place[];
  const duplicatePlaces = stagedPlaces
    .map((place) => ({
      place,
      duplicateMatches: getDuplicateMatchesForStagedPlace(place, currentPlaces),
    }))
    .filter((place) => place.duplicateMatches.length > 0);

  if (!allowDuplicates && duplicatePlaces.length > 0) {
    return {
      duplicatePlaces,
      publishedCount: 0,
      places: stagedPlaces,
      requiresDuplicateConfirmation: true,
    };
  }

  const stagedMapPlaces = stagedPlaces.map(stagedPlaceToPlace);
  const stagedIds = new Set(stagedMapPlaces.map((place) => place.id));
  const nextPlaces = [
    ...currentPlaces.filter((place) => !stagedIds.has(place.id)),
    ...stagedMapPlaces,
  ].sort((firstPlace, secondPlace) => {
    const citySort = firstPlace.city.localeCompare(secondPlace.city);

    if (citySort !== 0) {
      return citySort;
    }

    return firstPlace.name.localeCompare(secondPlace.name);
  });

  writeFileSync(PLACES_FILE_PATH, `${JSON.stringify(nextPlaces, null, 2)}\n`);
  clearStagedPlaces();

  return { publishedCount: stagedPlaces.length, places: stagedPlaces };
}

function getPlaceStatusLabel(place: Pick<Place, "loved" | "status">) {
  if (place.loved) {
    return "Loved it";
  }

  if (place.status === "been") {
    return "Been";
  }

  if (place.status === "want_to_go") {
    return "Want to go";
  }

  return "Location";
}

function getStagedExportRows(places: AdminStagedPlace[]) {
  const headers = [
    "City",
    "Location Name",
    "Category",
    "Status",
    "Area",
    "Address",
    "Latitude",
    "Longitude",
    "Tabelog Score",
    "Nearest Subway",
    "Google Maps URL",
    "Verified?",
    "Last Checked",
    "Verification Notes",
    "Source",
    "Notes",
    "Created At",
  ];

  const rows = places.map((place) => [
    place.city,
    place.name,
    place.category,
    getPlaceStatusLabel(place),
    place.district,
    place.address,
    place.latitude ?? "",
    place.longitude ?? "",
    place.tabelog,
    place.subway,
    place.googleMapsUrl ?? "",
    place.verifiedStatus ?? "",
    place.lastChecked ?? "",
    place.verificationNotes ?? "",
    place.sourceLabel,
    place.notes.join(" | "),
    place.createdAt,
  ]);

  return [headers, ...rows];
}

function getProductionExportRows(places: Place[]) {
  const headers = [
    "Location Name",
    "Category",
    "Status",
    "Area",
    "Address",
    "Latitude",
    "Longitude",
    "Tabelog Score",
    "Nearest Subway",
    "Google Maps URL",
    "Google Place ID",
    "Canonical Name",
    "Canonical Address",
    "Verified Latitude",
    "Verified Longitude",
    "Candidate Coordinate Source",
    "Coordinate Precision",
    "Coordinate Confidence",
    "Distance Delta Meters",
    "Business Status",
    "Match Confidence",
    "Same Place Decision",
    "Same Place Reason",
    "Verification Decision",
    "Verification Source",
    "Name Score",
    "Address Score",
    "City Score",
    "District Score",
    "Country Score",
    "Ambiguity Score",
    "Verified?",
    "Last Checked",
    "Verification Notes",
  ];

  const rows = places.map((place) => [
    place.name,
    place.category,
    getPlaceStatusLabel(place),
    place.district,
    place.address,
    place.latitude,
    place.longitude,
    place.tabelog,
    place.subway,
    place.googleMapsUrl ?? "",
    place.googlePlaceId ?? "",
    place.canonicalName ?? "",
    place.canonicalAddress ?? "",
    place.verifiedLatitude ?? "",
    place.verifiedLongitude ?? "",
    place.candidateCoordinateSource ?? "",
    place.coordinatePrecision ?? "",
    place.coordinateConfidence ?? "",
    place.distanceDeltaMeters ?? "",
    place.businessStatus ?? "",
    place.matchConfidence ?? "",
    place.samePlaceDecision ?? "",
    place.samePlaceReason ?? "",
    place.verificationDecision ?? "",
    place.verificationSource ?? "",
    place.nameScore ?? "",
    place.addressScore ?? "",
    place.cityScore ?? "",
    place.districtScore ?? "",
    place.countryScore ?? "",
    place.ambiguityScore ?? "",
    place.verifiedStatus ?? "",
    place.lastChecked ?? "",
    place.verificationNotes ?? "",
  ]);

  return [headers, ...rows];
}

function getSafeWorksheetName(city: string, existingNames: Set<string>) {
  const fallbackName = "Unknown";
  const baseName =
    city
      .trim()
      .replace(/[:\\/?*\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 31) || fallbackName;
  let worksheetName = baseName;
  let suffix = 2;

  while (existingNames.has(worksheetName)) {
    const suffixText = ` ${suffix}`;
    worksheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`;
    suffix += 1;
  }

  existingNames.add(worksheetName);

  return worksheetName;
}

function getPlacesByCity<TPlace extends Pick<Place, "city" | "name">>(
  places: TPlace[],
) {
  return [...places]
    .sort((firstPlace, secondPlace) => {
      const citySort = firstPlace.city.localeCompare(secondPlace.city);

      if (citySort !== 0) {
        return citySort;
      }

      return firstPlace.name.localeCompare(secondPlace.name);
    })
    .reduce((cityMap, place) => {
      const city = place.city.trim() || "Unknown";
      cityMap.set(city, [...(cityMap.get(city) ?? []), place]);

      return cityMap;
    }, new Map<string, TPlace[]>());
}

function applyStagedExportWorksheetFormatting(
  worksheet: xlsx.WorkSheet,
  rowCount: number,
) {
  worksheet["!cols"] = [
    { wch: 14 },
    { wch: 32 },
    { wch: 22 },
    { wch: 14 },
    { wch: 22 },
    { wch: 48 },
    { wch: 14 },
    { wch: 14 },
    { wch: 28 },
    { wch: 24 },
    { wch: 42 },
    { wch: 16 },
    { wch: 18 },
    { wch: 44 },
    { wch: 36 },
    { wch: 44 },
    { wch: 24 },
  ];
  worksheet["!autofilter"] = { ref: `A1:Q${Math.max(1, rowCount)}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
}

function applyProductionExportWorksheetFormatting(
  worksheet: xlsx.WorkSheet,
  rowCount: number,
) {
  worksheet["!cols"] = [
    { wch: 34 },
    { wch: 22 },
    { wch: 14 },
    { wch: 22 },
    { wch: 52 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 42 },
    { wch: 24 },
    { wch: 34 },
    { wch: 52 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
    { wch: 22 },
    { wch: 18 },
    { wch: 20 },
    { wch: 64 },
    { wch: 32 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 16 },
    { wch: 18 },
    { wch: 44 },
  ];
  worksheet["!autofilter"] = { ref: `A1:AG${Math.max(1, rowCount)}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };
}

export function readProductionPlaces() {
  return JSON.parse(readFileSync(PLACES_FILE_PATH, "utf8")) as Place[];
}

export function updateProductionPlaceVerification(
  id: string,
  input: AdminProductionPlaceVerificationInput,
) {
  const currentPlaces = readProductionPlaces();
  const placeIndex = currentPlaces.findIndex((place) => place.id === id);

  if (placeIndex === -1) {
    return { error: "Production place was not found." };
  }

  const validationErrors = validatePlaceVerification(input);

  if (validationErrors.length > 0) {
    return { error: validationErrors.join(" ") };
  }

  const currentPlace = currentPlaces[placeIndex];
  if (!currentPlace || input.latitude === null || input.longitude === null) {
    return { error: "Valid latitude and longitude are required." };
  }

  const updatedPlace: Place = {
    ...currentPlace,
    address: input.address?.trim() || currentPlace.address,
    googleMapsUrl: input.googleMapsUrl.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    verifiedStatus: input.verifiedStatus,
    lastChecked: input.lastChecked.trim(),
    verificationNotes: input.verificationNotes.trim(),
  };
  const nextPlaces = currentPlaces.map((place) =>
    place.id === id ? updatedPlace : place,
  );

  writeFileSync(PLACES_FILE_PATH, `${JSON.stringify(nextPlaces, null, 2)}\n`);

  return { place: updatedPlace, places: nextPlaces };
}

export function stagedPlacesToWorkbookBuffer(places: AdminStagedPlace[]) {
  const workbook = xlsx.utils.book_new();
  const cityNames = new Set<string>();

  if (places.length === 0) {
    const worksheet = xlsx.utils.aoa_to_sheet(getStagedExportRows([]));

    applyStagedExportWorksheetFormatting(worksheet, 1);
    xlsx.utils.book_append_sheet(workbook, worksheet, "No Staged Places");

    return xlsx.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    }) as Buffer;
  }

  for (const [city, cityPlaces] of getPlacesByCity(places)) {
    const worksheet = xlsx.utils.aoa_to_sheet(getStagedExportRows(cityPlaces));
    const worksheetName = getSafeWorksheetName(city, cityNames);

    applyStagedExportWorksheetFormatting(worksheet, cityPlaces.length + 1);
    xlsx.utils.book_append_sheet(workbook, worksheet, worksheetName);
  }

  return xlsx.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}

export function productionPlacesToWorkbookBuffer(places: Place[]) {
  const workbook = xlsx.utils.book_new();
  const cityNames = new Set<string>();

  if (places.length === 0) {
    const worksheet = xlsx.utils.aoa_to_sheet(getProductionExportRows([]));

    applyProductionExportWorksheetFormatting(worksheet, 1);
    xlsx.utils.book_append_sheet(workbook, worksheet, "No Places");

    return xlsx.write(workbook, {
      bookType: "xlsx",
      type: "buffer",
    }) as Buffer;
  }

  for (const [city, cityPlaces] of getPlacesByCity(places)) {
    const worksheet = xlsx.utils.aoa_to_sheet(getProductionExportRows(cityPlaces));
    const worksheetName = getSafeWorksheetName(city, cityNames);

    applyProductionExportWorksheetFormatting(worksheet, cityPlaces.length + 1);
    xlsx.utils.book_append_sheet(workbook, worksheet, worksheetName);
  }

  return xlsx.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}
