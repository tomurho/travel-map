import { FieldGuideApp } from "@/components/field-guide/field-guide-app";
import { isPublicPlace } from "@/lib/filtering";
import type { Place } from "@/lib/place";
import { normalizePlaceCity } from "@/lib/place-city";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export function toPublicPlace(place: Place): Place {
  return {
    id: place.id,
    name: place.name,
    city: normalizePlaceCity(place.city),
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

export function FieldGuidePage() {
  const publicPlaces = readPlacesJsonSnapshot().places.filter(isPublicPlace).map(toPublicPlace);
  return <FieldGuideApp places={publicPlaces} />;
}
