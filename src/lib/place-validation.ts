const stringFields = [
  "id", "name", "city", "category", "district", "address", "tabelog", "subway",
  "googleMapsUrl", "googlePlaceId", "canonicalName", "canonicalAddress", "businessStatus",
  "samePlaceReason", "lastChecked", "verificationNotes", "recordVersion",
] as const;
const numberFields = [
  "latitude", "longitude", "verifiedLatitude", "verifiedLongitude", "distanceDeltaMeters",
  "matchConfidence", "nameScore", "addressScore", "cityScore", "districtScore",
  "countryScore", "ambiguityScore",
] as const;
const enumFields: Record<string, readonly string[]> = {
  status: ["location", "been", "want_to_go"],
  verifiedStatus: ["", "Yes", "Review", "No", "Closed/Moved"],
  samePlaceDecision: ["Yes", "No", "Unsure", "manually_selected"],
  verificationDecision: ["auto_verified_small_delta", "auto_corrected_large_delta", "auto_corrected_from_google_url", "auto_corrected_from_place_id", "auto_corrected_from_text_search", "manually_verified", "manually_selected_candidate", "candidate_only_review", "ambiguous_multiple_candidates", "no_candidate_found", "closed_or_moved"],
  verificationSource: ["place_id", "google_maps_url", "google_place_id", "google_places", "google_text_search", "free_geocoding", "osm", "cache", "text_search", "manual"],
  candidateCoordinateSource: ["existing", "cache", "free_geocoding", "osm", "google", "google_places", "google_place_id", "google_text_search", "manual"],
  coordinatePrecision: ["place_pin", "address_geocode", "building_centroid", "approximate", "manual", "unknown"],
  coordinateConfidence: ["high", "medium", "low"],
};
const requiredPlaceFields = ["id", "name", "city", "category", "status", "loved", "district", "address", "latitude", "longitude", "tabelog", "subway"];

export function getPlaceFieldErrors(input: unknown, options: { partial?: boolean } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return ["Place must be a JSON object."];
  }
  const value = input as Record<string, unknown>;
  const errors: string[] = [];
  if (!options.partial) {
    for (const field of requiredPlaceFields) {
      if (value[field] === undefined) errors.push(`${field} is required.`);
    }
  }
  for (const field of stringFields) {
    if (value[field] !== undefined && typeof value[field] !== "string") errors.push(`${field} must be a string.`);
  }
  for (const field of ["id", "name", "city", "category"]) {
    if (typeof value[field] === "string" && !value[field].trim()) errors.push(`${field} must not be empty.`);
  }
  for (const field of numberFields) {
    if (value[field] !== undefined && (typeof value[field] !== "number" || !Number.isFinite(value[field]))) errors.push(`${field} must be a finite number.`);
  }
  for (const field of ["latitude", "verifiedLatitude"]) {
    if (typeof value[field] === "number" && (value[field] < -90 || value[field] > 90)) errors.push(`${field} must be between -90 and 90.`);
  }
  for (const field of ["longitude", "verifiedLongitude"]) {
    if (typeof value[field] === "number" && (value[field] < -180 || value[field] > 180)) errors.push(`${field} must be between -180 and 180.`);
  }
  if (value.loved !== undefined && value.loved !== null && typeof value.loved !== "boolean") errors.push("loved must be true, false, or null.");
  for (const [field, values] of Object.entries(enumFields)) {
    if (value[field] !== undefined && (typeof value[field] !== "string" || !values.includes(value[field]))) errors.push(`${field} has an invalid value.`);
  }
  if (value.notes !== undefined && typeof value.notes !== "string" && !(Array.isArray(value.notes) && value.notes.every((note) => typeof note === "string"))) errors.push("notes must be a string or an array of strings.");
  if (typeof value.googleMapsUrl === "string" && value.googleMapsUrl.trim()) {
    try {
      const url = new URL(value.googleMapsUrl);
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid URL");
    } catch {
      errors.push("googleMapsUrl must be an HTTP or HTTPS URL without a username or password.");
    }
  }
  return errors;
}
