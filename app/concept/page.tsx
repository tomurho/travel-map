import { TravelAtlasConcept } from "@/components/travel-atlas-concept";
import { isPublicPlace } from "@/lib/filtering";
import type { Place } from "@/lib/place";
import { readPublicPlaces } from "@/lib/public-catalogue";
import { toPublicPlace } from "@/lib/public-place";

export const dynamic = "force-dynamic";

export default async function ConceptPage() {
  const places = await readPublicPlaces();
  return (
    <TravelAtlasConcept
      places={(places as Place[]).filter(isPublicPlace).map(toPublicPlace)}
    />
  );
}
