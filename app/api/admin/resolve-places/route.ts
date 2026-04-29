import { NextRequest, NextResponse } from "next/server";

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
  googleCategory: string;
  notes: string[];
};

const MAX_TEXT_QUERIES = 20;
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
  cat_cafe: "Cafe",
  coffee_roastery: "Coffee",
  coffee_shop: "Coffee shop",
  coffee_stand: "Coffee shop",
  dessert_restaurant: "Dessert shop",
  dessert_shop: "Dessert shop",
  food_store: "Food store",
  japanese_restaurant: "Japanese restaurant",
  ramen_restaurant: "Ramen restaurant",
  restaurant: "Restaurant",
  sushi_restaurant: "Sushi restaurant",
  tea_house: "Tea house",
  wine_bar: "Wine bar",
};

const CATEGORY_PRIORITY_TYPES = [
  "coffee_shop",
  "coffee_roastery",
  "coffee_stand",
  "cafe",
  "cat_cafe",
  "tea_house",
  "dessert_shop",
  "dessert_restaurant",
  "bakery",
  "restaurant",
];

function isAuthorized(request: NextRequest) {
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword) {
    return process.env.NODE_ENV !== "production";
  }

  return request.headers.get("x-admin-password") === adminPassword;
}

function normalizeCityHint(cityHint: string) {
  return cityHint && cityHint !== "all" ? cityHint : "";
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

function deriveArea(city: string, address: string, fallbackArea = "") {
  if (fallbackArea.trim()) {
    return fallbackArea.trim();
  }

  const japaneseWardMatch = address.match(/([^\s、,]+区)/);
  if (japaneseWardMatch) {
    return japaneseWardMatch[1];
  }

  const districtMatch = address.match(/([A-Za-z'’.-]+\sDistrict)/i);
  if (districtMatch) {
    return districtMatch[1];
  }

  const wardMatch = address.match(/([A-Za-z'’.-]+\sWard)/i);
  if (wardMatch) {
    return wardMatch[1];
  }

  if (city === "Taipei") {
    const taipeiMatch = address.match(/([A-Za-z'’.-]+\sDistrict)/i);
    if (taipeiMatch) {
      return taipeiMatch[1];
    }
  }

  return "";
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

    const finalText = response.url ? extractUsefulTextFromUrl(response.url) : "";

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
                "Extract place-intake data from this image. Return strict JSON with keys: place_names (array of strings), city_hint, area_hint, address_hint, category_hint, subway_hint, tabelog_hint, notes (array of strings). If unsure, leave fields empty. City hint provided: " +
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
              place_names: { type: "array", items: { type: "string" } },
              city_hint: { type: "string" },
              area_hint: { type: "string" },
              address_hint: { type: "string" },
              category_hint: { type: "string" },
              subway_hint: { type: "string" },
              tabelog_hint: { type: "string" },
              notes: { type: "array", items: { type: "string" } },
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

  const outputText = getOutputText(await response.json());

  return JSON.parse(outputText || "{}") as OpenAIExtraction;
}

async function searchGooglePlace(query: string) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";

  if (!apiKey) {
    throw new Error("Google Places API key is not configured.");
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.displayName,places.formattedAddress,places.location,places.primaryType,places.primaryTypeDisplayName,places.types",
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

  const data = (await response.json()) as SearchTextResponse;
  return data.places?.[0] ?? null;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Admin access required." }, { status: 401 });
  }

  const formData = await request.formData();
  const cityHint = normalizeCityHint(String(formData.get("cityHint") ?? ""));
  const plainText = String(formData.get("plainText") ?? "").trim();
  const placeUrl = String(formData.get("placeUrl") ?? "").trim();
  const imageFile = formData.get("image");

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

  const queries = [...textQueries];
  const urlNotes = new Map<string, string>();

  if (placeUrl) {
    const urlResult = await resolvePlaceUrl(placeUrl);
    queries.push(urlResult.query);

    if (urlResult.note) {
      urlNotes.set(urlResult.query, urlResult.note);
    }
  }

  let imageExtraction: OpenAIExtraction | null = null;

  if (imageFile instanceof File && imageFile.size > 0) {
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
        "Image uploads require OPENAI_API_KEY. Text and URL inputs still work without it.",
      );
    } else {
      try {
        imageExtraction = await extractFromImage(imageFile, cityHint);
        queries.push(
          ...(imageExtraction.place_names ?? [])
            .map((placeName) => placeName.trim())
            .filter(Boolean),
        );
      } catch (error) {
        warnings.push(
          error instanceof Error
            ? error.message
            : "Image extraction failed. Text and URL inputs still work.",
        );
      }
    }
  }

  if (queries.length === 0) {
    return NextResponse.json(
      { error: "Add at least one place name, URL, or image to resolve." },
      { status: 400 },
    );
  }

  const drafts: DraftPlace[] = [];

  for (const query of queries) {
    const searchQuery = [query, cityHint || imageExtraction?.city_hint || ""]
      .filter(Boolean)
      .join(", ");

    let match: GooglePlace | null = null;
    const notes: string[] = [];

    try {
      match = await searchGooglePlace(searchQuery);
    } catch (error) {
      notes.push(
        error instanceof Error
          ? error.message
          : "Google Places lookup failed for this place.",
      );
    }

    const resolvedCity = cityHint || imageExtraction?.city_hint || "Unknown";
    const address = match?.formattedAddress ?? imageExtraction?.address_hint ?? "";
    const googleCategory = deriveCategoryFromGooglePlace(match, query);

    drafts.push({
      sourceLabel: query,
      city: resolvedCity,
      name: match?.displayName?.text ?? query,
      address,
      category: imageExtraction?.category_hint || googleCategory,
      area: deriveArea(resolvedCity, address, imageExtraction?.area_hint ?? ""),
      latitude: match?.location?.latitude ?? null,
      longitude: match?.location?.longitude ?? null,
      subway: imageExtraction?.subway_hint ?? "",
      tabelog: imageExtraction?.tabelog_hint ?? "",
      googleCategory,
      notes: [
        ...(imageExtraction?.notes ?? []),
        ...(urlNotes.get(query) ? [urlNotes.get(query) as string] : []),
        ...notes,
        ...(match ? [] : ["Review needed: no confident Google Places match."]),
      ],
    });
  }

  return NextResponse.json({ drafts, warnings });
}
