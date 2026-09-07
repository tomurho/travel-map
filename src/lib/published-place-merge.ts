import type { Place } from "@/lib/place";
import { normalizePlaceCity } from "@/lib/place-city";
import { describeFieldChanges } from "@/lib/pipeline-preview";

export const verificationFields = [
  "verifiedStatus", "lastChecked", "verificationNotes", "canonicalName",
  "canonicalAddress", "verifiedLatitude", "verifiedLongitude",
  "candidateCoordinateSource", "coordinatePrecision", "coordinateConfidence",
  "distanceDeltaMeters", "businessStatus", "matchConfidence", "samePlaceDecision",
  "samePlaceReason", "verificationDecision", "verificationSource", "nameScore",
  "addressScore", "cityScore", "districtScore", "countryScore", "ambiguityScore",
] as const satisfies readonly (keyof Place)[];

export const venueFields = [
  "name", "city", "district", "address", "latitude", "longitude",
  "googleMapsUrl", "googlePlaceId",
] as const;

function populated(value: unknown) {
  return value !== undefined && value !== null &&
    (typeof value !== "string" || value.trim() !== "");
}

function comparableVenue(place: Place) {
  return Object.fromEntries(venueFields.map((field) => {
    const value = field === "city" ? normalizePlaceCity(place.city) : place[field];
    return [field, typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value ?? ""];
  }));
}

export function mergePublishedPlace(existing: Place, incoming: Place) {
  if (existing.verifiedStatus === "Closed/Moved") {
    return { kind: "closed" as const, place: existing };
  }

  const protectedVerification = verificationFields.some((field) => populated(existing[field]));
  const venueChanges = describeFieldChanges(comparableVenue(existing), comparableVenue(incoming));
  if (protectedVerification && venueChanges.length > 0) {
    return { kind: "conflict" as const, changes: venueChanges, place: existing };
  }

  // Start with the local record so fields not represented in Published survive.
  const next: Place = {
    ...existing,
    ...incoming,
    category: existing.category,
    loved: existing.loved,
    status: existing.status,
    tabelog: existing.tabelog,
    subway: existing.subway,
  };
  if (protectedVerification) {
    for (const field of verificationFields) {
      // Preserve absence as well as values; don't manufacture a new decision/date.
      Object.assign(next, { [field]: existing[field] });
    }
    // Formatting-only differences must not move a verified pin or rename its evidence.
    for (const field of venueFields) Object.assign(next, { [field]: existing[field] });
  }
  return { kind: "merged" as const, place: next };
}

export function verifyPublishedCorrection(
  existing: Place,
  incoming: Place,
  verificationNote: string,
  checkedAt = new Date().toISOString(),
): Place {
  const next = { ...existing };
  for (const field of venueFields) Object.assign(next, { [field]: incoming[field] });
  // Old candidate scores and decisions described the previous venue/pin.
  // The atomic store backs up the old record before replacing this evidence.
  for (const field of verificationFields) delete next[field];
  return {
    ...next,
    verifiedStatus: "Yes",
    verificationSource: "manual",
    verificationDecision: "manually_verified",
    lastChecked: checkedAt,
    verificationNotes: verificationNote.trim(),
  };
}
