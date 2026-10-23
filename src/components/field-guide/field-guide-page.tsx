import { FieldGuideApp } from "@/components/field-guide/field-guide-app";
import { isPublicPlace } from "@/lib/filtering";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";
import type { Place } from "@/lib/place";
import { normalizePlaceCity } from "@/lib/place-city";
import { toPublicPlace as allowlistedPublicPlace } from "@/lib/public-place";

export function toPublicPlace(place: Place): Place {
  return { ...allowlistedPublicPlace(place), city: normalizePlaceCity(place.city) };
}

export function FieldGuidePage() {
  const publicPlaces = readPlacesJsonSnapshot().places.filter(isPublicPlace).map(toPublicPlace);
  return <FieldGuideApp places={publicPlaces} />;
}
