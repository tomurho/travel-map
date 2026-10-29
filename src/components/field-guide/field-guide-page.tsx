import { FieldGuideApp } from "@/components/field-guide/field-guide-app";
import { isPublicPlace } from "@/lib/filtering";
import { readPublicPlaces } from "@/lib/public-catalogue";
import { sharedCatalogueEnabled } from "@/lib/catalogue-store";
import type { Place } from "@/lib/place";
import { normalizePlaceCity } from "@/lib/place-city";
import { toPublicPlace as allowlistedPublicPlace } from "@/lib/public-place";

export function toPublicPlace(place: Place): Place {
  return {
    ...allowlistedPublicPlace(place),
    city: normalizePlaceCity(place.city),
  };
}

export async function FieldGuidePage() {
  const publicPlaces = (await readPublicPlaces())
    .filter(isPublicPlace)
    .map(toPublicPlace);
  return (
    <FieldGuideApp
      places={publicPlaces}
      sharedCatalogue={sharedCatalogueEnabled()}
    />
  );
}
