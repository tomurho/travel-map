import { getPublicCatalogue } from "@/lib/catalogue";
import { catalogueResponse, catalogueFailure } from "@/lib/catalogue-http";
import {
  getCatalogueStore,
  sharedCatalogueEnabled,
} from "@/lib/catalogue-store";
import { readPlacesJsonSnapshot } from "@/lib/places-json-store";
import { seedCatalogueEntry } from "@/lib/catalogue";

export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const entries = sharedCatalogueEnabled()
      ? await getCatalogueStore().list()
      : readPlacesJsonSnapshot().places.map(seedCatalogueEntry);
    return catalogueResponse(getPublicCatalogue(entries));
  } catch (error) {
    return catalogueFailure(error);
  }
}
