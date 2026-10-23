import type { Place } from "@/lib/place";
import { getPlaceRecordVersion } from "@/lib/place-record-version";

/** One allowlist for every public guide. Never pass private review fields to the browser. */
export function toPublicPlace(place: Place): Place {
  return {
    id: place.id,
    recordVersion: getPlaceRecordVersion(place),
    name: place.name,
    city: place.city,
    category: place.category,
    status: place.status,
    loved: place.loved,
    district: place.district,
    address: place.address,
    latitude: place.latitude,
    longitude: place.longitude,
    tabelog: "",
    subway: "",
    googleMapsUrl: place.googleMapsUrl,
    googlePlaceId: place.googlePlaceId,
    notes: place.notes,
  };
}
