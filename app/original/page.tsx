import places from "@/data/places.json";
import { TravelMapApp } from "@/components/travel-map-app";
import { isPublicPlace } from "@/lib/filtering";
import type {
  LovedFilter,
  Place,
  PlaceFilterState,
  PlaceStatus,
} from "@/lib/place";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readSearchParam(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function readStatus(value: string | undefined): PlaceStatus | "all" {
  return value === "been" || value === "want_to_go" || value === "location"
    ? value
    : "all";
}

function readLoved(value: string | undefined): LovedFilter {
  return value === "loved" || value === "unrated"
    ? value
    : "all";
}

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

export default async function OriginalPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = readStatus(readSearchParam(params.status));
  const loved = readLoved(readSearchParam(params.loved));

  const initialFilters: PlaceFilterState = {
    city: readSearchParam(params.city) ?? "all",
    status,
    category: readSearchParam(params.category) ?? "all",
    area: readSearchParam(params.area) ?? "all",
    loved: status === "been" ? loved : "all",
  };

  return (
    <TravelMapApp
      places={(places as Place[]).filter(isPublicPlace).map(toPublicPlace)}
      initialFilters={initialFilters}
    />
  );
}
