import { NextRequest, NextResponse } from "next/server";
import places from "@/data/places.json";
import {
  getTextSearchCacheKey,
  GooglePlacesAccess,
} from "@/lib/google-places-access";
import { normalizeArea } from "@/lib/import";
import type { Place } from "@/lib/place";
import { isAdminAuthorized } from "@/lib/admin-auth";

type OpenAIExtraction = {
  place_names?: string[];
  city_hint?: string;
  area_hint?: string;
  address_hint?: string;
  category_hint?: string;
  subway_hint?: string;
  tabelog_hint?: string;
  notes?: string[];
};

type GooglePlace = {
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  primaryType?: string;
  primaryTypeDisplayName?: { text?: string };
  types?: string[];
};

type SearchTextResponse = {
  places?: GooglePlace[];
};

type DraftPlace = {
  sourceLabel: string;
  city: string;
  name: string;
  address: string;
  category: string;
  area: string;
  latitude: number | null;
  longitude: number | null;
  subway: string;
  tabelog: string;
  googleMapsUrl: string;
  verifiedStatus: "";
  lastChecked: string;
  verificationNotes: string;
  googleCategory: string;
  notes: string[];
};

type TabelogExtraction = {
  name: string;
  address: string;
  station: string;
  score: string;
  sourceUrl: string;
  notes: string[];
};

type QueryContext = {
  query: string;
  imageExtraction?: OpenAIExtraction;
  tabelogExtraction?: TabelogExtraction;
  sourceNote?: string;
};

const MAX_TEXT_QUERIES = 20;
const MAX_IMAGE_FILES = 10;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

const GOOGLE_TYPE_CATEGORY_LABELS: Record<string, string> = {
  bakery: "Bakery",
  bar: "Bar",
  cafe: "Coffee shop",
  candy_store: "Sweets",
  cat_cafe: "Cafe",
  coffee_roastery: "Coffee",
  coffee_shop: "Coffee shop",
  coffee_stand: "Coffee shop",
  dessert_restaurant: "Dessert shop",
  dessert_shop: "Dessert shop",
  dog_cafe: "Cafe",
  food_store: "Food store",
  ice_cream_shop: "Ice cream",
  internet_cafe: "Cafe",
  japanese_restaurant: "Japanese restaurant",
  japanese_sweets_restaurant: "Japanese sweets",
  ramen_restaurant: "Ramen restaurant",
  restaurant: "Restaurant",
  seafood_restaurant: "Seafood restaurant",
  sushi_restaurant: "Sushi restaurant",
  tea_house: "Tea house",
  vegan_restaurant: "Vegan restaurant",
  vegetarian_restaurant: "Vegetarian restaurant",
  wine_bar: "Wine bar",
};

const CATEGORY_PRIORITY_TYPES = [
  "coffee_shop",
  "coffee_roastery",
  "coffee_stand",
  "cafe",
  "cat_cafe",
  "dog_cafe",
  "tea_house",
  "japanese_sweets_restaurant",
  "dessert_shop",
  "dessert_restaurant",
  "bakery",
  "restaurant",
];
const GOOGLE_PLACE_SEARCH_FIELD_MASK =
  "places.displayName,places.formattedAddress,places.location,places.primaryType,places.primaryTypeDisplayName,places.types";

function normalizeCityHint(cityHint: string) {
  return cityHint && cityHint !== "all" ? cityHint : "";
}

function firstNonEmpty(...values: Array<string | null | undefined>) {
  return values.find((value) => value?.trim())?.trim() ?? "";
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDuplicateText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function coordinatesAreClose(
  firstLatitude: number | null,
  firstLongitude: number | null,
  secondLatitude: number,
  secondLongitude: number,
) {
  if (firstLatitude === null || firstLongitude === null) {
    return false;
  }

  return (
    Math.abs(firstLatitude - secondLatitude) < 0.00025 &&
    Math.abs(firstLongitude - secondLongitude) < 0.00025
  );
}

function getDuplicateNote(
  city: string,
  name: string,
  address: string,
  latitude: number | null,
  longitude: number | null,
) {
  const normalizedCity = normalizeDuplicateText(city);
  const normalizedName = normalizeDuplicateText(name);
  const normalizedAddress = normalizeDuplicateText(address);
  const existingPlace = (places as Place[]).find((place) => {
    if (normalizeDuplicateText(place.city) !== normalizedCity) {
      return false;
    }

    const existingName = normalizeDuplicateText(place.name);
    const existingAddress = normalizeDuplicateText(place.address);

    return (
      (normalizedName && existingName === normalizedName) ||
      (normalizedAddress && existingAddress === normalizedAddress) ||
      coordinatesAreClose(
        latitude,
        longitude,
        place.latitude,
        place.longitude,
      )
    );
  });

  if (!existingPlace) {
    return "";
  }

  return `Possible duplicate: already in dataset as ${existingPlace.name} (${existingPlace.city}, ${existingPlace.category}).`;
}

function isTabelogUrl(value: string) {
  try {
    const url = new URL(value);
    return url.hostname.endsWith("tabelog.com");
  } catch {
    return false;
  }
}

function inferCityFromText(...values: string[]) {
  const text = values.filter(Boolean).join(" ").toLowerCase();

  if (/\b(taipei|taipei city)\b|台北|臺北/.test(text)) {
    return "Taipei";
  }

  if (/\b(kyoto|kyoto city)\b|京都/.test(text)) {
    return "Kyoto";
  }

  if (/\b(tokyo|tokyo-to|tokyo metropolis)\b|東京都|東京/.test(text)) {
    return "Tokyo";
  }

  return "";
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&#(\d+);/g, (_match, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    );
}

function stripTags(value: string) {
  return decodeHtmlEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getFirstMatch(value: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }

  return "";
}

function parseJsonLdObjects(html: string) {
  const scripts = html.match(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi,
  );

  if (!scripts) {
    return [];
  }

  return scripts.flatMap((script) => {
    const content = script
      .replace(/^<script[^>]*>/i, "")
      .replace(/<\/script>$/i, "")
      .trim();

    try {
      const parsed = JSON.parse(decodeHtmlEntities(content)) as unknown;
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [];
    }
  });
}

function getStringProperty(value: unknown, key: string) {
  if (!value || typeof value !== "object" || !(key in value)) {
    return "";
  }

  const property = (value as Record<string, unknown>)[key];
  return typeof property === "string" || typeof property === "number"
    ? String(property)
    : "";
}

function getJsonLdAddress(value: unknown) {
  if (!value || typeof value !== "object" || !("address" in value)) {
    return "";
  }

  const address = (value as Record<string, unknown>).address;

  if (typeof address === "string") {
    return address;
  }

  if (!address || typeof address !== "object") {
    return "";
  }

  const addressParts = [
    "postalCode",
    "addressRegion",
    "addressLocality",
    "streetAddress",
  ].map((key) => getStringProperty(address, key));

  return addressParts.filter(Boolean).join(" ");
}

function getJsonLdRating(value: unknown) {
  if (!value || typeof value !== "object" || !("aggregateRating" in value)) {
    return "";
  }

  const rating = (value as Record<string, unknown>).aggregateRating;
  return getStringProperty(rating, "ratingValue");
}

function parseTabelogHtml(html: string): TabelogExtraction {
  const jsonLdObjects = parseJsonLdObjects(html);
  const primaryJsonLd =
    jsonLdObjects.find((item) => getStringProperty(item, "name")) ?? null;
  const name =
    getStringProperty(primaryJsonLd, "name") ||
    getFirstMatch(html, [
      /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i,
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    ]).replace(/\s*-\s*食べログ.*$/i, "");
  const address =
    getJsonLdAddress(primaryJsonLd) ||
    getFirstMatch(html, [
      /<meta[^>]+property=["']restaurant:contact_info:street_address["'][^>]+content=["']([^"']+)["']/i,
      /<th[^>]*>\s*住所\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
    ]);
  const score =
    getJsonLdRating(primaryJsonLd) ||
    getFirstMatch(html, [
      /"ratingValue"\s*:\s*"?([0-9.]+)"?/i,
      /<span[^>]+class=["'][^"']*rdheader-rating__score-val-dtl[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
      /<b[^>]+class=["'][^"']*rdheader-rating__score-val[^"']*["'][^>]*>([\s\S]*?)<\/b>/i,
      /<span[^>]+class=["'][^"']*rdheader-rating__score-val[^"']*["'][^>]*>([\s\S]*?)<\/span>/i,
    ]);
  const station = getFirstMatch(html, [
    /<dt[^>]*class=["'][^"']*rdheader-subinfo__item-title[^"']*["'][^>]*>\s*最寄り駅：?\s*<\/dt>\s*<dd[^>]*class=["'][^"']*rdheader-subinfo__item-text[^"']*["'][^>]*>([\s\S]*?)<\/dd>/i,
    /<th[^>]*>\s*最寄り駅\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i,
    /最寄り駅[\s\S]{0,300}?<a[^>]*>([\s\S]*?)<\/a>/i,
  ]).replace(/駅×.*$/u, "駅");
  const normalizedStation = normalizeStationName(station);

  return {
    name,
    address,
    station: normalizedStation,
    score,
    sourceUrl: "",
    notes: [
      ...(score ? [] : ["Review needed: Tabelog score was not found on page."]),
      ...(station ? [] : ["Review needed: nearest subway was not found on page."]),
    ],
  };
}

async function fetchTabelogExtraction(tabelogUrl: string) {
  const response = await fetch(tabelogUrl, {
    headers: {
      "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
    },
    redirect: "follow",
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Tabelog lookup failed with status ${response.status}.`);
  }

  return parseTabelogHtml(await response.text());
}

function extractStationFromAreaGenre(value: string) {
  const stationText = value.split("/")[0]?.trim() ?? "";

  return normalizeStationName(stationText
    .replace(/\s+\d+(?:\.\d+)?\s*(?:m|km)\b/i, "")
    .trim());
}

function normalizeStationName(value: string) {
  const trimmed = value.replace(/\s+/g, " ").trim();
  const japaneseStationMatch = trimmed.match(/^(.+?駅)(?:\s+\1)+$/u);

  if (japaneseStationMatch?.[1]) {
    return japaneseStationMatch[1];
  }

  const parts = trimmed.split(/\s{2,}| \/ /).filter(Boolean);
  return parts[0] ?? trimmed;
}

function parseTabelogSearchHtml(html: string): TabelogExtraction | null {
  const match = html.match(
    /<div class="list-rst js-bookmark[\s\S]*?(?=<div class="list-rst js-bookmark|<div class="rstlist-info__paginate-wrap|$)/,
  );

  if (!match) {
    return null;
  }

  const block = match[0];
  const nameMatch = block.match(
    /<a[^>]+class="[^"]*list-rst__rst-name-target[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
  );
  const areaGenre = getFirstMatch(block, [
    /<div[^>]+class="[^"]*list-rst__area-genre[^"]*"[^>]*>([\s\S]*?)<\/div>/i,
  ]);
  const score = getFirstMatch(block, [
    /<span[^>]+class="[^"]*list-rst__rating-val[^"]*"[^>]*>([\s\S]*?)<\/span>/i,
  ]);
  const name = nameMatch?.[2] ? stripTags(nameMatch[2]) : "";
  const sourceUrl = nameMatch?.[1] ? decodeHtmlEntities(nameMatch[1]) : "";

  return {
    name,
    address: "",
    station: extractStationFromAreaGenre(areaGenre),
    score,
    sourceUrl,
    notes: [
      ...(name ? [`Tabelog search matched: ${name}.`] : []),
      ...(sourceUrl ? [`Tabelog listing: ${sourceUrl}`] : []),
      ...(score ? [] : ["Review needed: Tabelog score was not found in search result."]),
      ...(areaGenre ? [] : ["Review needed: nearest subway was not found in search result."]),
    ],
  };
}

async function searchTabelog(city: string, query: string) {
  const cityPath = getTabelogCityPath(city);

  if (!cityPath || !query.trim()) {
    return null;
  }

  const searchQueries = buildTabelogSearchQueries(query);

  for (const searchQuery of searchQueries) {
    const result = await searchTabelogOnce(cityPath, searchQuery);

    if (result && isLikelyTabelogMatch(searchQuery, result.name)) {
      return result;
    }
  }

  return null;
}

async function searchTabelogOnce(cityPath: string, query: string) {
  const response = await fetch(
    `https://tabelog.com/en/${cityPath}/rstLst/?sw=${encodeURIComponent(query)}`,
    {
      headers: {
        "Accept-Language": "en-US,en;q=0.9,ja;q=0.8",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      },
      redirect: "follow",
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Tabelog search failed with status ${response.status}.`);
  }

  return parseTabelogSearchHtml(await response.text());
}

function buildTabelogSearchQueries(query: string) {
  const cleanedQuery = query
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutCityTerms = cleanedQuery
    .replace(/\b(?:kyoto|tokyo|japan)\b|京都|東京|日本/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const withoutCategoryTerms = withoutCityTerms
    .replace(
      /\b(?:coffee\s+roaster(?:y|s)?|coffee\s+shop|coffee|cafe|café|wine\s*bar|bar|restaurant)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();

  return uniqueValues([cleanedQuery, withoutCityTerms, withoutCategoryTerms]);
}

function normalizeSearchToken(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyTabelogMatch(query: string, resultName: string) {
  const queryTokens = normalizeSearchToken(query)
    .split(" ")
    .filter((token) => token.length > 2);
  const resultNameNormalized = normalizeSearchToken(resultName);

  if (!queryTokens.length || !resultNameNormalized) {
    return Boolean(resultNameNormalized);
  }

  return queryTokens.every((token) => resultNameNormalized.includes(token));
}

function isJapanCity(city: string) {
  return ["kyoto", "tokyo"].includes(city.trim().toLowerCase());
}

function getTabelogCityPath(city: string) {
  const normalizedCity = city.trim().toLowerCase();

  if (normalizedCity === "kyoto") {
    return "kyoto";
  }

  if (normalizedCity === "tokyo") {
    return "tokyo";
  }

  return "";
}

function formatGoogleType(type: string) {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function hasCoffeeSignal(...values: string[]) {
  return values.some((value) => /\b(coffee|cafe|café|koffee)\b/i.test(value));
}

function deriveCategoryFromGooglePlace(
  match: GooglePlace | null,
  sourceQuery: string,
) {
  if (!match) {
    return "";
  }

  const types = match.types ?? [];
  const placeName = match.displayName?.text ?? "";

  if (hasCoffeeSignal(sourceQuery, placeName)) {
    return "Coffee shop";
  }

  const prioritizedType = CATEGORY_PRIORITY_TYPES.find((type) =>
    types.includes(type),
  );
  const selectedType = prioritizedType || match.primaryType || types[0] || "";

  if (selectedType && GOOGLE_TYPE_CATEGORY_LABELS[selectedType]) {
    return GOOGLE_TYPE_CATEGORY_LABELS[selectedType];
  }

  return match.primaryTypeDisplayName?.text || formatGoogleType(selectedType);
}

function normalizeCategoryHint(value: string) {
  const category = value.trim();

  if (!category) {
    return "";
  }

  if (hasCoffeeSignal(category)) {
    return "Coffee shop";
  }

  return category;
}

function isGenericGoogleCategory(value: string) {
  return ["Food store", "Store"].includes(value.trim());
}

function chooseCategory(googleCategory: string, extractionCategory = "") {
  const normalizedExtractionCategory = normalizeCategoryHint(extractionCategory);

  if (
    normalizedExtractionCategory &&
    (!googleCategory || isGenericGoogleCategory(googleCategory))
  ) {
    return normalizedExtractionCategory;
  }

  return googleCategory || normalizedExtractionCategory || "";
}

function deriveArea(city: string, address: string, fallbackArea = "") {
  const fallback = fallbackArea.trim();
  const addressArea = deriveAreaFromAddress(city, address);

  if (city === "Taipei" && addressArea) {
    return addressArea;
  }

  if (fallback && !isLikelyStreetLevelArea(fallback)) {
    return normalizeArea(city, fallbackArea);
  }

  return addressArea;
}

function deriveAreaFromAddress(city: string, address: string) {
  if (!address.trim()) {
    return "";
  }

  const districtMatch = address.match(/([A-Za-z'’.-]+\sDistrict)/i);
  if (districtMatch) {
    return normalizeArea(city, districtMatch[1]);
  }

  const wardMatch = address.match(/([A-Za-z'’.-]+\sWard)/i);
  if (wardMatch) {
    return normalizeArea(city, wardMatch[1]);
  }

  const japaneseWardMatch = address.match(/([^\s、,]+区)/);
  if (japaneseWardMatch) {
    return normalizeArea(city, japaneseWardMatch[1]);
  }
  return "";
}

function isLikelyStreetLevelArea(value: string) {
  return /\b(road|rd\.?|street|st\.?|avenue|ave\.?|lane|ln\.?|alley|section|sec\.?|boulevard|blvd\.?)\b/i.test(
    value,
  );
}

function extractUsefulTextFromUrl(placeUrl: string) {
  try {
    const parsed = new URL(placeUrl);
    const queryValue =
      parsed.searchParams.get("query") ||
      parsed.searchParams.get("q") ||
      parsed.searchParams.get("destination");

    if (queryValue?.trim()) {
      return queryValue.trim();
    }

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    const placeIndex = pathParts.findIndex((part) => part === "place");
    const rawSlug =
      placeIndex >= 0
        ? pathParts[placeIndex + 1]
        : pathParts[pathParts.length - 1];
    const slug = decodeURIComponent(rawSlug ?? "");

    if (!slug) {
      return placeUrl.trim();
    }

    return slug.replace(/[-_]+/g, " ").trim();
  } catch {
    return placeUrl.trim();
  }
}

async function resolvePlaceUrl(placeUrl: string) {
  const directText = extractUsefulTextFromUrl(placeUrl);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4500);
    const response = await fetch(placeUrl, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const finalUrl = response.url;
    const finalText = finalUrl ? extractUsefulTextFromUrl(finalUrl) : "";

    if (finalText && finalText !== directText) {
      return {
        query: finalText,
        note: `Resolved Google Maps share URL to: ${finalText}`,
      };
    }
  } catch {
    // Keep the direct URL-derived text as a fallback below.
  }

  return {
    query: directText,
    note: directText === placeUrl ? "Review needed: could not resolve this URL." : "",
  };
}

function getOutputText(responseData: unknown) {
  if (
    responseData &&
    typeof responseData === "object" &&
    "output_text" in responseData &&
    typeof responseData.output_text === "string"
  ) {
    return responseData.output_text;
  }

  if (!responseData || typeof responseData !== "object" || !("output" in responseData)) {
    return "";
  }

  const output = responseData.output;
  if (!Array.isArray(output)) {
    return "";
  }

  return output
    .flatMap((item) => {
      if (!item || typeof item !== "object" || !("content" in item)) {
        return [];
      }

      const content = item.content;
      if (!Array.isArray(content)) {
        return [];
      }

      return content
        .map((contentItem) => {
          if (
            contentItem &&
            typeof contentItem === "object" &&
            "text" in contentItem &&
            typeof contentItem.text === "string"
          ) {
            return contentItem.text;
          }

          return "";
        })
        .filter(Boolean);
    })
    .join("\n")
    .trim();
}

async function extractFromImage(
  imageFile: File,
  cityHint: string,
): Promise<OpenAIExtraction> {
  const openAiKey = process.env.OPENAI_API_KEY ?? "";

  if (!openAiKey) {
    throw new Error(
      "Screenshot parsing requires OPENAI_API_KEY to be configured on the server.",
    );
  }

  const arrayBuffer = await imageFile.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = imageFile.type || "image/png";

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text:
                "Extract place-intake data from this image. Return strict JSON with keys: place_names (array of strings), city_hint, area_hint, address_hint, category_hint, subway_hint, tabelog_hint, notes (array of strings). For Japan places, subway_hint must be the nearest station/subway shown by Tabelog, and tabelog_hint must be the Tabelog score/rating. Do not invent Tabelog values; if unsure, leave fields empty and add a note. City hint provided: " +
                (cityHint || "unknown"),
            },
            {
              type: "input_image",
              image_url: `data:${mimeType};base64,${base64}`,
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "place_intake_extraction",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              place_names: {
                type: "array",
                items: { type: "string" },
              },
              city_hint: { type: "string" },
              area_hint: { type: "string" },
              address_hint: { type: "string" },
              category_hint: { type: "string" },
              subway_hint: { type: "string" },
              tabelog_hint: { type: "string" },
              notes: {
                type: "array",
                items: { type: "string" },
              },
            },
            required: [
              "place_names",
              "city_hint",
              "area_hint",
              "address_hint",
              "category_hint",
              "subway_hint",
              "tabelog_hint",
              "notes",
            ],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error("OpenAI image extraction failed.");
  }

  const data = await response.json();
  const outputText = getOutputText(data);

  return JSON.parse(outputText || "{}") as OpenAIExtraction;
}

async function searchGooglePlace(query: string, access: GooglePlacesAccess) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";

  if (process.env.GOOGLE_PLACES_LIVE_ENABLED === "true" && !apiKey) {
    throw new Error("Google Places API key is not configured.");
  }

  const data = await access.fetchJson<SearchTextResponse>(
    "textSearch",
    getTextSearchCacheKey({
      city: "",
      fieldMask: GOOGLE_PLACE_SEARCH_FIELD_MASK,
      query,
    }),
    "textSearch",
    async () => {
      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACE_SEARCH_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          maxResultCount: 1,
        }),
        cache: "no-store",
      });

      if (!response.ok) {
        throw new Error("Google Places lookup failed.");
      }

      return (await response.json()) as SearchTextResponse;
    },
  );
  return data.places?.[0] ?? null;
}

export async function POST(request: NextRequest) {
  if (!isAdminAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const formData = await request.formData();
  const cityHint = normalizeCityHint(String(formData.get("cityHint") ?? ""));
  const plainText = String(formData.get("plainText") ?? "").trim();
  const placeUrl = String(formData.get("placeUrl") ?? "").trim();
  const imageFiles = [
    ...formData.getAll("images"),
    ...formData.getAll("image"),
  ].filter((file): file is File => file instanceof File && file.size > 0);

  const warnings: string[] = [];
  const textQueries = plainText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (textQueries.length > MAX_TEXT_QUERIES) {
    return NextResponse.json(
      { error: `Resolve up to ${MAX_TEXT_QUERIES} place names at a time.` },
      { status: 400 },
    );
  }

  const queryContexts: QueryContext[] = textQueries.map((query) => ({ query }));

  if (placeUrl) {
    if (isTabelogUrl(placeUrl)) {
      try {
        const tabelogExtraction = {
          ...(await fetchTabelogExtraction(placeUrl)),
          sourceUrl: placeUrl,
        };
        const query =
          [tabelogExtraction.name, tabelogExtraction.address]
            .filter(Boolean)
            .join(", ") || placeUrl;

        queryContexts.push({
          query,
          tabelogExtraction,
          sourceNote: "Parsed from Tabelog URL.",
        });
      } catch (error) {
        const urlResult = await resolvePlaceUrl(placeUrl);
        queryContexts.push({
          query: urlResult.query,
          sourceNote:
            error instanceof Error
              ? `Review needed: ${error.message}`
              : "Review needed: Tabelog lookup failed.",
        });
      }
    } else {
      const urlResult = await resolvePlaceUrl(placeUrl);
      queryContexts.push({
        query: urlResult.query,
        sourceNote: urlResult.note,
      });
    }
  }

  if (imageFiles.length > MAX_IMAGE_FILES) {
    return NextResponse.json(
      { error: `Resolve up to ${MAX_IMAGE_FILES} images at a time.` },
      { status: 400 },
    );
  }

  for (const imageFile of imageFiles) {
    if (!ACCEPTED_IMAGE_TYPES.has(imageFile.type)) {
      return NextResponse.json(
        { error: "Upload a JPEG, PNG, WebP, HEIC, or HEIF image." },
        { status: 400 },
      );
    }

    if (imageFile.size > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "Upload an image smaller than 5MB." },
        { status: 400 },
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      warnings.push(
        `${imageFile.name}: image uploads require OPENAI_API_KEY. Text and URL inputs still work without it.`,
      );
    } else {
      try {
        const imageExtraction = await extractFromImage(imageFile, cityHint);
        const imageQueries = (imageExtraction.place_names ?? [])
          .map((placeName) => placeName.trim())
          .filter(Boolean);

        if (imageQueries.length === 0) {
          warnings.push(`${imageFile.name}: no place names were found.`);
        }

        queryContexts.push(
          ...imageQueries.map((query) => ({
            query,
            imageExtraction,
            sourceNote: `Parsed from image: ${imageFile.name}`,
          })),
        );
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? `${imageFile.name}: ${error.message}`
            : `${imageFile.name}: image extraction failed. Text and URL inputs still work.`,
        );
      }
    }
  }

  if (queryContexts.length === 0) {
    return NextResponse.json(
      { error: "Add at least one place name, URL, or image to resolve." },
      { status: 400 },
    );
  }

  const drafts: DraftPlace[] = [];
  const googleLiveEnabled = process.env.GOOGLE_PLACES_LIVE_ENABLED === "true";
  const googleAccess = new GooglePlacesAccess({
    cacheOnly: !googleLiveEnabled,
    confirmLiveApi: googleLiveEnabled,
    liveEnabled: googleLiveEnabled,
    maxApiCalls: 5,
  });

  for (const context of queryContexts) {
    const extraction = context.imageExtraction;
    const tabelogExtraction = context.tabelogExtraction;
    const searchQuery = [context.query, cityHint || extraction?.city_hint || ""]
      .filter(Boolean)
      .join(", ");

    let match: GooglePlace | null = null;
    const notes: string[] = [];

    try {
      match = await searchGooglePlace(searchQuery, googleAccess);
    } catch (error) {
      notes.push(
        error instanceof Error
          ? error.message
          : "Google Places lookup failed for this place.",
      );
    }

    const inferredCity = inferCityFromText(
      match?.formattedAddress ?? "",
      context.query,
      extraction?.city_hint ?? "",
      tabelogExtraction?.address ?? "",
    );
    const resolvedCity = cityHint || inferredCity || extraction?.city_hint || "Unknown";
    const address =
      match?.formattedAddress ??
      extraction?.address_hint ??
      tabelogExtraction?.address ??
      "";
    const derivedGoogleCategory = deriveCategoryFromGooglePlace(
      match,
      context.query,
    );
    const area = deriveArea(
      resolvedCity,
      address,
      extraction?.area_hint ?? "",
    );
    let resolvedTabelogExtraction = tabelogExtraction;

    if (
      isJapanCity(resolvedCity) &&
      (!resolvedTabelogExtraction?.station || !resolvedTabelogExtraction?.score)
    ) {
      try {
        const tabelogSearchQuery =
          match?.displayName?.text || context.query.split(",")[0] || context.query;
        resolvedTabelogExtraction =
          (await searchTabelog(resolvedCity, tabelogSearchQuery)) ??
          resolvedTabelogExtraction;
      } catch (error) {
        notes.push(
          error instanceof Error
            ? `Review needed: ${error.message}`
            : "Review needed: Tabelog search failed.",
        );
      }
    }

    const draftName = match?.displayName?.text ?? context.query;
    const latitude = match?.location?.latitude ?? null;
    const longitude = match?.location?.longitude ?? null;
    const duplicateNote = getDuplicateNote(
      resolvedCity,
      draftName,
      address,
      latitude,
      longitude,
    );

    drafts.push({
      sourceLabel: context.query,
      city: resolvedCity,
      name: draftName,
      address,
      category: chooseCategory(
        derivedGoogleCategory,
        extraction?.category_hint,
      ),
      area,
      latitude,
      longitude,
      subway: firstNonEmpty(
        extraction?.subway_hint,
        resolvedTabelogExtraction?.station,
      ),
      tabelog: firstNonEmpty(
        extraction?.tabelog_hint,
        resolvedTabelogExtraction?.score,
      ),
      googleMapsUrl: "",
      verifiedStatus: "",
      lastChecked: "",
      verificationNotes: "",
      googleCategory: derivedGoogleCategory,
      notes: [
        ...(extraction?.notes ?? []),
        ...(resolvedTabelogExtraction?.notes ?? []),
        ...(context.sourceNote ? [context.sourceNote] : []),
        ...(duplicateNote ? [duplicateNote] : []),
        ...notes,
        ...(isJapanCity(resolvedCity) &&
        !extraction?.subway_hint &&
        !resolvedTabelogExtraction?.station
          ? ["Review needed: add nearest subway from Tabelog."]
          : []),
        ...(isJapanCity(resolvedCity) &&
        !extraction?.tabelog_hint &&
        !resolvedTabelogExtraction?.score
          ? ["Review needed: add Tabelog score."]
          : []),
        ...(match ? [] : ["Review needed: no confident Google Places match."]),
      ],
    });
  }

  return NextResponse.json({ drafts, warnings });
}
