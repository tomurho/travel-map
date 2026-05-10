import { NextRequest, NextResponse } from "next/server";

import {
  getTextSearchCacheKey,
  GooglePlacesAccess,
} from "@/lib/google-places-access";

type SearchTextResponse = {
  places?: Array<{
    id?: string;
    currentOpeningHours?: {
      weekdayDescriptions?: string[];
    };
    photos?: Array<{
      name?: string;
    }>;
  }>;
};

const PLACE_DETAILS_FIELD_MASK =
  "places.id,places.currentOpeningHours.weekdayDescriptions,places.photos.name";

export async function GET(request: NextRequest) {
  const name = request.nextUrl.searchParams.get("name")?.trim() ?? "";
  const address = request.nextUrl.searchParams.get("address")?.trim() ?? "";
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? "";
  const liveEnabled = process.env.GOOGLE_PLACES_LIVE_ENABLED === "true";

  if (liveEnabled && !apiKey) {
    return NextResponse.json(
      { error: "Google Places API key is not configured." },
      { status: 500 },
    );
  }

  if (!name && !address) {
    return NextResponse.json(
      { error: "A place name or address is required." },
      { status: 400 },
    );
  }

  const textQuery = [name, address].filter(Boolean).join(", ");
  const access = new GooglePlacesAccess({
    cacheOnly: !liveEnabled,
    confirmLiveApi: liveEnabled,
    liveEnabled,
    maxApiCalls: 2,
  });

  let data: SearchTextResponse;

  try {
    data = await access.fetchJson<SearchTextResponse>(
      "textSearch",
      getTextSearchCacheKey({
        city: "",
        fieldMask: PLACE_DETAILS_FIELD_MASK,
        query: textQuery,
      }),
      "textSearch",
      async () => {
        const response = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": apiKey,
              "X-Goog-FieldMask": PLACE_DETAILS_FIELD_MASK,
            },
            body: JSON.stringify({
              textQuery,
              maxResultCount: 1,
            }),
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error("Google Places lookup failed.");
        }

        return (await response.json()) as SearchTextResponse;
      },
    );
  } catch {
    return NextResponse.json({
      matched: false,
      openingHours: null,
      photoUrls: [],
    });
  }

  const match = data.places?.[0];

  if (!match) {
    return NextResponse.json({
      matched: false,
      openingHours: null,
      photoUrls: [],
    });
  }

  const photoName = match.photos?.[0]?.name;

  return NextResponse.json({
    matched: true,
    openingHours: match.currentOpeningHours?.weekdayDescriptions ?? null,
    photoUrls:
      match.photos
        ?.map((photo) => photo.name)
        .filter((name): name is string => Boolean(name))
        .slice(0, 12)
        .map(
          (name) =>
            `https://places.googleapis.com/v1/${name}/media?maxHeightPx=320&maxWidthPx=320&key=${apiKey}`,
        ) ?? [],
  });
}
