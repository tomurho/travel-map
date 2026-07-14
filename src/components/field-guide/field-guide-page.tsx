import places from "@/data/places.json";
import { FieldGuideApp } from "@/components/field-guide/field-guide-app";
import { isPublicPlace } from "@/lib/filtering";
import {
  getDefaultFieldGuideCity,
  type FieldGuideFilters,
} from "@/lib/field-guide";
import type { Place } from "@/lib/place";

type FieldGuidePageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function readStatus(value: string | undefined): FieldGuideFilters["status"] {
  return value === "want_to_go" ? value : "all";
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

export async function FieldGuidePage({
  searchParams,
}: FieldGuidePageProps) {
  const params = await searchParams;
  const publicPlaces = (places as Place[]).filter(isPublicPlace).map(toPublicPlace);
  const lovedParam = readParam(params.loved);
  const initialFilters: FieldGuideFilters = {
    city: readParam(params.city) ?? getDefaultFieldGuideCity(publicPlaces),
    status: readStatus(readParam(params.status)),
    category: readParam(params.category) ?? "all",
    area: readParam(params.area) ?? "all",
    lovedOnly: lovedParam === "1" || lovedParam === "loved",
    query: readParam(params.q) ?? "",
  };

  return <FieldGuideApp initialFilters={initialFilters} places={publicPlaces} />;
}
