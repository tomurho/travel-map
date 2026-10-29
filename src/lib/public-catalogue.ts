import { getPublicCatalogue } from "@/lib/catalogue";
import {
  getCatalogueStore,
  sharedCatalogueEnabled,
} from "@/lib/catalogue-store";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";

export async function readPublicPlaces() {
  if (!sharedCatalogueEnabled()) return readPlacesJsonSnapshot().places;
  return getPublicCatalogue(await getCatalogueStore().list()).places;
}
