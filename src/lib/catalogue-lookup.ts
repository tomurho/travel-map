import {
  CatalogueError,
  type CatalogueCandidate,
  type CatalogueInput,
} from "@/lib/catalogue";
import { extractGooglePlaceIdFromUrl } from "@/lib/google-place-admin-resolver";
import { normalizeArea } from "@/lib/import";
import { normalizePlaceCity } from "@/lib/place-city";
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
  addressComponents?: Array<{
    longText?: string;
    shortText?: string;
    types?: string[];
  }>;
};
const fields =
  "id,displayName,formattedAddress,addressComponents,location,googleMapsUri,types,businessStatus";

function district(components: GoogleResult["addressComponents"] = [], city: string) {
  const areaTypes = [
    "sublocality_level_1", "sublocality", "neighborhood",
    "administrative_area_level_3", "administrative_area_level_4",
  ];
  const name = (component: NonNullable<GoogleResult["addressComponents"]>[number]) =>
    component.longText?.trim() || component.shortText?.trim() || "";
  const cityKey = normalizePlaceCity(city).toLocaleLowerCase().replace(/\s+city$/, "");
  const areas = components.filter((component) => {
    const value = name(component);
    return value && value.toLocaleLowerCase().replace(/\s+city$/, "") !== cityKey
      && component.types?.some((type) => areaTypes.includes(type)
        || type === "administrative_area_level_2" || type === "locality");
  });
  // Prefer an explicitly named district or ward over a smaller neighbourhood.
  const namedDistrict = areas.find((component) =>
    /\b(?:district|ward|borough)\b|[区區]$/i.test(name(component)));
  const component = namedDistrict ?? areaTypes
    .map((type) => areas.find((area) => area.types?.includes(type)))
    .find(Boolean);
  return component ? normalizeArea(normalizePlaceCity(city), name(component)) : "";
}

function mapsCid(value: string) {
  const url = new URL(value);
  const cid = url.searchParams.get("cid");
  if (cid && /^\d{1,20}$/.test(cid)) return BigInt(cid).toString();
  const feature = value.match(/(?:!|%21)1s0x[0-9a-f]+(?::|%3a)(0x[0-9a-f]{1,16})/i);
  return feature ? BigInt(feature[1]).toString() : null;
}

function linkedMapsVenue(value: string, sourceCid: string | null) {
  const url = new URL(value);
  const cid = mapsCid(value) ?? sourceCid;
  const name = url.pathname.match(/\/maps\/place\/([^/]+)/)?.[1];
  if (!cid || !name) return null;
  let query: string;
  try {
    query = decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    return null;
  }
  const coordinates = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
    ?? value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  const latitude = Number(coordinates?.[1]);
  const longitude = Number(coordinates?.[2]);
  const center = Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && Number.isFinite(longitude) && Math.abs(longitude) <= 180
    ? { latitude, longitude } : null;
  return { cid, query, center };
}
function category(types: string[] = []) {
  if (types.includes("cafe") || types.includes("coffee_shop")) return "Café";
  if (types.includes("bakery")) return "Bakery";
  if (types.includes("bar")) return "Bar";
  if (types.includes("restaurant")) return "Restaurant";
  if (types.includes("lodging")) return "Hotel";
  if (types.includes("tourist_attraction")) return "Sight";
  return "Shop";
}
function candidate(p: GoogleResult, city: string): CatalogueCandidate | null {
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
    district: district(p.addressComponents, city),
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
  let linkedVenue: ReturnType<typeof linkedMapsVenue> = null;
  const mapsUrl = (options.mapsUrl ?? input.mapsUrl)?.trim();
  if (mapsUrl) {
    const url = parseSupportedProviderUrl(mapsUrl);
    if (
      !/google\./.test(url.hostname) &&
      !["goo.gl", "maps.app.goo.gl"].includes(url.hostname)
    )
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
        linkedVenue = linkedMapsVenue(response.url || url.toString(), mapsCid(url.toString()));
        if (!linkedVenue) {
          const html = await response.text();
          placeId = extractGooglePlaceIdFromUrl(html.slice(0, 1_000_000));
        }
      }
    }
    if (!placeId && !linkedVenue)
      throw new CatalogueError(
        "This Maps link could not be resolved. Check the link, or clear it to search by name and city.",
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
              textQuery: linkedVenue?.query ?? [options.query?.trim() || input.name, input.city].join(
                ", ",
              ),
              pageSize: 5,
              ...(linkedVenue?.center ? {
                locationBias: { circle: { center: linkedVenue.center, radius: 200 } },
              } : {}),
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
    // A name and location help find the API record; only the link's exact CID
    // can establish that it is the linked venue.
    .filter((p) => !linkedVenue || (p.googleMapsUri && mapsCid(p.googleMapsUri) === linkedVenue.cid))
    .map((place) => candidate(place, input.city))
    .filter((p): p is CatalogueCandidate => Boolean(p));
  if (!results.length)
    throw new CatalogueError(
      linkedVenue
        ? "Google could not confirm the exact venue from this Maps link. Check the link, or clear it to search by name and city."
        : "No matching places found. Try a fuller name or a Google Maps link.",
    );
  return results;
}
