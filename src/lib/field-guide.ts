import { getDistanceKm, type GeoPoint } from "@/lib/geo";
import type { Place } from "@/lib/place";

export type FieldGuideFilters = {
  city: string;
  status: "want_to_go" | "all";
  category: string;
  area: string;
  lovedOnly: boolean;
  query: string;
};

export function getDefaultFieldGuideCity(places: Place[]) {
  const cities = Array.from(new Set(places.map((place) => place.city))).sort();

  if (cities.includes("Ho Chi Minh City")) {
    return "Ho Chi Minh City";
  }

  return cities[0] ?? "";
}

export function normalizeFieldGuideFilters(
  places: Place[],
  filters: FieldGuideFilters,
): FieldGuideFilters {
  const cities = new Set(places.map((place) => place.city));

  return {
    ...filters,
    city: cities.has(filters.city) ? filters.city : getDefaultFieldGuideCity(places),
    status:
      filters.status === "want_to_go" && !filters.lovedOnly
        ? "want_to_go"
        : "all",
  };
}

export function toggleFieldGuideLoved(
  filters: FieldGuideFilters,
): FieldGuideFilters {
  const lovedOnly = !filters.lovedOnly;

  return {
    ...filters,
    lovedOnly,
    status:
      lovedOnly && filters.status === "want_to_go" ? "all" : filters.status,
  };
}

export function toggleFieldGuideWantToGo(
  filters: FieldGuideFilters,
): FieldGuideFilters {
  const wantToGo = filters.status !== "want_to_go";

  return {
    ...filters,
    lovedOnly: false,
    status: wantToGo ? "want_to_go" : "all",
  };
}

export function filterAndSortFieldGuidePlaces(
  places: Place[],
  filters: FieldGuideFilters,
  options: {
    nearbyActive: boolean;
    userLocation: GeoPoint | null;
  },
) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase();

  return places
    .filter((place) => place.city === filters.city)
    .filter((place) => filters.status === "all" || place.status === filters.status)
    .filter(
      (place) => filters.category === "all" || place.category === filters.category,
    )
    .filter((place) => filters.area === "all" || place.district === filters.area)
    .filter((place) => !filters.lovedOnly || place.loved === true)
    .filter((place) => {
      if (!normalizedQuery) {
        return true;
      }

      return [place.name, place.category, place.district]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    })
    .sort((firstPlace, secondPlace) => {
      if (options.nearbyActive && options.userLocation) {
        const firstDistance = getDistanceKm(options.userLocation, {
          latitude: firstPlace.latitude,
          longitude: firstPlace.longitude,
        });
        const secondDistance = getDistanceKm(options.userLocation, {
          latitude: secondPlace.latitude,
          longitude: secondPlace.longitude,
        });

        if (firstDistance !== secondDistance) {
          return firstDistance - secondDistance;
        }
      }

      if (firstPlace.loved !== secondPlace.loved) {
        return firstPlace.loved ? -1 : 1;
      }

      return firstPlace.name.localeCompare(secondPlace.name);
    });
}

export function buildFieldGuideQuery(filters: FieldGuideFilters) {
  const params = new URLSearchParams();

  if (filters.city) {
    params.set("city", filters.city);
  }
  if (filters.status !== "all") {
    params.set("status", filters.status);
  }
  if (filters.category !== "all") {
    params.set("category", filters.category);
  }
  if (filters.area !== "all") {
    params.set("area", filters.area);
  }
  if (filters.lovedOnly) {
    params.set("loved", "1");
  }
  if (filters.query.trim()) {
    params.set("q", filters.query.trim());
  }

  return params.toString();
}
