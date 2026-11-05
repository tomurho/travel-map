import type { CatalogueEntry } from "@/lib/catalogue";

export type CatalogueLookupOptions = {
  query?: string;
  mapsUrl?: string;
  city?: string;
};

export function catalogueLookupInput(
  entry: CatalogueEntry,
  options: CatalogueLookupOptions = {},
) {
  const place = entry.draft ?? entry.live;
  return {
    query: options.query?.trim() || place?.name || entry.input.name,
    city: options.city?.trim() || place?.city || entry.input.city,
    // An explicit empty value lets the owner clear a link and use text search.
    mapsUrl: (
      options.mapsUrl ?? entry.input.mapsUrl ?? place?.googleMapsUrl ?? ""
    ).trim(),
  };
}
