import type { Place, PlaceStatus } from "@/lib/place";

export type SpreadsheetRow = Record<string, unknown>;

type NormalizedResult =
  | { ok: true; place: Place }
  | { ok: false; reason: string };

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
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

  if (
    normalized === "been" ||
    normalized === "visited" ||
    normalized === "been to" ||
    normalized === "done"
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

export function normalizePlaceRow(row: SpreadsheetRow): NormalizedResult {
  const name = readText(row, [
    "location name",
    "Location Name",
    "name",
    "location",
  ]);
  const category =
    readText(row, ["category", "Category", "Verified Category", "type"]) ||
    "Uncategorized";
  const statusRaw = readText(row, ["status", "Status"]);
  const district = readText(row, [
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
    readText(row, ["loved it", "Loved it", "loved", "favorite"]),
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
      category,
      status,
      loved,
      district,
      address,
      latitude,
      longitude,
    },
  };
}

export function normalizePlaces(rows: SpreadsheetRow[]) {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  const places: Place[] = [];

  for (const row of rows) {
    const normalized = normalizePlaceRow(row);

    if (!normalized.ok) {
      errors.push(normalized.reason);
      continue;
    }

    const duplicateCount = seen.get(normalized.place.id) ?? 0;
    seen.set(normalized.place.id, duplicateCount + 1);

    places.push({
      ...normalized.place,
      id:
        duplicateCount === 0
          ? normalized.place.id
          : `${normalized.place.id}-${duplicateCount + 1}`,
    });
  }

  return { places, errors };
}
