import type { PlaceVerifiedStatus } from "@/lib/place";

export type AdminVerificationFilter =
  | "all"
  | "verified"
  | "review"
  | "unverified"
  | "closed_moved";

export type PlaceVerificationInput = {
  googleMapsUrl?: string;
  latitude: number | null;
  longitude: number | null;
  verifiedStatus?: PlaceVerifiedStatus;
};

export function formatDateForInput(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function markVerifiedToday<
  TPlace extends {
    lastChecked?: string;
    verifiedStatus?: PlaceVerifiedStatus;
  },
>(
  place: TPlace,
  today = new Date(),
) {
  return {
    ...place,
    lastChecked: formatDateForInput(today),
    verifiedStatus: "Yes" as const,
  };
}

function appendVerificationNote(currentNotes: string | undefined, note: string) {
  const trimmedNotes = currentNotes?.trim();

  return trimmedNotes ? `${trimmedNotes}\n${note}` : note;
}

export function acceptCandidateCoordinates<
  TPlace extends {
    latitude: number | null;
    longitude: number | null;
    lastChecked?: string;
    verificationNotes?: string;
    verifiedLatitude?: number;
    verifiedLongitude?: number;
    verifiedStatus?: PlaceVerifiedStatus;
  },
>(place: TPlace, today = new Date()) {
  if (
    typeof place.verifiedLatitude !== "number" ||
    typeof place.verifiedLongitude !== "number" ||
    !Number.isFinite(place.verifiedLatitude) ||
    !Number.isFinite(place.verifiedLongitude)
  ) {
    return place;
  }

  return {
    ...place,
    latitude: place.verifiedLatitude,
    longitude: place.verifiedLongitude,
    candidateCoordinateSource: "manual" as const,
    coordinateConfidence: "high" as const,
    coordinatePrecision: "manual" as const,
    lastChecked: formatDateForInput(today),
    verifiedStatus: "Yes" as const,
    verificationNotes: appendVerificationNote(
      place.verificationNotes,
      "Google Places candidate coordinates were accepted manually.",
    ),
  };
}

export function useCanonicalAddress<
  TPlace extends {
    address: string;
    canonicalAddress?: string;
  },
>(place: TPlace) {
  const canonicalAddress = place.canonicalAddress?.trim();

  if (!canonicalAddress) {
    return place;
  }

  return {
    ...place,
    address: canonicalAddress,
  };
}

export function isValidLatitude(latitude: number | null) {
  return latitude !== null && Number.isFinite(latitude) && latitude >= -90 && latitude <= 90;
}

export function isValidLongitude(longitude: number | null) {
  return (
    longitude !== null &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export function validatePlaceVerification(input: PlaceVerificationInput) {
  const errors: string[] = [];

  if (!isValidLatitude(input.latitude)) {
    errors.push("Latitude must be a number between -90 and 90.");
  }

  if (!isValidLongitude(input.longitude)) {
    errors.push("Longitude must be a number between -180 and 180.");
  }

  if (input.verifiedStatus === "Yes") {
    if (!input.googleMapsUrl?.trim()) {
      errors.push("Google Maps URL is required when Verified? is Yes.");
    }

    if (!isValidLatitude(input.latitude) || !isValidLongitude(input.longitude)) {
      errors.push("Valid latitude and longitude are required when Verified? is Yes.");
    }
  }

  return errors;
}

export function getVerificationFilterBucket(
  status: PlaceVerifiedStatus | undefined,
): Exclude<AdminVerificationFilter, "all"> {
  if (status === "Yes") {
    return "verified";
  }

  if (status === "Review") {
    return "review";
  }

  if (status === "Closed/Moved") {
    return "closed_moved";
  }

  return "unverified";
}

export function matchesVerificationFilter(
  status: PlaceVerifiedStatus | undefined,
  filter: AdminVerificationFilter,
) {
  return filter === "all" || getVerificationFilterBucket(status) === filter;
}

export function getCompactVerificationLabel(status: PlaceVerifiedStatus | undefined) {
  if (status === "Yes") {
    return "Verified";
  }

  if (status === "Review") {
    return "Review";
  }

  if (status === "Closed/Moved") {
    return "Closed/Moved";
  }

  return "Unverified";
}
