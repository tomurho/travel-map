import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place } from "@/lib/place";

export type CityCenter = GeoPoint & { city: string };
export const nearbyCityRadiusKm = 80;

function median(values: number[]) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function getCityCenters(places: Place[]): CityCenter[] {
  const groups = new Map<string, Place[]>();
  for (const place of places) {
    const group = groups.get(place.city) ?? [];
    group.push(place);
    groups.set(place.city, group);
  }
  return Array.from(groups, ([city, group]) => ({
    city,
    latitude: median(group.map((place) => place.latitude)),
    longitude: median(group.map((place) => place.longitude)),
  }));
}

/** Sorting does not change the visible pins, and must not reset a manual map view. */
export function getMapPlacesKey(places: Place[]) {
  return JSON.stringify(places.map((place) => [place.id, place.latitude, place.longitude]).sort((first, second) => String(first[0]).localeCompare(String(second[0]))));
}

export function getCoordinateKey(place: GeoPoint) {
  return `${place.latitude}:${place.longitude}`;
}

export function getColocatedPlaces(places: Place[]) {
  const groups = new Map<string, Place[]>();
  for (const place of places) {
    const key = getCoordinateKey(place);
    const group = groups.get(key) ?? [];
    group.push(place);
    groups.set(key, group);
  }
  return groups;
}

/** Keep a distant saved trip in the results without letting it hide the city streets. */
export function getMapOverviewPlaces(places: Place[]) {
  if (places.length < 5 || new Set(places.map((place) => place.city)).size !== 1) return places;
  const center = getCityCenters(places)[0];
  const distances = places.map((place) => getDistanceKm(place, center));
  const threshold = Math.max(20, median(distances) * 6);
  const core = places.filter((_, index) => distances[index] <= threshold);
  return core.length >= 4 ? core : places;
}

export function findNearbyCity(location: GeoPoint, cityCenters: CityCenter[]) {
  const nearest = cityCenters.map((center) => ({ city: center.city, distance: getDistanceKm(location, center) }))
    .sort((first, second) => first.distance - second.distance)[0];
  return nearest && nearest.distance <= nearbyCityRadiusKm ? nearest.city : null;
}

export function getSelectedPlacePanOffset(mapHeight: number, bottomInset: number) {
  return Math.max(0, Math.min(bottomInset, mapHeight - 96)) / 2;
}
