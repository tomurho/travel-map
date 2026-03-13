import places from "@/data/places.json";
import { TravelMapApp } from "@/components/travel-map-app";
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

export default async function Home({ searchParams }: PageProps) {
  const params = await searchParams;
  const status = readStatus(readSearchParam(params.status));
  const loved = readLoved(readSearchParam(params.loved));

  const initialFilters: PlaceFilterState = {
    status,
    category: readSearchParam(params.category) ?? "all",
    area: readSearchParam(params.area) ?? "all",
    loved: status === "been" ? loved : "all",
  };

  return (
    <TravelMapApp
      places={places as Place[]}
      initialFilters={initialFilters}
    />
  );
}
