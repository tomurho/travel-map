import { TravelAtlasConcept } from "@/components/travel-atlas-concept";
import { isPublicPlace } from "@/lib/filtering";
import type { Place } from "@/lib/place";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export const dynamic = "force-dynamic";

function toPublicPlace(place: Place): Place {
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
    tabelog: "",
    subway: "",
    googleMapsUrl: place.googleMapsUrl,
    googlePlaceId: place.googlePlaceId,
    notes: place.notes,
  };
}

export default function ConceptPage() {
  const places = readPlacesJsonSnapshot().places;
  return (
    <TravelAtlasConcept
      places={(places as Place[]).filter(isPublicPlace).map(toPublicPlace)}
    />
  );
}
