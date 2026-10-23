import { TravelAtlasConcept } from "@/components/travel-atlas-concept";
import { isPublicPlace } from "@/lib/filtering";
import type { Place } from "@/lib/place";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";
import { toPublicPlace } from "@/lib/public-place";

export const dynamic = "force-dynamic";

export default function ConceptPage() {
  const places = readPlacesJsonSnapshot().places;
  return (
    <TravelAtlasConcept
      places={(places as Place[]).filter(isPublicPlace).map(toPublicPlace)}
    />
  );
}
