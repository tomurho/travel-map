import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as xlsx from "xlsx";

import type { Place, PlaceStatus } from "@/lib/place";

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
  sourceLabel: string;
  notes: string[];
  createdAt: string;
}

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
  sourceLabel: string;
  notes: string[];
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
  };
}

export function publishStagedPlaces() {
  const stagedPlaces = readStagedPlaces();

  if (stagedPlaces.length === 0) {
    return { publishedCount: 0, places: [] as AdminStagedPlace[] };
  }

  const currentPlaces = JSON.parse(
    readFileSync(PLACES_FILE_PATH, "utf8"),
  ) as Place[];
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

function getExportRows(places: AdminStagedPlace[]) {
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
    "Source",
    "Notes",
    "Created At",
  ];

  const rows = places.map((place) => [
    place.city,
    place.name,
    place.category,
    place.loved ? "Loved it" : place.status,
    place.district,
    place.address,
    place.latitude ?? "",
    place.longitude ?? "",
    place.tabelog,
    place.subway,
    place.sourceLabel,
    place.notes.join(" | "),
    place.createdAt,
  ]);

  return [headers, ...rows];
}

export function stagedPlacesToWorkbookBuffer(places: AdminStagedPlace[]) {
  const workbook = xlsx.utils.book_new();
  const worksheet = xlsx.utils.aoa_to_sheet(getExportRows(places));

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
    { wch: 36 },
    { wch: 44 },
    { wch: 24 },
  ];
  worksheet["!autofilter"] = { ref: `A1:M${Math.max(1, places.length + 1)}` };
  worksheet["!freeze"] = { xSplit: 0, ySplit: 1 };

  xlsx.utils.book_append_sheet(workbook, worksheet, "Staged Places");

  return xlsx.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
}
