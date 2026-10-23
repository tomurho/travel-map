import { getDistanceKm } from "@/lib/geo";
import { normalizePlaceCity } from "@/lib/place-city";

type CatalogLocation = {
  id?: string;
  name?: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  googlePlaceId?: string;
};

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function getCatalogWarnings(record: CatalogLocation, catalog: CatalogLocation[]): string[] {
  const warnings: string[] = [];
  if (record.googlePlaceId?.trim()) {
    const duplicates = catalog.filter((place) => place.id !== record.id && place.googlePlaceId?.trim() === record.googlePlaceId?.trim());
    if (duplicates.length) warnings.push(`Same Google Place ID as ${duplicates.map((place) => `${place.name || "Unnamed place"} (${place.id})`).join(", ")}. Check whether these are the same venue before publishing.`);
  }
  const reference = catalog.filter((place) => place.id !== record.id && normalizePlaceCity(place.city) === normalizePlaceCity(record.city) && typeof place.latitude === "number" && typeof place.longitude === "number" && Number.isFinite(place.latitude) && Number.isFinite(place.longitude));
  if (reference.length >= 3 && typeof record.latitude === "number" && typeof record.longitude === "number" && Number.isFinite(record.latitude) && Number.isFinite(record.longitude)) {
    const distance = getDistanceKm({ latitude: record.latitude, longitude: record.longitude }, { latitude: median(reference.map((place) => place.latitude!)), longitude: median(reference.map((place) => place.longitude!)) });
    if (distance > 25) warnings.push(`${distance.toFixed(1)} km from the center of saved ${record.city} places. Check the city and pin; this may be a day trip.`);
  }
  return warnings;
}
