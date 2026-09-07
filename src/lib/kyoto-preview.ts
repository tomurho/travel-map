// Compatibility for the original Kyoto pilot and its saved URLs.
import type { Place } from "@/lib/place";
import {
  readExplorerFilters, buildExplorerQuery, filterExplorerPlaces, getExplorerSpecialties,
  type ExplorerFilters,
} from "@/lib/field-guide-explorer";
export {
  explorerGroups as previewGroups, getExplorerGroup as getPreviewGroup,
  matchesExplorerGroup as matchesPreviewGroup, specialtyLabel,
  type ExplorerGroup as PreviewGroup, type ExplorerFilters as KyotoPreviewFilters,
} from "@/lib/field-guide-explorer";
export const filterKyotoPreviewPlaces = filterExplorerPlaces;
export const getPreviewSpecialties = getExplorerSpecialties;
export function readKyotoPreviewFilters(places: Place[], params: URLSearchParams) {
  return readExplorerFilters(places, params, { fixedCity: "Kyoto", defaultGroup: "bars" });
}
export function buildKyotoPreviewQuery(filters: ExplorerFilters, view: "map" | "list") {
  return buildExplorerQuery(filters, view, false);
}
