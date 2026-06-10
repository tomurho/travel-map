export type PlaceStatus = "been" | "want_to_go" | "location";
export type LovedFilter = "all" | "loved" | "unrated";
export type VerifiedStatus = "Yes" | "Review" | "No" | "Closed/Moved";
export type PlaceVerifiedStatus = VerifiedStatus | "";
export type SamePlaceDecision = "Yes" | "No" | "Unsure";
export type AdminSelectedSamePlaceDecision = SamePlaceDecision | "manually_selected";
export type VerificationDecisionKind =
  | "auto_verified_small_delta"
  | "auto_corrected_large_delta"
  | "auto_corrected_from_google_url"
  | "auto_corrected_from_place_id"
  | "auto_corrected_from_text_search"
  | "manually_verified"
  | "manually_selected_candidate"
  | "candidate_only_review"
  | "ambiguous_multiple_candidates"
  | "no_candidate_found"
  | "closed_or_moved";
export type VerificationSource =
  | "place_id"
  | "google_maps_url"
  | "google_place_id"
  | "google_places"
  | "google_text_search"
  | "free_geocoding"
  | "osm"
  | "cache"
  | "text_search"
  | "manual";
export type CoordinateSource =
  | "existing"
  | "cache"
  | "free_geocoding"
  | "osm"
  | "google"
  | "google_places"
  | "google_place_id"
  | "google_text_search"
  | "manual";
export type CoordinatePrecision =
  | "place_pin"
  | "address_geocode"
  | "building_centroid"
  | "approximate"
  | "manual"
  | "unknown";
export type CoordinateConfidence = "high" | "medium" | "low";

export interface Place {
  id: string;
  name: string;
  city: string;
  category: string;
  status: PlaceStatus;
  loved: boolean | null;
  district: string;
  address: string;
  latitude: number;
  longitude: number;
  tabelog: string;
  subway: string;
  googleMapsUrl?: string;
  googlePlaceId?: string;
  canonicalName?: string;
  canonicalAddress?: string;
  verifiedLatitude?: number;
  verifiedLongitude?: number;
  candidateCoordinateSource?: CoordinateSource;
  coordinatePrecision?: CoordinatePrecision;
  coordinateConfidence?: CoordinateConfidence;
  distanceDeltaMeters?: number;
  businessStatus?: string;
  matchConfidence?: number;
  samePlaceDecision?: AdminSelectedSamePlaceDecision;
  samePlaceReason?: string;
  verificationDecision?: VerificationDecisionKind;
  verificationSource?: VerificationSource;
  nameScore?: number;
  addressScore?: number;
  cityScore?: number;
  districtScore?: number;
  countryScore?: number;
  ambiguityScore?: number;
  verifiedStatus?: PlaceVerifiedStatus;
  lastChecked?: string;
  verificationNotes?: string;
  notes?: string[] | string;
}

export interface PlaceFilterState {
  city: string | "all";
  status: PlaceStatus | "all";
  category: string | "all";
  area: string | "all";
  loved: LovedFilter;
}

function normalizeAddressForComparison(address: string) {
  return address
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function getPlaceDetailsLookupAddress(
  place: Pick<Place, "address" | "canonicalAddress">,
) {
  return place.canonicalAddress?.trim() || place.address;
}

export function hasMaterialCanonicalAddressDifference(
  place: Pick<Place, "address" | "canonicalAddress">,
) {
  const address = place.address.trim();
  const canonicalAddress = place.canonicalAddress?.trim() ?? "";

  if (!address || !canonicalAddress) {
    return false;
  }

  return (
    normalizeAddressForComparison(address) !==
    normalizeAddressForComparison(canonicalAddress)
  );
}

export function getGoogleMapsHandoffUrl(
  place: Pick<Place, "address" | "googleMapsUrl" | "latitude" | "longitude" | "name">,
) {
  if (place.googleMapsUrl?.trim()) {
    return place.googleMapsUrl;
  }

  const query = [place.name, place.address].filter(Boolean).join(", ");

  if (query.trim()) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
}

export function getPublicNotes(place: Pick<Place, "notes">) {
  if (Array.isArray(place.notes)) {
    return place.notes.map((note) => note.trim()).filter(Boolean);
  }

  if (typeof place.notes === "string") {
    return place.notes
      .split("\n")
      .map((note) => note.trim())
      .filter(Boolean);
  }

  return [];
}
