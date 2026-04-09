import type { Place, PlaceFilterState } from "@/lib/place";

export function getCategories(places: Place[]) {
  return Array.from(new Set(places.map((place) => place.category))).sort();
}

export function getAvailableCategories(
  places: Place[],
  filters: Omit<PlaceFilterState, "category">,
) {
  return Array.from(
    new Set(
      filterPlaces(places, {
        ...filters,
        category: "all",
      }).map((place) => place.category),
    ),
  ).sort();
}

export function getAreas(places: Place[]) {
  return Array.from(
    new Set(
      places
        .map((place) => place.district)
        .filter((district) => district.trim().length > 0),
    ),
  ).sort();
}

export function filterPlaces(places: Place[], filters: PlaceFilterState) {
  return places.filter((place) => {
    if (filters.status !== "all" && place.status !== filters.status) {
      return false;
    }

    if (filters.category !== "all" && place.category !== filters.category) {
      return false;
    }

    if (filters.area !== "all" && place.district !== filters.area) {
      return false;
    }

    if (filters.status !== "been" && filters.loved !== "all") {
      return true;
    }

    if (filters.loved === "loved" && place.loved !== true) {
      return false;
    }

    if (filters.loved === "unrated" && place.loved !== null) {
      return false;
    }

    return true;
  });
}

export function countByStatus(places: Place[]) {
  return places.reduce(
    (accumulator, place) => {
      accumulator[place.status] += 1;
      return accumulator;
    },
    { been: 0, want_to_go: 0, location: 0 },
  );
}
