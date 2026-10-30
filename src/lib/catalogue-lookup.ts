import {
  CatalogueError,
  type CatalogueCandidate,
  type CatalogueInput,
} from "@/lib/catalogue";
import { extractGooglePlaceIdFromUrl } from "@/lib/google-place-admin-resolver";
import {
  fetchSupportedProviderUrl,
  parseSupportedProviderUrl,
} from "@/lib/provider-url";

type GoogleResult = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  googleMapsUri?: string;
  types?: string[];
  businessStatus?: string;
};
const fields =
  "id,displayName,formattedAddress,location,googleMapsUri,types,businessStatus";
function category(types: string[] = []) {
  if (types.includes("cafe") || types.includes("coffee_shop")) return "Café";
  if (types.includes("bakery")) return "Bakery";
  if (types.includes("bar")) return "Bar";
  if (types.includes("restaurant")) return "Restaurant";
  if (types.includes("lodging")) return "Hotel";
  if (types.includes("tourist_attraction")) return "Sight";
  return "Shop";
}
function candidate(p: GoogleResult): CatalogueCandidate | null {
  if (
    !p.id ||
    !p.displayName?.text ||
    !p.formattedAddress ||
    !p.googleMapsUri ||
    !Number.isFinite(p.location?.latitude) ||
    !Number.isFinite(p.location?.longitude)
  )
    return null;
  return {
    name: p.displayName.text,
    address: p.formattedAddress,
    latitude: p.location!.latitude!,
    longitude: p.location!.longitude!,
    googleMapsUrl: p.googleMapsUri,
    googlePlaceId: p.id,
    category: category(p.types),
    district: "",
    businessStatus: p.businessStatus,
  };
}
export async function lookupCataloguePlaces(
  input: CatalogueInput,
  options: {
    query?: string;
    mapsUrl?: string;
    fetcher?: typeof fetch;
    apiKey?: string;
  } = {},
) {
  const key = options.apiKey ?? process.env.GOOGLE_PLACES_API_KEY;
  if (!key)
    throw new CatalogueError(
      "Place lookup is not connected. Your place is saved in Inbox; retry after connecting Google Places.",
      503,
    );
  const fetcher = options.fetcher ?? fetch;
  let placeId: string | null = null;
  if (options.mapsUrl?.trim()) {
    const url = parseSupportedProviderUrl(options.mapsUrl.trim());
    if (!/google\./.test(url.hostname) && url.hostname !== "goo.gl")
      throw new CatalogueError("Use a Google Maps link.");
    placeId = extractGooglePlaceIdFromUrl(url.toString());
    if (!placeId) {
      const response = await fetchSupportedProviderUrl(
        url.toString(),
        {},
        fetcher,
      );
      placeId = extractGooglePlaceIdFromUrl(response.url || url.toString());
      if (!placeId) {
        const html = await response.text();
        placeId = extractGooglePlaceIdFromUrl(html.slice(0, 1_000_000));
      }
    }
    if (!placeId)
      throw new CatalogueError(
        "This Maps link could not be resolved. Search using the venue’s full name and choose the correct result.",
      );
  }
  const response = await fetcher(
    placeId
      ? `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`
      : "https://places.googleapis.com/v1/places:searchText",
    {
      method: placeId ? "GET" : "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": placeId
          ? fields
          : fields
              .split(",")
              .map((f) => `places.${f}`)
              .join(","),
      },
      ...(!placeId
        ? {
            body: JSON.stringify({
              textQuery: [options.query?.trim() || input.name, input.city].join(
                ", ",
              ),
              pageSize: 5,
            }),
          }
        : {}),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    },
  );
  if (!response.ok)
    throw new CatalogueError(
      "Google Places could not complete this lookup. Your place is saved; retry shortly.",
      502,
    );
  const payload = (await response.json()) as GoogleResult & {
    places?: GoogleResult[];
  };
  const results = (placeId ? [payload] : (payload.places ?? []))
    .map(candidate)
    .filter((p): p is CatalogueCandidate => Boolean(p));
  if (!results.length)
    throw new CatalogueError(
      "No matching places found. Try a fuller name or a Google Maps link.",
    );
  return results;
}
