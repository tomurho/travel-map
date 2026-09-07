import { filterAndSortFieldGuidePlaces, resolveFieldGuideCityPreference, type FieldGuideFilters } from "@/lib/field-guide";
import { isPublicPlace } from "@/lib/filtering";
import type { GeoPoint } from "@/lib/geo";
import { normalizePlaceCity } from "@/lib/place-city";
import type { Place } from "@/lib/place";
import { getPlaceTypeAliases, getPlaceTypeGroup, normalizeApprovedPlaceType, normalizePlaceSearch, resolvePlaceTypeOption } from "@/lib/place-types";

// Keep the pilot's chip ordering and provisional memberships for deferred types.
// Approved memberships come from the shared catalog; neither changes a place here.
export const explorerGroups = [
  { id: "all", label: "All categories", categories: [] },
  { id: "food", label: "Food", categories: [
    "Soba", "Tempura", "Ramen", "Kaiseki", "Izakaya", "Japanese Cuisine",
    "Beef", "Restaurant", "Chinese", "Tofu Dishes", "Unagi", "Vegetarian",
    "Curry", "French", "Gyoza", "Kushiage", "Okonomiyaki", "Sandwich",
    "Udon", "Yakitori", "Fusion", "Hot Pot", "Italian", "Obanzai", "Oden",
    "Onigiri", "Oyakodon", "Sukiyaki", "Sukiyaki/Shabu Shabu", "Tonkatsu", "Tsukemen",
  ] },
  { id: "coffee", label: "Coffee & cafés", categories: ["Coffee", "Cafe"] },
  { id: "tea", label: "Tea", categories: ["Tea house"] },
  { id: "desserts", label: "Desserts & bakeries", categories: ["Sweets", "Bakery", "Japanese sweets", "Kakigori", "Gelato"] },
  { id: "bars", label: "Bars", categories: ["Wine bar", "Cider Bar", "Bar"] },
  { id: "shopping", label: "Shopping", categories: ["Grocery"] },
  { id: "sights", label: "Sights & culture", categories: [] },
] as const;

export type ExplorerGroup = (typeof explorerGroups)[number]["id"];
export type ExplorerFilters = FieldGuideFilters & { group: ExplorerGroup };

export function getExplorerGroup(group: ExplorerGroup) {
  return explorerGroups.find((option) => option.id === group)!;
}

export function matchesExplorerGroup(place: Place, group: ExplorerGroup) {
  return group === "all" || getPlaceTypeGroup(place.category) === group || (getExplorerGroup(group).categories as readonly string[]).includes(place.category);
}

export function specialtyLabel(category: string) {
  return ({ "Wine bar": "Wine", "Cider bar": "Cider", Bar: "Bars", "Café": "Cafés" } as Record<string, string>)[normalizeApprovedPlaceType(category)] ?? category;
}

export function readExplorerFilters(
  places: Place[], params: URLSearchParams,
  options: { fixedCity?: string; defaultGroup?: ExplorerGroup; rememberedCity?: string | null } = {},
): ExplorerFilters {
  const publicPlaces = places.filter(isPublicPlace);
  const city = options.fixedCity ?? resolveFieldGuideCityPreference(publicPlaces, params.get("city"), options.rememberedCity ?? null);
  const cityPlaces = publicPlaces.filter((place) => normalizePlaceCity(place.city) === city);
  const requestedCategory = params.get("specialty") ?? params.get("category") ?? "all";
  const category = resolvePlaceTypeOption(requestedCategory, cityPlaces.map((place) => place.category));
  // Old category bookmarks choose the matching group. An explicit group wins.
  const legacyGroup = !params.has("group") && category !== "all"
    ? explorerGroups.find((group) => group.id !== "all" && cityPlaces.some((place) => place.category === category && matchesExplorerGroup(place, group.id)))?.id
    : undefined;
  const group = explorerGroups.find((option) => option.id === params.get("group"))?.id ?? legacyGroup ?? options.defaultGroup ?? "all";
  const groupPlaces = cityPlaces.filter((place) => matchesExplorerGroup(place, group));
  const area = params.get("area") ?? "all";
  const lovedOnly = ["1", "loved"].includes(params.get("loved") ?? "");
  return {
    city, group,
    category: groupPlaces.some((place) => place.category === category) ? category : "all",
    area: groupPlaces.some((place) => place.district === area) ? area : "all",
    status: params.get("status") === "want_to_go" && !lovedOnly ? "want_to_go" : "all",
    lovedOnly, query: params.get("q") ?? "",
  };
}

export function buildExplorerQuery(filters: ExplorerFilters, view: "map" | "list", includeCity = true) {
  const params = new URLSearchParams({ group: filters.group });
  if (includeCity && filters.city) params.set("city", filters.city);
  if (filters.category !== "all") params.set("specialty", filters.category);
  if (filters.area !== "all") params.set("area", filters.area);
  if (filters.status !== "all") params.set("status", filters.status);
  if (filters.lovedOnly) params.set("loved", "1");
  if (filters.query) params.set("q", filters.query);
  if (view === "list") params.set("view", "list");
  return params.toString();
}

export function filterExplorerPlaces(
  places: Place[], filters: ExplorerFilters,
  nearby: { nearbyActive: boolean; userLocation: GeoPoint | null } = { nearbyActive: false, userLocation: null },
) {
  const query = normalizePlaceSearch(filters.query.trim());
  const candidates = places.filter((place) => {
    if (!isPublicPlace(place) || normalizePlaceCity(place.city) !== filters.city || !matchesExplorerGroup(place, filters.group)) return false;
    const labels = explorerGroups.filter((group) => group.id !== "all" && matchesExplorerGroup(place, group.id)).map((group) => group.label);
    return !query || normalizePlaceSearch([place.name, place.category, place.district, ...labels, ...getPlaceTypeAliases(place.category)].join(" ")).includes(query);
  });
  return filterAndSortFieldGuidePlaces(candidates, { ...filters, query: "" }, nearby);
}

export function getExplorerSpecialties(places: Place[], filters: ExplorerFilters) {
  const candidates = filterExplorerPlaces(places, { ...filters, category: "all" });
  const counts = new Map<string, number>();
  for (const place of candidates) counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
  // Retain zero-result choices under refinements so selection never silently broadens.
  const groupCategories = new Set(places.filter((place) => normalizePlaceCity(place.city) === filters.city && isPublicPlace(place) && matchesExplorerGroup(place, filters.group)).map((place) => place.category));
  const preferred = getExplorerGroup(filters.group).categories.map(normalizeApprovedPlaceType);
  return [...groupCategories].sort((a, b) => {
    const first = preferred.indexOf(normalizeApprovedPlaceType(a)), second = preferred.indexOf(normalizeApprovedPlaceType(b));
    return (first < 0 ? Infinity : first) - (second < 0 ? Infinity : second) || a.localeCompare(b);
  }).map((category) => ({ category, label: specialtyLabel(category), count: counts.get(category) ?? 0 }));
}
